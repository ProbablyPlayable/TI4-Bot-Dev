//! Session-owned drafts, refreshed only at completed live engine steps.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

use ti4_engine::choice::{Choice, ChoiceOption};
use ti4_engine::game::Game;
use ti4_model::id::PlayerId;
use ti4_model::state::Phase;

use crate::planning::RecordedDecision;
use crate::planning::runner::{AttemptIdentity, PlanningRunner, PlayerPlan, SubmissionError};
use crate::protocol::server::{DraftApplication, DraftApplicationState};

// Checkpoint identities stay distinct even when undo replaces the whole session.
static NEXT_CHECKPOINT: AtomicU64 = AtomicU64::new(1);
const STEP_BOUND: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanningError {
    Unavailable,
    UnknownSeat,
    ActivePlayer,
    NotStarted,
    NoActionOpportunity,
    ReplayMismatch,
    Submission(SubmissionError),
}

struct Application {
    decisions: Vec<RecordedDecision>,
    progress: DraftApplication,
}

pub(crate) struct SessionPlanning {
    // Game isn't Send. This engine-provided factory carries its copied driver
    // state across threads and creates fresh input bindings when called.
    checkpoint: Option<Box<dyn FnOnce() -> Game<'static> + Send>>,
    pub(crate) checkpoint_id: u64,
    pub(crate) available: bool,
    closed: bool,
    saved: BTreeMap<PlayerId, PlayerPlan>,
    pub runners: BTreeMap<PlayerId, PlanningRunner>,
    applications: BTreeMap<PlayerId, Application>,
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
            applications: BTreeMap::new(),
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

    pub fn has_draft(&self, player: &PlayerId) -> bool {
        self.runners.contains_key(player) || self.saved.contains_key(player)
    }

    pub fn reset(
        &mut self,
        player: &PlayerId,
        identity: super::super::planning::runner::AttemptIdentity,
    ) -> Result<(), PlanningError> {
        if self.closed || !self.available {
            return Err(PlanningError::Unavailable);
        }
        if self.is_applying(player) {
            return Err(PlanningError::Submission(SubmissionError::NotWaiting));
        }
        let runner = self.runners.get(player).ok_or(PlanningError::NotStarted)?;
        if runner.identity() != identity {
            return Err(PlanningError::Submission(SubmissionError::Retired));
        }
        let game = self.checkpoint.take().ok_or(PlanningError::Unavailable)?();
        self.checkpoint = Some(Box::new(game.fork_for_worker()));
        self.runners
            .get_mut(player)
            .expect("runner")
            .edit(&game, self.checkpoint_id, Vec::new());
        self.applications.remove(player);
        Ok(())
    }

    pub fn application(&self, player: &PlayerId) -> Option<DraftApplication> {
        self.applications
            .get(player)
            .map(|app| app.progress.clone())
    }

    pub fn edit_movement(
        &mut self,
        player: &PlayerId,
        identity: AttemptIdentity,
    ) -> Result<(), PlanningError> {
        if self.closed || !self.available {
            return Err(PlanningError::Unavailable);
        }
        if self.has_application(player) {
            return Err(PlanningError::Submission(SubmissionError::NotWaiting));
        }
        if !self.runners.contains_key(player) {
            return Err(PlanningError::NotStarted);
        }
        let game = self.checkpoint.take().ok_or(PlanningError::Unavailable)?();
        self.checkpoint = Some(Box::new(game.fork_for_worker()));
        self.runners
            .get_mut(player)
            .expect("runner")
            .reopen_movement(&game, self.checkpoint_id, identity)
            .map_err(PlanningError::Submission)
    }

    pub fn is_applying(&self, player: &PlayerId) -> bool {
        self.applications.get(player).is_some_and(|app| {
            matches!(
                app.progress.state,
                DraftApplicationState::Applying | DraftApplicationState::WaitingForPlayer
            )
        })
    }

    pub fn has_application(&self, player: &PlayerId) -> bool {
        self.applications.contains_key(player)
    }

    pub fn executable_plan(
        &self,
        player: &PlayerId,
        identity: AttemptIdentity,
        choice: &Choice,
    ) -> Result<PlayerPlan, PlanningError> {
        if self.closed || !self.available {
            return Err(PlanningError::Unavailable);
        }
        if self.has_application(player) {
            return Err(PlanningError::Submission(SubmissionError::NotWaiting));
        }
        let runner = self.runners.get(player).ok_or(PlanningError::NotStarted)?;
        if runner.identity() != identity {
            return Err(PlanningError::Submission(SubmissionError::Retired));
        }
        if choice.player != *player
            || !choice
                .context
                .as_ref()
                .is_some_and(|context| context.subtype == "action_menu")
            || choice.option("tactical").is_none()
        {
            return Err(PlanningError::NoActionOpportunity);
        }
        let plan = runner
            .validated_plan(identity)
            .ok_or(PlanningError::ReplayMismatch)?;
        let decisions = &plan.recorded_decisions;
        if decisions.len() < 2
            || decisions[0].option_id != "tactical"
            || decisions[0].offered_option(choice).is_none()
            || !decisions[1]
                .context
                .as_ref()
                .is_some_and(|context| context.subtype == "activate_system")
            || decisions.iter().any(|decision| {
                decision.player != *player
                    || !decision.context.as_ref().is_some_and(|context| {
                        matches!(
                            context.subtype.as_str(),
                            "action_menu"
                                | "activate_system"
                                | "movement_step"
                                | "load_cargo"
                                | "commit_ground_forces"
                                | "produce_unit"
                                | "pay_resources"
                                | "place_unit"
                                | "exhaust_for_production_discount"
                                | "mid_action_pause"
                        )
                    })
            })
        {
            return Err(PlanningError::ReplayMismatch);
        }
        Ok(plan)
    }

    pub fn begin_application(
        &mut self,
        player: &PlayerId,
        mut plan: PlayerPlan,
        activation_seq: u32,
    ) {
        // Hypothetical preparation advances scoped counters to invalidate old
        // effects. Bind landing contexts to the upcoming authoritative activation
        // once, while retaining exact live question/option matching thereafter.
        for decision in &mut plan.recorded_decisions {
            if let Some(context) = &mut decision.context
                && context.subtype == "commit_ground_forces"
                && context.invasion_seq.is_some()
            {
                context.invasion_seq = Some(u64::from(activation_seq.saturating_add(1)));
            }
        }
        let total = plan.recorded_decisions.len();
        self.applications.insert(
            player.clone(),
            Application {
                decisions: plan.recorded_decisions,
                progress: DraftApplication {
                    applied: 0,
                    total,
                    state: DraftApplicationState::Applying,
                    message: "Applying draft to the live game.".into(),
                },
            },
        );
    }

    /// Other seats keep their normal input. An unplanned owner question or any
    /// changed instruction stops automation, retaining the unapplied suffix.
    pub fn application_option(&mut self, choice: &Choice) -> Option<ChoiceOption> {
        for (player, app) in &mut self.applications {
            if !matches!(
                app.progress.state,
                DraftApplicationState::Applying | DraftApplicationState::WaitingForPlayer
            ) {
                continue;
            }
            if *player != choice.player {
                app.progress.state = DraftApplicationState::WaitingForPlayer;
                app.progress.message = "Waiting for another player's live decision.".into();
                continue;
            }
            let expected = &app.decisions[app.progress.applied];
            if let Some(option) = expected.offered_option(choice) {
                app.progress.state = DraftApplicationState::Applying;
                app.progress.message = "Applying draft to the live game.".into();
                return Some(option);
            }
            app.progress.state = DraftApplicationState::NeedsDecision;
            app.progress.message = if expected.context == choice.context {
                "A planned choice is no longer available. Continue in Live; the remaining draft is retained."
            } else {
                "An unplanned live decision is required. Continue in Live; the remaining draft is retained."
            }.into();
        }
        None
    }

    pub fn application_answered(&mut self, choice: &Choice, option: &ChoiceOption) {
        let Some(app) = self.applications.get_mut(&choice.player) else {
            return;
        };
        if app.progress.state != DraftApplicationState::Applying {
            return;
        }
        if app.decisions[app.progress.applied]
            .offered_option(choice)
            .as_ref()
            != Some(option)
        {
            return;
        }
        app.progress.applied += 1;
        if app.progress.applied == app.progress.total {
            app.progress.state = DraftApplicationState::Applied;
            app.progress.message =
                "Recorded draft choices applied. Continue in Live for any further decisions."
                    .into();
        }
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
