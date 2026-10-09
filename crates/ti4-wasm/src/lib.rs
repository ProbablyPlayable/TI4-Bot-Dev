//! The engine behind a wasm boundary: a size and JSPI spike, not yet the hotseat interface.
//! See `README.md` for the measurements.
//!
//! The boundary is the plain C ABI rather than `wasm-bindgen`. An export returns a status: zero
//! or more is the length of a JSON result, less than zero is the negated length of an error text.
//! Either is read from the response buffer, whose address never changes ([`ti4_response_ptr`]).
//!
//! # Memory
//!
//! This crate does not allocate for its own data: results and the pending choice are written
//! straight into the fixed buffers of [`buffer`]. What still allocates here is what the engine's
//! interface asks for (owned ids, the decider box) and the text of an error.

pub mod buffer;

use std::fmt::{self, Write as _};
use std::sync::Mutex;

use serde::Serialize;
use ti4_content::ContentStore;
use ti4_engine::choice::{Choice, ChoiceOption, Decider, IllegalChoice};
use ti4_engine::game::{Game, RunError};
use ti4_engine::setup::start_game_seeded;
use ti4_model::content_types::DEFAULT;
use ti4_model::id::PlayerId;
use ti4_model::state::GameState;

use crate::buffer::{PENDING, RESPONSE, TooLarge, store};

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
}

fn respond(what: &'static str, report: &Report<'_>) -> Result<usize, Failure> {
    let mut response = RESPONSE.lock().expect("response lock");
    Ok(store(&mut response, what, "RESPONSE_CAPACITY", report)?)
}

/// Play a seeded six-player game with random deciders for at most `max_steps` steps. The result
/// is the state reached and the number of decisions taken.
fn run_seeded(seed: u64, max_steps: usize) -> Result<usize, Failure> {
    let mut game = new_game(ContentStore::embedded(), seed)?;
    match game.run(ROUNDS, max_steps) {
        Ok(_) | Err(RunError::StepLimit { .. }) => {}
        Err(error) => return Err(Failure::Run(error)),
    }
    respond(
        "the result of ti4_run_seeded",
        &Report {
            decisions: game.table.log.records.len(),
            round: game.state.round,
            stopped: None,
            state: Some(&game.state),
        },
    )
}

/// Set by [`HostDecider`] when a choice did not fit, because the engine's decider error carries
/// text only and the size must reach the host intact.
static PENDING_TOO_LARGE: Mutex<Option<TooLarge>> = Mutex::new(None);

/// Seat `a` answered by the host: each choice is handed out and the game waits for the answer.
struct HostDecider {
    asked: usize,
    limit: usize,
}

impl Decider for HostDecider {
    fn choose(&mut self, choice: &Choice) -> Result<ChoiceOption, IllegalChoice> {
        let failed = |reason: String| IllegalChoice::DeciderFailed {
            player: choice.player.clone(),
            prompt: choice.prompt.clone(),
            reason,
        };
        if self.asked >= self.limit {
            return Err(failed("host choice limit reached".to_owned()));
        }
        self.asked += 1;
        // The lock is released before the host is asked: the host reads the pending choice while
        // this stack is parked.
        let stored = store(
            &mut PENDING.lock().expect("pending lock"),
            "the pending choice",
            "PENDING_CAPACITY",
            choice,
        );
        if let Err(error) = stored {
            *PENDING_TOO_LARGE.lock().expect("pending lock") = Some(error);
            return Err(failed("the pending choice did not fit its buffer".to_owned()));
        }
        let index = host_ask();
        PENDING.lock().expect("pending lock").clear();
        usize::try_from(index)
            .ok()
            .and_then(|index| choice.options.get(index))
            .cloned()
            .ok_or_else(|| failed(format!("the host answered {index}, which is no option")))
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
    let mut game = new_game(ContentStore::embedded(), seed)?;
    game.table.seat(
        PlayerId::new("a"),
        Box::new(HostDecider {
            asked: 0,
            limit: choices,
        }),
    );
    let stopped = game.run(ROUNDS, 100_000).err();
    // A buffer that was too small fails the call. It must not sit in a field of a result.
    if let Some(error) = PENDING_TOO_LARGE.lock().expect("pending lock").take() {
        return Err(error.into());
    }
    respond(
        "the result of ti4_play_hosted",
        &Report {
            decisions: game.table.log.records.len(),
            round: game.state.round,
            stopped: stopped.as_ref().map(Shown),
            state: None,
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

/// The response of the last export, for callers on the native side.
///
/// # Errors
/// The error text, when `status` is negative.
pub fn response(status: i32) -> Result<String, String> {
    let response = RESPONSE.lock().expect("response lock");
    let text = String::from_utf8_lossy(response.as_bytes()).into_owned();
    if status < 0 { Err(text) } else { Ok(text) }
}
