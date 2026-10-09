//! The engine behind a wasm boundary, for local play in `web2/`.
//! See `README.md` for the measurements.
//!
//! The boundary is the plain C ABI rather than `wasm-bindgen`. An export returns a status: zero
//! or more is the length of a JSON result, less than zero is the negated length of an error text.
//! Either is read from the response buffer, whose address never changes ([`ti4_response_ptr`]).
//!
//! # Memory
//!
//! This crate does not allocate for its own data: results and the update for the host (the view
//! of the asked seat and its choice) are written straight into the fixed buffers of [`buffer`]. What still allocates
//! here is what the interfaces of the engine and of `ti4-view` ask for (owned ids, the decider
//! box, the copy of the state, a projected view) and the text of an error.

pub mod buffer;

use std::fmt::{self, Write as _};
use std::sync::Mutex;

use serde::Serialize;
use ti4_content::ContentStore;
use ti4_engine::choice::{Choice, ChoiceOption, Decider, IllegalChoice};
use ti4_engine::game::{Game, RunError};
use ti4_model::content_types::POK;
use ti4_model::id::PlayerId;
use ti4_model::state::GameState;
use ti4_view::map::{build_board_tiles, create_game_with_template};
use ti4_view::maps::{TemplateLoader, default_template_for};
use ti4_view::projection::{project_game_view_full, project_session_update};
use ti4_view::status::ViewerRole;
use ti4_view::view::{BoardTileView, GameView};

use crate::buffer::{RESPONSE, TooLarge, UPDATE, store};

const SEATS: [&str; 8] = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ROUNDS: u32 = 50;

#[derive(Debug)]
enum Failure {
    Setup(String),
    Run(RunError),
    TooLarge(TooLarge),
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Setup(error) => write!(f, "setup: {error}"),
            Self::Run(error) => write!(f, "run: {error}"),
            Self::TooLarge(error) => error.fmt(f),
        }
    }
}

impl From<TooLarge> for Failure {
    fn from(error: TooLarge) -> Self {
        Self::TooLarge(error)
    }
}

fn setup(error: impl fmt::Display) -> Failure {
    Failure::Setup(error.to_string())
}

/// A seeded game for `players` seats on the recommended map template for that count.
fn new_game(
    content: &'static ContentStore,
    seed: u64,
    players: usize,
) -> Result<Game<'static>, Failure> {
    let seats = SEATS
        .get(..players)
        .filter(|seats| seats.len() >= 3)
        .ok_or_else(|| {
            setup(format_args!(
                "{players} players: a game has 3 to {} seats",
                SEATS.len()
            ))
        })?;
    let ids: Vec<PlayerId> = seats.iter().map(|name| PlayerId::new(*name)).collect();
    let loader = TemplateLoader::load().map_err(setup)?;
    let template = default_template_for(content, &loader, players, POK)
        .ok_or_else(|| setup(format_args!("no map template builds for {players} players")))?;
    let (state, galaxy) =
        create_game_with_template(content, &ids, seed, Some(&template)).map_err(setup)?;
    Ok(Game::with_seeded_random(state, content, seed)
        .with_sources(POK)
        .with_galaxy(galaxy))
}

/// What a view is made from while the game itself is borrowed by its run: a decider is given no
/// state, so the run leaves a copy here after each step.
struct Latest {
    state: GameState,
    tiles: Vec<BoardTileView>,
}

static LATEST: Mutex<Option<Latest>> = Mutex::new(None);

fn latest_of(game: &Game<'_>, content: &ContentStore) -> Latest {
    Latest {
        state: game.state.clone(),
        tiles: game
            .galaxy()
            .map_or_else(Vec::new, |galaxy| build_board_tiles(content, galaxy)),
    }
}

/// Serializes as the text a value displays as, without building that text first.
struct Shown<T>(T);

impl<T: fmt::Display> Serialize for Shown<T> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(&self.0)
    }
}

#[derive(Serialize)]
struct Report<'a> {
    decisions: usize,
    round: u32,
    /// Why the game stopped before its last round, when it did.
    stopped: Option<Shown<&'a RunError>>,
    state: Option<&'a GameState>,
    /// What seat `a` is shown of `state`.
    view: Option<GameView>,
}

fn respond(what: &'static str, report: &Report<'_>) -> Result<usize, Failure> {
    let mut response = RESPONSE.lock().expect("response lock");
    Ok(store(&mut response, what, "RESPONSE_CAPACITY", report)?)
}

/// Play a seeded game of `players` seats with random deciders for at most `max_steps` steps. The result
/// is the state reached and the number of decisions taken.
fn run_seeded(seed: u64, players: usize, max_steps: usize) -> Result<usize, Failure> {
    let content = ContentStore::embedded();
    let mut game = new_game(content, seed, players)?;
    match game.run(ROUNDS, max_steps) {
        Ok(_) | Err(RunError::StepLimit { .. }) => {}
        Err(error) => return Err(Failure::Run(error)),
    }
    let latest = latest_of(&game, content);
    let viewer = ViewerRole::Player(PlayerId::new("a"));
    respond(
        "the result of ti4_run_seeded",
        &Report {
            decisions: game.table.log.records.len(),
            round: game.state.round,
            stopped: None,
            state: Some(&game.state),
            view: Some(project_game_view_full(
                &latest.state,
                &viewer,
                &latest.tiles,
                None,
                &[],
            )),
        },
    )
}

/// What the seats on the host share during one game.
#[derive(Default)]
struct Host {
    /// How many choices the host was asked. The nonce of a choice is its number.
    asked: u64,
    /// The seat that was asked last: whose view the host is shown.
    viewer: Option<PlayerId>,
    /// The host left the game. Every later choice fails without asking, so the run unwinds.
    left: bool,
    /// An update did not fit its buffer. The engine's decider error carries text only, and the
    /// size must reach the host intact.
    too_large: Option<TooLarge>,
}

static HOST: Mutex<Host> = Mutex::new(Host {
    asked: 0,
    viewer: None,
    left: false,
    too_large: None,
});

fn host() -> std::sync::MutexGuard<'static, Host> {
    HOST.lock().expect("host lock")
}

/// A seat answered by the host: each choice is handed out and the game waits for the answer.
struct HostDecider;

impl Decider for HostDecider {
    fn choose(&mut self, choice: &Choice) -> Result<ChoiceOption, IllegalChoice> {
        let failed = |reason: &str| IllegalChoice::DeciderFailed {
            player: choice.player.clone(),
            prompt: choice.prompt.clone(),
            reason: reason.to_owned(),
        };
        let nonce = {
            let mut host = host();
            if host.left {
                return Err(failed(LEFT));
            }
            host.asked += 1;
            host.viewer = Some(choice.player.clone());
            host.asked
        };
        if let Err(error) = offer(choice, nonce) {
            let mut host = host();
            host.too_large = Some(error);
            host.left = true;
            return Err(failed("what the host is shown did not fit its buffer"));
        }
        // No lock is held while the host is asked: it reads the update while this stack is parked.
        let index = host_ask();
        UPDATE.lock().expect("update lock").clear();
        let Ok(index) = usize::try_from(index) else {
            host().left = true;
            return Err(failed(LEFT));
        };
        choice
            .options
            .get(index)
            .cloned()
            .ok_or_else(|| failed("the host answered with an index that is no option"))
    }
}

const LEFT: &str = "the host left the game";

/// Write what the asked seat is shown, and its choice, into the update buffer.
fn offer(choice: &Choice, nonce: u64) -> Result<(), TooLarge> {
    let latest = LATEST.lock().expect("latest lock");
    let Some(latest) = latest.as_ref() else {
        return Ok(());
    };
    let mut number = NonceText::default();
    let _ = write!(number, "{nonce}");
    let update = project_session_update(
        &latest.state,
        &ViewerRole::Player(choice.player.clone()),
        Some((choice, number.as_str())),
        &latest.tiles,
    );
    store(
        &mut UPDATE.lock().expect("update lock"),
        "the update for the host",
        "UPDATE_CAPACITY",
        &update,
    )?;
    Ok(())
}

/// The decimal digits of a `u64`, without an allocation.
#[derive(Default)]
struct NonceText {
    bytes: [u8; 20],
    len: usize,
}

impl NonceText {
    fn as_str(&self) -> &str {
        std::str::from_utf8(&self.bytes[..self.len]).expect("digits are ASCII")
    }
}

impl fmt::Write for NonceText {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        let end = self.len + text.len();
        self.bytes
            .get_mut(self.len..end)
            .ok_or(fmt::Error)?
            .copy_from_slice(text.as_bytes());
        self.len = end;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
fn host_ask() -> i32 {
    #[link(wasm_import_module = "host")]
    unsafe extern "C" {
        /// Returns the index of the chosen option, or a negative number to leave the game. The
        /// host may suspend the caller (JSPI).
        safe fn ask() -> i32;
    }
    ask()
}

/// The host of a native run: it is given the update and answers like the wasm import.
#[cfg(not(target_arch = "wasm32"))]
type NativeHost = Box<dyn FnMut(&str) -> i32 + Send>;

#[cfg(not(target_arch = "wasm32"))]
static NATIVE_HOST: Mutex<Option<NativeHost>> = Mutex::new(None);

/// Answer the choices of [`ti4_play`] in a native run. Without a host the first option is taken.
#[cfg(not(target_arch = "wasm32"))]
pub fn set_native_host(host: impl FnMut(&str) -> i32 + Send + 'static) {
    *NATIVE_HOST.lock().expect("native host lock") = Some(Box::new(host));
}

#[cfg(not(target_arch = "wasm32"))]
fn host_ask() -> i32 {
    let shown = update();
    NATIVE_HOST
        .lock()
        .expect("native host lock")
        .as_mut()
        .map_or(0, |host| host(&shown))
}

/// Play a seeded game of `players` seats to its end. A seat whose bit is set in `human_mask`
/// (bit 0 is seat `a`) is answered by the host; the other seats decide at random.
fn play(seed: u64, players: usize, human_mask: u32) -> Result<usize, Failure> {
    let content = ContentStore::embedded();
    let mut game = new_game(content, seed, players)?;
    for (index, seat) in SEATS.iter().take(players).enumerate() {
        if human_mask >> index & 1 == 1 {
            game.table.seat(PlayerId::new(*seat), Box::new(HostDecider));
        }
    }
    *host() = Host::default();
    *LATEST.lock().expect("latest lock") = Some(latest_of(&game, content));
    // A choice inside a step is offered on the position it is asked in, not on the one the step
    // began with.
    game.table.on_observed_offer(|_, state| {
        if let Some(latest) = LATEST.lock().expect("latest lock").as_mut() {
            latest.state.clone_from(state);
        }
    });
    let target = game.state.round.saturating_add(ROUNDS);
    let mut stopped = None;
    while stopped.is_none() && game.state.round < target && !game.state.finished && !host().left {
        stopped = game.step().error.map(RunError::from);
        if let Some(latest) = LATEST.lock().expect("latest lock").as_mut() {
            latest.state.clone_from(&game.state);
        }
    }
    let (viewer, too_large) = {
        let mut host = host();
        (host.viewer.take(), host.too_large.take())
    };
    // A buffer that was too small fails the call. It must not sit in a field of a result.
    if let Some(error) = too_large {
        return Err(error.into());
    }
    // The last update: where the game stopped, with nothing left to answer.
    let viewer = viewer.map_or(ViewerRole::Spectator, ViewerRole::Player);
    let tiles = latest_of(&game, content).tiles;
    store(
        &mut UPDATE.lock().expect("update lock"),
        "the update for the host",
        "UPDATE_CAPACITY",
        &project_session_update(&game.state, &viewer, None, &tiles),
    )?;
    respond(
        "the result of ti4_play",
        &Report {
            decisions: game.table.log.records.len(),
            round: game.state.round,
            stopped: stopped.as_ref().map(Shown),
            state: None,
            view: None,
        },
    )
}

/// The status of an export: a length, negated when the response buffer holds an error text.
fn status(result: Result<usize, Failure>) -> i32 {
    let length = |bytes: usize| i32::try_from(bytes).expect("a buffer is smaller than 2 GiB");
    match result {
        Ok(bytes) => length(bytes),
        Err(failure) => {
            let mut response = RESPONSE.lock().expect("response lock");
            response.clear();
            let _ = write!(response, "{failure}");
            -length(response.len())
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ti4_run_seeded(seed: u32, players: u32, max_steps: u32) -> i32 {
    status(run_seeded(
        u64::from(seed),
        players as usize,
        max_steps as usize,
    ))
}

/// Play a game to its end, asking the host for the seats in `human_mask`. With JSPI the export is
/// wrapped in `WebAssembly.promising` and the import `host.ask` in `WebAssembly.Suspending`.
#[unsafe(no_mangle)]
pub extern "C" fn ti4_play(seed: u32, players: u32, human_mask: u32) -> i32 {
    status(play(u64::from(seed), players as usize, human_mask))
}

/// Where every export leaves its result or its error. Constant for the life of the instance.
#[unsafe(no_mangle)]
pub extern "C" fn ti4_response_ptr() -> *const u8 {
    RESPONSE.lock().expect("response lock").as_ptr()
}

/// Where the update for the host is kept: while the game is suspended in a choice, and after
/// [`ti4_play`] has returned. Constant for the life of the instance.
#[unsafe(no_mangle)]
pub extern "C" fn ti4_update_ptr() -> *const u8 {
    UPDATE.lock().expect("update lock").as_ptr()
}

/// The length of that update, or zero when there is none.
#[unsafe(no_mangle)]
pub extern "C" fn ti4_update_len() -> u32 {
    u32::try_from(UPDATE.lock().expect("update lock").len()).expect("a buffer is small")
}

/// The update for the host, for callers on the native side.
#[must_use]
pub fn update() -> String {
    String::from_utf8_lossy(UPDATE.lock().expect("update lock").as_bytes()).into_owned()
}

/// The response of the last export, for callers on the native side.
///
/// # Errors
/// The error text, when `status` is negative.
pub fn response(status: i32) -> Result<String, String> {
    let response = RESPONSE.lock().expect("response lock");
    let text = String::from_utf8_lossy(response.as_bytes()).into_owned();
    if status < 0 { Err(text) } else { Ok(text) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_eight_player_game_runs_with_random_deciders() {
        let content = ContentStore::embedded();
        let mut game = new_game(content, 3, 8).unwrap();
        assert_eq!(game.state.players.len(), 8);
        match game.run(ROUNDS, 2000) {
            Ok(_) | Err(RunError::StepLimit { .. }) => {}
            Err(error) => panic!("{error}"),
        }
        assert!(game.state.round > 1, "the game left its first round");
    }

    /// One test for everything that plays through the host: the host and the update buffer are
    /// statics, so two such tests would not be independent.
    #[test]
    fn the_host_is_asked_for_its_seats_can_leave_and_a_replay_is_the_same_game() {
        use std::sync::{Arc, Mutex};
        let seen = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let sink = seen.clone();
        set_native_host(move |update| {
            let mut seen = sink.lock().unwrap();
            seen.push(serde_json::from_str(update).unwrap());
            if seen.len() == 12 { -1 } else { 0 }
        });
        // Seats a and c.
        let status = ti4_play(3, 8, 0b101);
        let report: serde_json::Value = serde_json::from_str(&response(status).unwrap()).unwrap();
        assert!(
            report["stopped"]
                .as_str()
                .is_some_and(|text| text.contains(LEFT)),
            "{report}"
        );
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 12);
        let mut seats = std::collections::BTreeSet::new();
        for (index, update) in seen.iter().enumerate() {
            let seat = update["pending_choice"]["choice"]["player"]
                .as_str()
                .unwrap();
            seats.insert(seat.to_owned());
            assert_eq!(update["viewer"]["seat"], seat);
            assert_eq!(update["pending_choice"]["nonce"], (index + 1).to_string());
            assert_eq!(update["turn_status"]["seat"], seat);
            assert_eq!(update["view"]["players"].as_array().unwrap().len(), 8);
        }
        assert!(
            seats.iter().all(|seat| seat == "a" || seat == "c"),
            "{seats:?}"
        );
        // After the game: the last update, with nothing to answer.
        let last: serde_json::Value = serde_json::from_str(&update()).unwrap();
        assert!(last.get("pending_choice").is_none());
        assert_eq!(last["viewer"]["role"], "player");
        drop(seen);

        // A saved game is the seed and the ids of the host's answers. Played again with them,
        // the game asks the same choices and reaches the same position.
        const ANSWERS: usize = 40;
        let options = |update: &serde_json::Value| -> Vec<String> {
            update["pending_choice"]["choice"]["options"]
                .as_array()
                .unwrap()
                .iter()
                .map(|option| option["id"].as_str().unwrap().to_owned())
                .collect()
        };
        let first = Arc::new(Mutex::new((Vec::<String>::new(), String::new())));
        let sink = first.clone();
        set_native_host(move |update| {
            let (answers, reached) = &mut *sink.lock().unwrap();
            if answers.len() == ANSWERS {
                update.clone_into(reached);
                return -1;
            }
            let ids = options(&serde_json::from_str(update).unwrap());
            let index = (answers.len() * 7) % ids.len();
            answers.push(ids[index].clone());
            i32::try_from(index).unwrap()
        });
        ti4_play(3, 8, 1);
        let (answers, reached) = first.lock().unwrap().clone();
        assert_eq!(answers.len(), ANSWERS);

        let again = Arc::new(Mutex::new((0, String::new())));
        let sink = again.clone();
        set_native_host(move |update| {
            let (asked, reached) = &mut *sink.lock().unwrap();
            let Some(wanted) = answers.get(*asked) else {
                update.clone_into(reached);
                return -1;
            };
            *asked += 1;
            let ids = options(&serde_json::from_str(update).unwrap());
            let index = ids.iter().position(|id| id == wanted);
            i32::try_from(index.expect("the replayed game offers the saved answer")).unwrap()
        });
        ti4_play(3, 8, 1);
        assert_eq!(again.lock().unwrap().1, reached);
        assert!(
            reached.contains("\"nonce\":\"41\""),
            "the position after 40 answers"
        );
    }
}
