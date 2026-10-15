//! A copy of the live game at a step boundary, so a batch check need not replay the whole game.
//!
//! The session worker is the only caller of `Game::step`. At the top of each loop iteration,
//! before `step()`, the game is provably between steps, so a full copy can be taken there. A
//! batch check later forks that copy, replays only the decisions recorded since (the tail of
//! the step in progress) and then runs the staged choices (`batch::simulate`).
//!
//! The copy carries no decision log (the largest part of it, and the session already holds the
//! log): it records how long the log was and the last record, and a check rebuilds the log from
//! the prefix it validates against. A snapshot is used only when
//!
//! - it belongs to the history generation being checked,
//! - the log it was taken at is a prefix of the log being checked (same length bound and same
//!   last record), and
//! - it was taken with no deferred RNG work pending (`Game::flush_rng_sync` first).
//!
//! Every history change except appending decisions (undo, redo, restore, turn redo, batch
//! commit, recovery, history replacement) replaces the whole session, whose shared state starts
//! with no snapshot; the appends keep the prefix property, which is what `is_valid_for` checks.
//! Anything else falls back to the full replay.
//!
//! [`StoredPosition`] is the stored kind: a game at a quiet step boundary as serde data
//! ([`Game::quiet`]), with the length of the log it was taken at and the stable
//! [`decisions_hash`] of that prefix. A save keeps it so that a reload replays only the decisions
//! after it. It is a cache and never decides anything: a position that does not
//! [`fit`](StoredPosition::fits) the log is ignored and the game replays from the seed.

use serde::{Deserialize, Serialize};
use ti4_content::ContentStore;
use ti4_content::galaxy::Galaxy;
use ti4_engine::choice::{DecisionRecord, Table};
use ti4_engine::game::{Game, GameSnapshot, QuietGame};

use crate::replay::decisions_hash;

/// The live game as it was between two steps.
pub struct StepSnapshot {
    /// History generation of the session the copy was taken in.
    pub generation: u64,
    /// Decisions recorded when the copy was taken.
    pub log_len: usize,
    /// A digest of those decisions (who, what was asked, what was chosen): the guard that the
    /// log being checked starts with exactly the decisions the copy was taken after.
    digest: u64,
    game: GameSnapshot<'static>,
}

/// Order-sensitive digest of a decision log (deterministic within a process, never persisted).
fn log_digest(records: &[DecisionRecord]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    records.len().hash(&mut hasher);
    for record in records {
        record.player.hash(&mut hasher);
        record.prompt.hash(&mut hasher);
        record.chosen.hash(&mut hasher);
        record.offered.len().hash(&mut hasher);
    }
    hasher.finish()
}

impl std::fmt::Debug for StepSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StepSnapshot")
            .field("generation", &self.generation)
            .field("log_len", &self.log_len)
            .finish_non_exhaustive()
    }
}

impl StepSnapshot {
    /// Copy `game`, which must be between steps, or `None` when a copy would not be faithful.
    ///
    /// Applies any RNG position a turn redo forced but no draw has used yet (equivalent to
    /// waiting for the next draw), so the copy holds no deferred work.
    pub fn capture(game: &mut Game<'static>, generation: u64) -> Option<Self> {
        game.flush_rng_sync();
        if game.rng_sync_pending() {
            return None;
        }
        let records = &game.table.log.records;
        Some(Self {
            generation,
            log_len: records.len(),
            digest: log_digest(records),
            game: game.snapshot_unlogged(),
        })
    }

    /// Whether this copy may stand in for replaying `prefix` from the start of the game.
    #[must_use]
    pub fn is_valid_for(&self, generation: u64, prefix: &[DecisionRecord]) -> bool {
        self.generation == generation && self.is_prefix_of(prefix)
    }

    /// Whether the log this copy was taken at is a prefix of `records` (by length and newest
    /// record). A session replacing another one on the same history (a committed batch appends
    /// to it) is a new generation but still passes this.
    #[must_use]
    pub fn is_prefix_of(&self, records: &[DecisionRecord]) -> bool {
        self.log_len <= records.len() && log_digest(&records[..self.log_len]) == self.digest
    }

    /// A game positioned where the copy was taken, with `prefix[..log_len]` as its log and
    /// first-option deciders (the caller installs its own).
    ///
    /// # Panics
    /// When the copy is not valid for `prefix` (check [`StepSnapshot::is_valid_for`] first).
    #[must_use]
    pub fn fork(&self, prefix: &[DecisionRecord]) -> Game<'static> {
        assert!(
            self.log_len <= prefix.len(),
            "snapshot is newer than the prefix"
        );
        let mut game = self.game.instantiate();
        game.table.log.records = prefix[..self.log_len].to_vec();
        game
    }
}

/// A game at a quiet step boundary, stored with the decisions it was taken after.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPosition {
    /// Decisions recorded when the position was taken.
    pub log_len: usize,
    /// [`decisions_hash`] of those decisions.
    pub prefix_hash: String,
    /// The game, without its decision log and its galaxy.
    pub game: QuietGame,
}

impl StoredPosition {
    /// Take `game`, which must be between steps, or `None` where it is not quiet
    /// ([`Game::quiet`]) or holds the deck reserve of a turn redo, which is not stored.
    pub fn capture(game: &mut Game<'_>) -> Option<Self> {
        let quiet = Self::quiet(game)?;
        Some(Self::new(quiet, &game.table.log.records))
    }

    /// The game part of [`Self::capture`], without the hash of the log: for a holder that takes
    /// it often and hashes the log only when it writes the position ([`Self::new`]).
    pub fn quiet(game: &mut Game<'_>) -> Option<QuietGame> {
        if game.state.deck_reserve.is_some() {
            return None;
        }
        game.quiet()
    }

    /// The position of `game`, taken by [`Self::quiet`] after the decisions `records`.
    #[must_use]
    pub fn new(game: QuietGame, records: &[DecisionRecord]) -> Self {
        Self {
            log_len: records.len(),
            prefix_hash: decisions_hash(records),
            game,
        }
    }

    /// Whether `log` starts with exactly the decisions this position was taken after.
    #[must_use]
    pub fn fits(&self, log: &[DecisionRecord]) -> bool {
        log.get(..self.log_len)
            .is_some_and(|prefix| decisions_hash(prefix) == self.prefix_hash)
    }

    /// The game where the position was taken, with `log[..log_len]` as its decision log,
    /// `table` answering and `galaxy` as its map.
    ///
    /// # Panics
    /// When `log` is shorter than the position (check [`StoredPosition::fits`] first).
    #[must_use]
    pub fn restore<'a>(
        self,
        log: &[DecisionRecord],
        content: &'a ContentStore,
        table: Table,
        galaxy: Option<Galaxy>,
    ) -> Game<'a> {
        assert!(self.log_len <= log.len(), "position is newer than the log");
        let mut game = self.game.restore(content, table, galaxy);
        game.table.log.records = log[..self.log_len].to_vec();
        game
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use ti4_engine::choice::{Choice, ChoiceOption, Decider, IllegalChoice};
    use ti4_model::id::PlayerId;
    use ti4_model::state::GameState;
    use ti4_rule_bot::RuleBotDecider;

    use super::*;

    /// Answers with the recorded option ids, in order; anything else is an error.
    struct Recorded(VecDeque<String>);

    impl Decider for Recorded {
        fn choose(&mut self, choice: &Choice) -> Result<ChoiceOption, IllegalChoice> {
            let wanted = self
                .0
                .pop_front()
                .ok_or_else(|| IllegalChoice::DeciderFailed {
                    player: choice.player.clone(),
                    prompt: choice.prompt.clone(),
                    reason: "no recorded decision left".to_owned(),
                })?;
            let offered: Vec<String> = choice.options.iter().map(|o| o.id.clone()).collect();
            choice
                .options
                .iter()
                .find(|option| option.id == wanted)
                .cloned()
                .ok_or(IllegalChoice::ScriptDiverged {
                    player: choice.player.clone(),
                    wanted,
                    offered,
                })
        }
    }

    struct Played {
        opening: GameState,
        galaxy: Galaxy,
        log: Vec<DecisionRecord>,
        end: Game<'static>,
        /// Taken at the first quiet boundary after 60 decisions, written as JSON.
        position: String,
    }

    /// A seeded game of rule bots on three seats, played to 40 decisions past its position.
    fn played() -> Played {
        const SEED: u64 = 11;
        let players: Vec<PlayerId> = ["p1", "p2", "p3"].into_iter().map(PlayerId::new).collect();
        let (opening, galaxy) =
            crate::map::create_game_with_template(ContentStore::embedded(), &players, SEED, None)
                .unwrap();
        let mut table = Table::new();
        for (seat, player) in players.iter().enumerate() {
            table.seat(player.clone(), Box::new(RuleBotDecider::new(seat, SEED)));
        }
        let mut game = Game::with_table(opening.clone(), ContentStore::embedded(), table)
            .with_galaxy(galaxy.clone());
        let mut position: Option<StoredPosition> = None;
        while position
            .as_ref()
            .is_none_or(|taken| game.table.log.records.len() < taken.log_len + 40)
        {
            assert!(!game.state.finished, "the game ended early");
            if position.is_none()
                && game.table.log.records.len() >= 60
                && let Some(taken) = StoredPosition::capture(&mut game)
            {
                position = Some(taken);
            }
            assert_eq!(game.step().error, None);
        }
        Played {
            opening,
            galaxy,
            log: game.table.log.records.clone(),
            end: game,
            position: serde_json::to_string(&position.unwrap()).unwrap(),
        }
    }

    #[test]
    fn a_position_fits_the_logs_that_start_with_its_decisions() {
        let played = played();
        let position: StoredPosition = serde_json::from_str(&played.position).unwrap();
        let len = position.log_len;
        assert!(position.fits(&played.log[..len]));
        assert!(
            position.fits(&played.log),
            "a longer log with the same prefix"
        );
        assert!(!position.fits(&played.log[..len - 1]), "a shorter log");
        let mut changed = played.log.clone();
        let other = changed[len / 2]
            .offered
            .iter()
            .find(|id| **id != changed[len / 2].chosen)
            .cloned()
            .unwrap_or_else(|| "another".to_owned());
        changed[len / 2].chosen = other;
        assert!(
            !position.fits(&changed),
            "one changed decision in the prefix"
        );
    }

    #[test]
    fn a_restored_position_replays_the_rest_like_the_full_replay() {
        let played = played();
        let position: StoredPosition = serde_json::from_str(&played.position).unwrap();
        assert_eq!(
            serde_json::to_string(&position).unwrap(),
            played.position,
            "the JSON reads back to the same position"
        );
        let full =
            crate::replay::replay_session(&played.opening, Some(&played.galaxy), &played.log)
                .unwrap();
        assert!(full.hashes_match);

        let rest = played.log[position.log_len..]
            .iter()
            .map(|record| record.chosen.clone());
        let mut game = position.restore(
            &played.log,
            ContentStore::embedded(),
            Table::with_default(Box::new(Recorded(rest.collect()))),
            Some(played.galaxy.clone()),
        );
        while game.table.log.records.len() < played.log.len() {
            assert_eq!(game.step().error, None);
        }

        assert_eq!(game.table.log.records, played.log);
        assert_eq!(
            decisions_hash(&game.table.log.records),
            decisions_hash(&played.log)
        );
        let json = |state: &GameState| serde_json::to_string(state).unwrap();
        assert_eq!(json(&game.state), json(&full.final_state));
        assert_eq!(json(&game.state), json(&played.end.state));
        assert_eq!(game.rolls(), &full.rolls[..]);
    }
}
