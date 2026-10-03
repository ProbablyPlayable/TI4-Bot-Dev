//! Session-owned drafts, refreshed only at completed live engine steps.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

use ti4_engine::game::Game;
use ti4_model::id::PlayerId;
use ti4_model::state::Phase;

use crate::planning::runner::{PlanningRunner, PlayerPlan, SubmissionError};

// Checkpoint identities stay distinct even when undo replaces the whole session.
static NEXT_CHECKPOINT: AtomicU64 = AtomicU64::new(1);
const STEP_BOUND: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanningError {
    Unavailable,
    UnknownSeat,
    ActivePlayer,
    NotStarted,
    Submission(SubmissionError),
}

pub(crate) struct SessionPlanning {
    // Game isn't Send. This engine-provided factory carries its copied driver
    // state across threads and creates fresh input bindings when called.
    checkpoint: Option<Box<dyn FnOnce() -> Game<'static> + Send>>,
    checkpoint_id: u64,
    available: bool,
    closed: bool,
    saved: BTreeMap<PlayerId, PlayerPlan>,
    pub runners: BTreeMap<PlayerId, PlanningRunner>,
}

impl SessionPlanning {
    pub fn new(saved: BTreeMap<PlayerId, PlayerPlan>) -> Self {
        Self {
            checkpoint: None,
            checkpoint_id: 0,
            available: false,
            closed: false,
            saved,
            runners: BTreeMap::new(),
        }
    }

    /// Called with the session lock held, never from a nested offer callback.
    pub fn completed_step(&mut self, game: &Game<'static>) {
        if self.closed {
            return;
        }
        self.checkpoint_id = NEXT_CHECKPOINT.fetch_add(1, Ordering::Relaxed);
        self.available = game.state.phase == Phase::Action && !game.state.finished;
        self.checkpoint = Some(Box::new(game.fork_for_worker()));
        if !self.available {
            self.retire_runners();
            return;
        }
        for runner in self.runners.values_mut() {
            runner.refresh(game, self.checkpoint_id);
        }
        // Restored scripts also resume after a non-action phase or undo/redo.
        for (player, mut plan) in std::mem::take(&mut self.saved) {
            plan.revision += 1;
            plan.base_checkpoint_id = self.checkpoint_id;
            self.runners.insert(
                player.clone(),
                PlanningRunner::start(game, player, plan, STEP_BOUND),
            );
        }
    }

    pub fn start(&mut self, player: &PlayerId) -> Result<(), PlanningError> {
        if self.closed || !self.available {
            return Err(PlanningError::Unavailable);
        }
        if self.runners.contains_key(player) {
            return Ok(());
        }
        let game = self.checkpoint.take().ok_or(PlanningError::Unavailable)?();
        self.checkpoint = Some(Box::new(game.fork_for_worker()));
        self.runners.insert(
            player.clone(),
            PlanningRunner::start(
                &game,
                player.clone(),
                PlayerPlan::new(self.checkpoint_id),
                STEP_BOUND,
            ),
        );
        Ok(())
    }

    pub fn plans(&self) -> BTreeMap<PlayerId, PlayerPlan> {
        let mut plans = self.saved.clone();
        plans.extend(
            self.runners
                .iter()
                .map(|(player, runner)| (player.clone(), runner.plan())),
        );
        plans
    }

    fn retire_runners(&mut self) {
        for (player, mut runner) in std::mem::take(&mut self.runners) {
            // Save the settled script after the worker has terminated.
            runner.cancel();
            self.saved.insert(player, runner.plan());
        }
    }

    pub fn close(&mut self) {
        self.closed = true;
        self.available = false;
        self.checkpoint = None;
        self.retire_runners();
    }
}
