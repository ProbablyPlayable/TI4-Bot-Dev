//! The engine behind a wasm boundary: a size and JSPI spike, not yet the hotseat interface.
//! See `README.md` for the measurements.
//!
//! The boundary is the plain C ABI rather than `wasm-bindgen`. An export returns a status: zero
//! or more is the length of a JSON result, less than zero is the negated length of an error text.
//! Either is read from the response buffer, whose address never changes ([`ti4_response_ptr`]).
//!
//! # Memory
//!
//! This crate does not allocate for its own data: results, the pending choice and the view of the
//! asked seat are written straight into the fixed buffers of [`buffer`]. What still allocates
//! here is what the interfaces of the engine and of `ti4-view` ask for (owned ids, the decider
//! box, the copy of the state, a projected view) and the text of an error.

pub mod buffer;

use std::fmt::{self, Write as _};
use std::sync::Mutex;

use serde::Serialize;
use ti4_content::ContentStore;
use ti4_engine::choice::{Choice, ChoiceOption, Decider, IllegalChoice, SeatObservation};
use ti4_engine::game::{Game, RunError};
use ti4_engine::setup::start_game_seeded;
use ti4_model::content_types::DEFAULT;
use ti4_model::id::PlayerId;
use ti4_model::state::GameState;
use ti4_view::map::build_board_tiles;
use ti4_view::projection::project_game_view_full;
use ti4_view::status::ViewerRole;
use ti4_view::view::{BoardTileView, GameView};

use crate::buffer::{PENDING, RESPONSE, TooLarge, VIEW, store};

const SEATS: [&str; 6] = ["a", "b", "c", "d", "e", "f"];
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

fn new_game(content: &'static ContentStore, seed: u64) -> Result<Game<'static>, Failure> {
    let players: Vec<PlayerId> = SEATS.iter().map(|name| PlayerId::new(*name)).collect();
    let assignments = ti4_engine::seating::seat_in_scope(&players);
    let mut state = start_game_seeded(content, &players, DEFAULT, None, seed).map_err(setup)?;
    for (player, assigned) in &assignments {
        state
            .player_mut(player)
            .ok_or_else(|| setup(format_args!("missing seat {player}")))?
            .faction = assigned.clone();
    }
    ti4_engine::promissory::deal(&mut state, content, DEFAULT);

    let filler: Vec<String> = ti4_engine::seating::map_filler(content, 30, DEFAULT, seed)
        .into_iter()
        .map(|system| system.to_string())
        .collect();
    let borrowed: Vec<&str> = filler.iter().map(String::as_str).collect();
    let galaxy = ti4_engine::seating::build_board(content, &assignments, &borrowed, DEFAULT)
        .map_err(setup)?;
    for (player, assigned) in &assignments {
        ti4_engine::seating::deploy(&mut state, content, player, assigned, DEFAULT)
            .map_err(setup)?;
    }
    Ok(Game::with_seeded_random(state, content, seed)
        .with_sources(DEFAULT)
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

/// Play a seeded six-player game with random deciders for at most `max_steps` steps. The result
/// is the state reached and the number of decisions taken.
fn run_seeded(seed: u64, max_steps: usize) -> Result<usize, Failure> {
    let content = ContentStore::embedded();
    let mut game = new_game(content, seed)?;
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

/// Set by [`HostDecider`] when a choice or a view did not fit, because the engine's decider error carries
/// text only and the size must reach the host intact.
static HOST_TOO_LARGE: Mutex<Option<TooLarge>> = Mutex::new(None);

/// Seat `a` answered by the host: each choice is handed out and the game waits for the answer.
struct HostDecider {
    asked: usize,
    limit: usize,
}

impl HostDecider {
    /// Hand the choice and the view of its seat to the host and wait for the answer. `seen` is
    /// absent at the few sites where the engine has no position to offer.
    fn ask(
        &mut self,
        choice: &Choice,
        seen: Option<&SeatObservation<'_>>,
    ) -> Result<ChoiceOption, IllegalChoice> {
        let failed = |reason: String| IllegalChoice::DeciderFailed {
            player: choice.player.clone(),
            prompt: choice.prompt.clone(),
            reason,
        };
        if self.asked >= self.limit {
            return Err(failed("host choice limit reached".to_owned()));
        }
        self.asked += 1;
        // The locks are released before the host is asked: the host reads the pending choice and
        // the view while this stack is parked.
        let stored = offer(choice, seen);
        if let Err(error) = stored {
            *HOST_TOO_LARGE.lock().expect("too large lock") = Some(error);
            return Err(failed("what the host is shown did not fit its buffer".to_owned()));
        }
        let index = host_ask();
        PENDING.lock().expect("pending lock").clear();
        VIEW.lock().expect("view lock").clear();
        usize::try_from(index)
            .ok()
            .and_then(|index| choice.options.get(index))
            .cloned()
            .ok_or_else(|| failed(format!("the host answered {index}, which is no option")))
    }
}

/// Write the choice and the view of its seat into their buffers.
fn offer(choice: &Choice, seen: Option<&SeatObservation<'_>>) -> Result<(), TooLarge> {
    store(
        &mut PENDING.lock().expect("pending lock"),
        "the pending choice",
        "PENDING_CAPACITY",
        choice,
    )?;
    let mut latest = LATEST.lock().expect("latest lock");
    let Some(latest) = latest.as_mut() else {
        return Ok(());
    };
    // A nested choice can pause a step before the run has copied the new state. The public
    // combat boundary is kept current all the same, as the server does.
    if let Some(seen) = seen {
        latest.state.active_space_combat = seen.space_battle();
        latest.state.active_invasion = seen.invasion();
    }
    let view = project_game_view_full(
        &latest.state,
        &ViewerRole::Player(choice.player.clone()),
        &latest.tiles,
        Some(choice),
        &[],
    );
    store(
        &mut VIEW.lock().expect("view lock"),
        "the view of the asked seat",
        "VIEW_CAPACITY",
        &view,
    )?;
    Ok(())
}

impl Decider for HostDecider {
    fn choose(&mut self, choice: &Choice) -> Result<ChoiceOption, IllegalChoice> {
        self.ask(choice, None)
    }

    fn choose_seeing(
        &mut self,
        choice: &Choice,
        seen: &SeatObservation<'_>,
    ) -> Result<ChoiceOption, IllegalChoice> {
        self.ask(choice, Some(seen))
    }
}

#[cfg(target_arch = "wasm32")]
fn host_ask() -> i32 {
    #[link(wasm_import_module = "host")]
    unsafe extern "C" {
        /// Returns the index of the chosen option. The host may suspend the caller (JSPI).
        safe fn ask() -> i32;
    }
    ask()
}

#[cfg(not(target_arch = "wasm32"))]
fn host_ask() -> i32 {
    0
}

/// Play with seat `a` on the host until it has answered `choices` choices.
fn play_hosted(seed: u64, choices: usize) -> Result<usize, Failure> {
    let content = ContentStore::embedded();
    let mut game = new_game(content, seed)?;
    game.table.seat(
        PlayerId::new("a"),
        Box::new(HostDecider {
            asked: 0,
            limit: choices,
        }),
    );
    *LATEST.lock().expect("latest lock") = Some(latest_of(&game, content));
    let target = game.state.round.saturating_add(ROUNDS);
    let mut stopped = None;
    while stopped.is_none() && game.state.round < target && !game.state.finished {
        stopped = game.step().error.map(RunError::from);
        if let Some(latest) = LATEST.lock().expect("latest lock").as_mut() {
            latest.state.clone_from(&game.state);
        }
    }
    // A buffer that was too small fails the call. It must not sit in a field of a result.
    if let Some(error) = HOST_TOO_LARGE.lock().expect("too large lock").take() {
        return Err(error.into());
    }
    respond(
        "the result of ti4_play_hosted",
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
pub extern "C" fn ti4_run_seeded(seed: u32, max_steps: u32) -> i32 {
    status(run_seeded(u64::from(seed), max_steps as usize))
}

#[unsafe(no_mangle)]
pub extern "C" fn ti4_play_hosted(seed: u32, choices: u32) -> i32 {
    status(play_hosted(u64::from(seed), choices as usize))
}

/// Where every export leaves its result or its error. Constant for the life of the instance.
#[unsafe(no_mangle)]
pub extern "C" fn ti4_response_ptr() -> *const u8 {
    RESPONSE.lock().expect("response lock").as_ptr()
}

/// Where the choice the game is suspended in is kept. Constant for the life of the instance.
#[unsafe(no_mangle)]
pub extern "C" fn ti4_pending_ptr() -> *const u8 {
    PENDING.lock().expect("pending lock").as_ptr()
}

/// The length of the pending choice, or zero when the game is not waiting for the host.
#[unsafe(no_mangle)]
pub extern "C" fn ti4_pending_len() -> u32 {
    u32::try_from(PENDING.lock().expect("pending lock").len()).expect("a buffer is small")
}

/// Where the view of the asked seat is kept while the game is suspended in a choice. Constant for
/// the life of the instance.
#[unsafe(no_mangle)]
pub extern "C" fn ti4_view_ptr() -> *const u8 {
    VIEW.lock().expect("view lock").as_ptr()
}

/// The length of that view, or zero when the game is not waiting for the host.
#[unsafe(no_mangle)]
pub extern "C" fn ti4_view_len() -> u32 {
    u32::try_from(VIEW.lock().expect("view lock").len()).expect("a buffer is small")
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
