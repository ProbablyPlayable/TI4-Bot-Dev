//! The position that a save keeps: the game at its last quiet step, with what the session and the
//! play loop hold there. A resume can go on from it and replay only the decisions after it.
//!
//! The play loop takes the game after every step where [`StoredPosition::quiet`] gives it, the
//! session can go on from there ([`crate::host_session::HostSession::may_hold`]) and every bot
//! seat carries nothing ([`ti4_host::bots::Bot::carries_nothing`]). The session holds the last one
//! ([`Held`]). It is in memory only until a save writes it ([`SavedPosition`]). The session holds
//! it, not the play loop, so `save_state` reads it while the game is parked and does not touch
//! the game.
//!
//! A save writes the held position as JSON text ([`Written`]) only when it is
//! [`POSITION_EVERY`] decisions newer than the text it wrote last; else it writes that text again.
//!
//! A resume reads the position ([`read`]) when it is of this engine and [`Position::fits`] the
//! save: the play loop starts from it and replays only the decisions after it. A new run of a
//! history change gets the held position the same way (`Restart::position`). Anything else is
//! ignored, and the game replays from the seed.
//!
//! An MLP seat carries its power map once it has read one. That map is refreshed only where the
//! board changed, and while a tactical action is open the value from before it is returned, so a
//! seat with a new pipeline would read another value and could decide differently. The carry
//! (the power maps of every seat in every system) has no data form. So a table with an MLP seat
//! gets no position after that seat's first decision.

use serde::{Deserialize, Serialize};
use ti4_engine::choice::DecisionRecord;
use ti4_engine::game::QuietGame;
use ti4_host::planning::undo::UndoEntry;
use ti4_host::protocol::server::GameEvent;
use ti4_host::step_snapshot::StoredPosition;
use ti4_model::id::PlayerId;
use ti4_model::state::Phase;

/// How many decisions the held position is ahead of the text that a save writes before the save
/// writes it again. Writing a position late in a game costs tens of ms (it is about 2 MB of
/// JSON), so not every save writes a new one; a resume replays at most this many decisions more.
pub const POSITION_EVERY: usize = 64;

/// The position of a save (`HostSave::position`). A resume reads it only with the same engine:
/// `build` and `content_digest` as the save's `engine`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
pub struct SavedPosition {
    pub build: String,
    pub content_digest: String,
    /// The number of decisions of the save that the position was taken after.
    pub log_len: usize,
    /// The [`Position`] as JSON text. It is text so that the page keeps it as it is: the
    /// engine's numbers may be larger than a JavaScript number holds.
    pub data: String,
}

/// The game at a quiet step and what the session and the play loop hold there. Restored with the
/// game of the save's setup and the save's fields, it is the run after `log_len` decisions, and
/// the decisions after them are replayed from the save's log.
///
/// Every piece of state of a hosted game, at a quiet step:
///
/// | State | Here |
/// |---|---|
/// | The engine (`Game`): state, streams, dice, counters, resolver, table state | stored ([`StoredPosition`], [`QuietGame`]) |
/// | The engine's decision log | stored (`records`) |
/// | The engine's open windows, the deck reserve of a turn redo | empty at a quiet step |
/// | The galaxy, the content, the sources | rebuilt from the save's setup |
/// | The engine's table: the seats, its hooks | rebuilt (`host_table` in `lib.rs`) |
/// | `HostSession`: `decision_log` | stored (`records`) |
/// | `events` | stored |
/// | `event_counter`, `rolls_seen`, `prev_phase`, `prev_round` | stored |
/// | `answers` | rebuilt: the decisions of the undo entries ([`Position::answers`]) |
/// | `undo` (`UndoTrack`, local rules) | stored: its entries; `since` from the save's last switch |
/// | `viewer` | stored |
/// | `identity`, `switches`, `version`, `generation`, `redo`, `undone`, `staged`, the Never cards | from the save |
/// | `saved_log`, `saved_events`, `quiet` | from the save (the replay of the rest) |
/// | `tiles`, `layout`, `galaxy` | rebuilt from the save's setup |
/// | `state` | rebuilt: the restored game's state |
/// | `selected`, `declined`, `awaiting`, `pending`, `waiting`, `undoing` | empty at a held step |
/// | `marks` | empty: the checkpoints start at the restored game |
/// | `scripts`, `batch`, `opening`, `auto_resolved` | not in a save: a resume has none, as after a full replay |
/// | `can_undo`, `resuming`, `fresh`, `staged_told`, `finished`, `error`, `out` | set by the new run |
/// | `Host`: `asked`, `decided`, `viewer` | stored (`play`) |
/// | `switches` | from the save; when each came into force (`asked`) stored |
/// | `players`, `humans`, `seed`, `order`, `table`, `saved` | from the save's setup and log |
/// | `left`, `undo`, `paused`, `switched`, `undo_to`, `rollback`, `script`, `preload_left` | empty at a held step |
/// | `recent`, `oldest` | empty: the checkpoints start at the restored game |
/// | `RANDOM` (the random seats' stream) | stored: its position |
/// | `BOTS` | rebuilt from the save's setup (`Bot::new` on the opening state); every carry is empty at a held step |
/// | `CHECKPOINTS`, `SINCE`, `DRAFT_BASE`, `LATEST` | rebuilt from the restored game |
/// | `SECONDARY` | rebuilt from the restored game (`watch_secondary`) |
/// | `STEPPING`, `NEVER` | from the start request and the save |
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    /// The engine, with the length and the hash of the log it was taken after.
    pub game: StoredPosition,
    /// The decisions it was taken after, whole: the engine's log and the session's.
    pub records: Vec<DecisionRecord>,
    pub session: SessionPart,
    pub play: PlayPart,
}

/// What the session holds at the position.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPart {
    /// The seat the game is shown as.
    pub viewer: PlayerId,
    /// The events, with their times and versions.
    pub events: Vec<GameEvent>,
    pub event_counter: u64,
    pub rolls_seen: usize,
    pub prev_phase: Phase,
    pub prev_round: u32,
    /// How many of the save's answers were given.
    pub answers: usize,
    /// The entries of the undo track.
    pub undo: Vec<UndoEntry>,
}

/// What the play loop of `lib.rs` holds at the position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayPart {
    /// How many choices the page was asked (`Host::asked`).
    pub asked: u64,
    /// How many decisions the seats made (`Host::decided`).
    pub decided: u64,
    /// The seat that was asked last (`Host::viewer`).
    pub viewer: Option<PlayerId>,
    /// The position of the random seats' stream (`RANDOM`).
    pub random: Option<u128>,
    /// For each switch of the seats that was in force, how many choices the page had been asked
    /// when it came into force (`Switch::asked`), in order.
    pub switches_asked: Vec<Option<u64>>,
}

/// The position as the session holds it between two saves: the game, and the lengths of what the
/// session keeps anyway. A save writes it with those prefixes ([`Held::write`]).
#[derive(Debug, Clone)]
pub struct Held {
    pub game: QuietGame,
    /// The decisions, events, answers and undo entries the session had.
    pub log_len: usize,
    pub events: usize,
    pub answers: usize,
    pub undo: usize,
    pub viewer: PlayerId,
    pub event_counter: u64,
    pub rolls_seen: usize,
    pub prev_phase: Phase,
    pub prev_round: u32,
    pub play: PlayPart,
}

impl Held {
    /// Whether the session still has the prefixes the position was taken with: an undo to a
    /// checkpoint before it cuts them.
    #[must_use]
    pub const fn kept_by(&self, decisions: usize, events: usize, answers: usize) -> bool {
        self.log_len <= decisions && self.events <= events && self.answers <= answers
    }

    /// The position, with the prefixes of the session's log, events and undo entries.
    #[must_use]
    pub fn write(
        &self,
        records: &[DecisionRecord],
        events: &[GameEvent],
        undo: &[UndoEntry],
    ) -> Position {
        let records = records[..self.log_len].to_vec();
        Position {
            game: StoredPosition::new(self.game.clone(), &records),
            records,
            session: SessionPart {
                viewer: self.viewer.clone(),
                events: events[..self.events].to_vec(),
                event_counter: self.event_counter,
                rolls_seen: self.rolls_seen,
                prev_phase: self.prev_phase,
                prev_round: self.prev_round,
                answers: self.answers,
                undo: undo[..self.undo].to_vec(),
            },
            play: self.play.clone(),
        }
    }
}

impl Held {
    /// The position as the session holds it, from a stored one.
    #[must_use]
    pub fn of(position: &Position) -> Self {
        let session = &position.session;
        Self {
            game: position.game.game.clone(),
            log_len: position.game.log_len,
            events: session.events.len(),
            answers: session.answers,
            undo: session.undo.len(),
            viewer: session.viewer.clone(),
            event_counter: session.event_counter,
            rolls_seen: session.rolls_seen,
            prev_phase: session.prev_phase,
            prev_round: session.prev_round,
            play: position.play.clone(),
        }
    }
}

/// The text of a position that a save wrote, with the lengths of what the session held there: a
/// save writes it again until the held position is [`POSITION_EVERY`] decisions newer.
#[derive(Debug, Clone)]
pub struct Written {
    pub saved: SavedPosition,
    pub log_len: usize,
    pub events: usize,
    pub answers: usize,
}

impl Written {
    #[must_use]
    pub fn new(held: &Held, saved: SavedPosition) -> Self {
        Self {
            saved,
            log_len: held.log_len,
            events: held.events,
            answers: held.answers,
        }
    }

    /// Whether the session still has the prefixes the position was taken with
    /// ([`Held::kept_by`]).
    #[must_use]
    pub const fn kept_by(&self, decisions: usize, events: usize, answers: usize) -> bool {
        self.log_len <= decisions && self.events <= events && self.answers <= answers
    }
}

impl Position {
    /// Whether this is the run after its decisions for a save that gives `log` again (every
    /// decision, of every seat) or, with no log, the person's `answers`, with `switches` changes
    /// of the seats. The decisions of the position must be the first ones of `log`; with
    /// answers, the person's answers among them must be the first ones of `answers` (the other
    /// seats decide the same again from the seed). The stored records must have the stored hash,
    /// and the counters must agree with them.
    #[must_use]
    pub fn fits(&self, log: &[String], answers: &[String], switches: usize) -> bool {
        let len = self.game.log_len;
        let session = &self.session;
        let counted = self.records.len() == len
            && self.play.decided == len as u64
            && session.undo.len() == session.answers
            && self.play.switches_asked.len() <= switches
            && session.undo.iter().all(|entry| entry.decision < len);
        let prefix = if log.is_empty() {
            session.answers <= answers.len()
                && session
                    .undo
                    .iter()
                    .zip(answers)
                    .all(|(entry, answer)| self.records[entry.decision].chosen == *answer)
        } else {
            len <= log.len()
                && self
                    .records
                    .iter()
                    .zip(log)
                    .all(|(record, id)| record.chosen == *id)
        };
        counted && prefix && self.game.fits(&self.records)
    }

    /// The person's answers among the decisions of the position, in order.
    #[must_use]
    pub fn answers(&self) -> Vec<String> {
        self.session
            .undo
            .iter()
            .map(|entry| self.records[entry.decision].chosen.clone())
            .collect()
    }
}

/// The position of a save (`Resume::position`, as the page sent it) when a resume can start from
/// it: it reads as a [`SavedPosition`] of the engine `engine` (`build`, `content_digest`), its
/// `data` reads as a [`Position`] of `log_len` decisions, and it [`fits`](Position::fits) the save.
/// `None` otherwise: the game replays from the seed.
#[must_use]
pub fn read(
    value: serde_json::Value,
    engine: &serde_json::Value,
    log: &[String],
    answers: &[String],
    switches: usize,
) -> Option<(Position, SavedPosition)> {
    let saved: SavedPosition = serde_json::from_value(value).ok()?;
    let same =
        |key: &str, ours: &str| engine.get(key).and_then(serde_json::Value::as_str) == Some(ours);
    if !same("build", &saved.build) || !same("content_digest", &saved.content_digest) {
        return None;
    }
    let position: Position = serde_json::from_str(&saved.data).ok()?;
    (position.game.log_len == saved.log_len && position.fits(log, answers, switches))
        .then_some((position, saved))
}
