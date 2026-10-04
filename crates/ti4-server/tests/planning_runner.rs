//! The transcript, rather than the discarded fork, is the privacy contract.

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;

use ti4_content::{ContentStore, galaxy::all_systems};
use ti4_engine::choice::{
    AlwaysDecline, Choice, ChoiceOption, Decider, IllegalChoice, Scripted, Table,
};
use ti4_engine::fixtures::{
    a_system_where, game, hub_with_centre, hub_with_outer, put, put_on_planet,
};
use ti4_engine::game::Game;
use ti4_engine::observation::ExecutionObservation;
use ti4_engine::timing::{Ability, Relation};
use ti4_model::content_types::POK;
use ti4_model::id::{ActionCardId, PlanetId, PlayerId, SystemId, TechnologyId};
use ti4_model::state::Phase;
use ti4_server::planning::RecordingDecider;
use ti4_server::planning::runner::{
    ASSUMPTION, FailureCategory, PlanningEnvelope, PlanningRunner, PlanningUpdate, PlayerPlan,
    StopReason, SubmissionError,
};
use ti4_server::projection::project_game_view;
use ti4_server::protocol::status::ViewerRole;

const DEADLINE: Duration = Duration::from_secs(5);

fn within_deadline<T: Send + 'static>(operation: impl FnOnce() -> T + Send + 'static) -> T {
    let (finished, result) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        finished.send(operation()).ok();
    });
    let value = result
        .recv_timeout(DEADLINE)
        .expect("worker shutdown is bounded");
    worker.join().unwrap();
    value
}

fn empty_system() -> String {
    all_systems(ContentStore::embedded(), POK)
        .iter()
        .find(|(_, system)| {
            system.planets().is_empty() && !system.is_anomaly() && !system.is_hyperlane()
        })
        .unwrap()
        .0
        .to_string()
}

fn checkpoint(rift: bool, carrier: bool) -> (Game<'static>, SystemId, SystemId) {
    let hub = if rift {
        hub_with_outer(&a_system_where("gravity rift"))
    } else {
        hub_with_centre(&empty_system())
    };
    let destination = SystemId::new(&hub.centre);
    let origin = SystemId::new(&hub.outer[0]);
    let mut state = game(&["a", "b"]);
    state.phase = Phase::Action;
    state.active = Some(PlayerId::new("a"));
    put(
        &mut state,
        &origin,
        if carrier { "carrier" } else { "destroyer" },
        &PlayerId::new("b"),
        1,
    );
    if carrier {
        put(&mut state, &origin, "fighter", &PlayerId::new("b"), 1);
    }
    (
        Game::new(state, ContentStore::embedded()).with_galaxy(hub.galaxy),
        destination,
        origin,
    )
}

fn runner(game: &Game<'static>) -> PlanningRunner {
    PlanningRunner::start(game, PlayerId::new("b"), PlayerPlan::new(10), 32)
}

fn next(runner: &PlanningRunner) -> PlanningEnvelope {
    runner
        .recv_timeout(DEADLINE)
        .expect("worker publishes before deadline")
}

fn collect(runner: &PlanningRunner, answers: &[String]) -> Vec<PlanningEnvelope> {
    let mut transcript = Vec::new();
    let mut answers = answers.iter();
    loop {
        let envelope = next(runner);
        assert_eq!(envelope.assumptions, vec![ASSUMPTION]);
        if let PlanningUpdate::SafeOffer(offer) = &envelope.update {
            if envelope.progress.remaining == 0 {
                let answer = answers.next().expect("expected question");
                runner
                    .submit(envelope.identity, answer)
                    .expect("safe answer");
            }
            assert!(offer.choice.is_some());
        }
        let terminal = matches!(
            envelope.update,
            PlanningUpdate::Stopped { .. } | PlanningUpdate::Failed(_)
        );
        transcript.push(envelope);
        if terminal {
            assert!(answers.next().is_none());
            return transcript;
        }
    }
}

fn reason(transcript: &[PlanningEnvelope]) -> StopReason {
    match &transcript.last().unwrap().update {
        PlanningUpdate::Stopped { reason, .. } => *reason,
        other => panic!("expected stop, got {other:?}"),
    }
}

fn answers(destination: &SystemId, origin: &SystemId, cargo: bool) -> Vec<String> {
    let mut answers = vec![
        "tactical".into(),
        destination.to_string(),
        format!("move|{origin}|0"),
    ];
    if cargo {
        answers.push("load|0".into());
    }
    answers.push("done_moving".into());
    answers
}

#[test]
fn recording_receipts_exclude_rejected_requests_and_survive_refresh_and_restoration() {
    let (live, _, _) = checkpoint(false, false);
    let mut runner = runner(&live);
    let old = next(&runner);
    assert!(old.awaiting_answer);
    assert!(old.recorded_request_ids.is_empty());
    runner
        .submit_with_request_id(old.identity, "tactical", Some("winner"))
        .unwrap();
    let recorded = loop {
        let update = next(&runner);
        if update.awaiting_answer {
            break update;
        }
    };
    assert_eq!(recorded.recorded_request_ids, ["winner"]);
    assert_eq!(
        runner.submit_with_request_id(old.identity, "tactical", Some("loser")),
        Err(SubmissionError::Retired)
    );
    let retained = runner.plan();
    assert_eq!(retained.recorded_request_ids, ["winner"]);
    runner.refresh(&live, 11);
    loop {
        let update = next(&runner);
        assert_eq!(update.recorded_request_ids, ["winner"]);
        if update.awaiting_answer {
            break;
        }
    }
    let saved = serde_json::to_string(&retained).unwrap();
    let restored = PlanningRunner::start(
        &live,
        PlayerId::new("b"),
        serde_json::from_str(&saved).unwrap(),
        32,
    );
    assert_eq!(next(&restored).recorded_request_ids, ["winner"]);
    runner.edit(&live, 12, vec![]);
    assert!(next(&runner).recorded_request_ids.is_empty());
}

#[test]
fn two_player_movement_and_cargo_match_the_normal_fork_without_touching_live_state() {
    let (live, destination, origin) = checkpoint(false, true);
    let original = serde_json::to_value(&live.state).unwrap();
    let script = answers(&destination, &origin, true);
    let runner = runner(&live);
    let transcript = collect(&runner, &script);
    assert_eq!(reason(&transcript), StopReason::MovementComplete);
    let offered: Vec<_> = transcript
        .iter()
        .filter_map(|envelope| match &envelope.update {
            PlanningUpdate::SafeOffer(offer) => Some(
                offer
                    .choice
                    .as_ref()
                    .unwrap()
                    .context
                    .as_ref()
                    .unwrap()
                    .subtype
                    .as_str(),
            ),
            _ => None,
        })
        .collect();
    assert!(offered.contains(&"activate_system"));
    assert!(offered.contains(&"movement_step"));
    assert!(offered.contains(&"load_cargo"));

    let mut normal = live.fork();
    normal
        .prepare_hypothetical_turn(&PlayerId::new("b"))
        .unwrap();
    normal.timing.set_participation(Arc::new(|ability| {
        ability.owner == PlayerId::new("b") || !ability.optional
    }));
    normal.table = Table::with_default(Box::new(Scripted::new(script)));
    for _ in 0..16 {
        assert!(normal.step().error.is_none());
        if normal
            .events
            .iter()
            .any(|event| event == "TACTICAL_ACTION_COMPLETE")
        {
            break;
        }
    }
    let expected = project_game_view(&normal.state, &ViewerRole::Player(PlayerId::new("b")));
    let PlanningUpdate::Stopped {
        last_safe_publication: Some(last),
        ..
    } = &transcript.last().unwrap().update
    else {
        panic!("last safe state")
    };
    assert_eq!(last.position, expected);
    assert_eq!(runner.plan().recorded_decisions.len(), 5);
    assert_eq!(serde_json::to_value(&live.state).unwrap(), original);
    assert!(live.rolls().is_empty());
    assert!(live.table.log.is_empty());
    // Driving both original RNG copies later also compares their stream positions.
    let original_fork = live.fork();
    assert_eq!(
        serde_json::to_value(&original_fork.state).unwrap(),
        original
    );
}

#[test]
fn gravity_rift_transcripts_are_identical_and_keep_the_uncertainty_crossing_answer() {
    let mut transcripts = Vec::new();
    let mut live_outcomes = std::collections::BTreeSet::new();
    for seed in 0..12 {
        let (mut live, destination, origin) = checkpoint(true, false);
        live.state.rng_seed = seed;
        // Game owns its RNG separately from state, so construct it with this seed.
        let galaxy = live.galaxy().unwrap().clone();
        live = Game::new(live.state.clone(), ContentStore::embedded()).with_galaxy(galaxy);
        let live_observation = ExecutionObservation::default();
        live.bind_observation(live_observation.clone());
        let untouched_rng = live.fork();
        let input = vec![
            "tactical".into(),
            destination.to_string(),
            format!("move|{origin}|0"),
        ];
        let runner = runner(&live);
        let transcript = collect(&runner, &input);
        assert_eq!(reason(&transcript), StopReason::Uncertainty);
        assert_eq!(runner.plan().recorded_decisions.len(), 3);
        assert_eq!(
            transcript
                .last()
                .unwrap()
                .progress
                .nested_answers_since_checkpoint,
            1
        );
        assert!(transcript.iter().all(|envelope| {
            match &envelope.update {
                PlanningUpdate::SafeStep(state) => !state
                    .events
                    .iter()
                    .any(|event| event == "SHIP_MOVED" || event.contains("LOST")),
                _ => true,
            }
        }));
        transcripts.push(serde_json::to_value(transcript).unwrap());

        let mut actual = live.fork();
        actual
            .prepare_hypothetical_turn(&PlayerId::new("b"))
            .unwrap();
        actual.table = Table::with_default(Box::new(Scripted::new(input)));
        for _ in 0..3 {
            assert!(actual.step().error.is_none());
        }
        live_outcomes.insert(actual.state.system_state(&destination).units.len());
        assert!(live.rolls().is_empty());
        assert_eq!(live_observation.activity(), Default::default());
        let mut expected = untouched_rng.fork();
        expected
            .prepare_hypothetical_turn(&PlayerId::new("b"))
            .unwrap();
        expected.table = Table::with_default(Box::new(Scripted::new(vec![
            "tactical".into(),
            destination.to_string(),
            format!("move|{origin}|0"),
        ])));
        for _ in 0..3 {
            assert!(expected.step().error.is_none());
        }
        assert_eq!(
            actual.rolls(),
            expected.rolls(),
            "live RNG positions are unchanged"
        );
    }
    assert_eq!(live_outcomes.len(), 2, "seeds really change survival");
    assert!(transcripts.windows(2).all(|pair| pair[0] == pair[1]));
}

#[test]
fn frontier_ordered_draw_stops_without_card_rewards_or_followup_offers() {
    let mut transcripts = Vec::new();
    for card in ["ent", "lc1"] {
        let (mut live, destination, origin) = checkpoint(false, false);
        live.state
            .player_mut(&PlayerId::new("b"))
            .unwrap()
            .technologies
            .insert(TechnologyId::new("det"));
        live.state.frontier_tokens.insert(destination.clone());
        live.state
            .exploration_decks
            .insert("FRONTIER".into(), vec![card.into()]);
        let runner = runner(&live);
        let transcript = collect(&runner, &answers(&destination, &origin, false));
        assert_eq!(reason(&transcript), StopReason::Uncertainty);
        assert_eq!(runner.plan().recorded_decisions.len(), 4);
        let text = serde_json::to_string(&transcript).unwrap();
        assert!(!text.contains(&format!("\"{card}\"")));
        assert!(!text.contains("FRONTIER_EXPLORED"));
        transcripts.push(serde_json::to_value(transcript).unwrap());
    }
    assert_eq!(transcripts[0], transcripts[1]);
}

#[test]
fn opponent_optional_conditions_are_never_consulted_and_live_timing_still_consults_them() {
    let mut transcripts = Vec::new();
    for held in [false, true] {
        let (mut live, destination, origin) = checkpoint(false, false);
        live.state
            .player_mut(&PlayerId::new("a"))
            .unwrap()
            .action_cards = vec![ActionCardId::new(if held {
            "flank_speed"
        } else {
            "unplayable"
        })];
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = calls.clone();
        live.timing.register([Ability::new(
            "test_reaction",
            PlayerId::new("a"),
            "TURN_BEGAN",
            Relation::When,
            Arc::new(|_, _| Ok(())),
        )
        .with_optional(true)
        .with_condition(Arc::new(move |_, _| {
            counted.fetch_add(1, Ordering::SeqCst);
            held
        }))]);
        let runner = runner(&live);
        let transcript = collect(&runner, &answers(&destination, &origin, false));
        assert_eq!(reason(&transcript), StopReason::MovementComplete);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        transcripts.push(serde_json::to_value(transcript).unwrap());
        live.table = Table::with_default(Box::new(AlwaysDecline));
        let _ = live.step();
        assert!(calls.load(Ordering::SeqCst) > 0);
    }
    assert_eq!(transcripts[0], transcripts[1]);
}

#[test]
fn mandatory_opponent_participation_stops_before_private_conditions() {
    let (mut live, _, _) = checkpoint(false, false);
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = calls.clone();
    live.timing.register([Ability::new(
        "private_mandatory",
        PlayerId::new("a"),
        "TURN_BEGAN",
        Relation::When,
        Arc::new(|_, _| panic!("must not run")),
    )
    .with_condition(Arc::new(move |_, _| {
        counted.fetch_add(1, Ordering::SeqCst);
        true
    }))]);
    let transcript = collect(&runner(&live), &[]);
    assert_eq!(reason(&transcript), StopReason::UnsupportedParticipation);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(transcript.len(), 1);
}

#[test]
fn refresh_wakes_waiting_input_and_rejects_old_submissions_and_queued_output() {
    let (live, _, _) = checkpoint(false, false);
    let mut runner = runner(&live);
    let old = next(&runner);
    assert!(matches!(old.update, PlanningUpdate::SafeOffer(_)));
    let checkpoint = live.fork_for_worker();
    runner = within_deadline(move || {
        let checkpoint = checkpoint();
        runner.refresh(&checkpoint, 11);
        runner
    });
    assert_eq!(
        runner.submit(old.identity, "tactical"),
        Err(SubmissionError::Retired)
    );
    let new = next(&runner);
    assert_eq!(new.identity.generation_id, old.identity.generation_id + 1);
    assert_eq!(new.identity.checkpoint_id, 11);
    within_deadline(move || runner.cancel());
}

#[test]
fn refresh_replays_nested_answers_and_mismatch_preserves_the_full_script() {
    let (live, destination, origin) = checkpoint(false, true);
    let mut runner = runner(&live);
    let script = answers(&destination, &origin, true);
    let first = collect(&runner, &script);
    assert_eq!(reason(&first), StopReason::MovementComplete);
    let retained = runner.plan().recorded_decisions;
    runner.refresh(&live, 11);
    let replayed = collect(&runner, &[]);
    assert_eq!(reason(&replayed), StopReason::MovementComplete);
    assert_eq!(replayed.last().unwrap().progress.replayed, retained.len());
    assert_eq!(runner.plan().recorded_decisions, retained);
    let mut changed = live.fork();
    changed.state.system_mut(&origin).units.clear();
    runner.refresh(&changed, 12);
    let mismatch = collect(&runner, &[]);
    assert_eq!(reason(&mismatch), StopReason::ReplayMismatch);
    assert_eq!(mismatch.last().unwrap().progress.replayed, 2);
    assert_eq!(
        mismatch.last().unwrap().progress.remaining,
        retained.len() - 2
    );
    assert_eq!(runner.plan().recorded_decisions, retained);
}

#[test]
fn preparation_failure_is_sanitized_and_separate_from_expected_stops() {
    let (mut live, _, _) = checkpoint(false, false);
    live.state.phase = Phase::Status;
    let runner = runner(&live);
    let envelope = next(&runner);
    assert_eq!(
        envelope.update,
        PlanningUpdate::Failed(FailureCategory::Preparation)
    );
    assert!(
        !serde_json::to_string(&envelope)
            .unwrap()
            .contains("action phase")
    );
}

fn scanlink_checkpoint() -> (Game<'static>, SystemId) {
    let planets = ti4_content::galaxy::all_planets(ContentStore::embedded(), POK);
    let (planet, record) = planets
        .iter()
        .find(|(_, planet)| {
            planet.system_id().is_some()
                && planet.homeworld_of().is_none()
                && !planet.planet_types().is_empty()
        })
        .unwrap();
    let origin = SystemId::new(record.system_id().unwrap());
    let hub = hub_with_centre(origin.as_str());
    let mut state = game(&["a", "b"]);
    state.phase = Phase::Action;
    state.active = Some(PlayerId::new("a"));
    let mut live = Game::new(state, ContentStore::embedded()).with_galaxy(hub.galaxy);
    live.state
        .player_mut(&PlayerId::new("b"))
        .unwrap()
        .technologies
        .insert(TechnologyId::new("sdn"));
    put_on_planet(
        &mut live.state,
        &origin,
        &PlanetId::new(*planet),
        "infantry",
        &PlayerId::new("b"),
        1,
    );
    (live, origin)
}

struct RefuseScanlink {
    initial: Scripted,
}

impl Decider for RefuseScanlink {
    fn choose(&mut self, choice: &Choice) -> Result<ChoiceOption, IllegalChoice> {
        if choice
            .context
            .as_ref()
            .is_some_and(|context| context.subtype == "scanlink_explore")
        {
            return Err(IllegalChoice::DeciderFailed {
                player: choice.player.clone(),
                prompt: choice.prompt.clone(),
                reason: "private diagnostic".into(),
            });
        }
        self.initial.choose(choice)
    }
}

#[test]
fn rejected_nested_offer_is_private_and_a_caught_error_cannot_accept_the_step() {
    let (live, target) = scanlink_checkpoint();
    let runner = runner(&live);
    let transcript = collect(&runner, &["tactical".into(), target.to_string()]);
    assert_eq!(reason(&transcript), StopReason::UnsupportedOffer);
    assert_eq!(transcript.last().unwrap().progress.completed_steps, 1);
    assert_eq!(
        transcript
            .last()
            .unwrap()
            .progress
            .nested_answers_since_checkpoint,
        1
    );
    assert_eq!(runner.plan().recorded_decisions.len(), 2);
    assert!(
        !serde_json::to_string(&transcript)
            .unwrap()
            .contains("scanlink_explore")
    );
    assert!(
        !serde_json::to_string(&transcript)
            .unwrap()
            .contains("private diagnostic")
    );
    let mut normal = live.fork();
    normal
        .prepare_hypothetical_turn(&PlayerId::new("b"))
        .unwrap();
    normal.table = Table::with_default(Box::new(RefuseScanlink {
        initial: Scripted::new(["tactical".into(), target.to_string()]),
    }));
    assert!(normal.step().error.is_none());
    // offer_scanlink catches the decider error and returns None. The normal
    // engine reports success, but the planning latch has already stopped it.
    assert!(normal.step().error.is_none());
}

#[test]
fn replay_does_not_supply_an_answer_to_an_unaudited_nested_offer() {
    let (live, target) = scanlink_checkpoint();
    let mut normal = live.fork();
    normal
        .prepare_hypothetical_turn(&PlayerId::new("b"))
        .unwrap();
    let (recorder, recording) = RecordingDecider::new(Box::new(Scripted::new([
        "tactical".into(),
        target.to_string(),
        "decline".into(),
    ])));
    normal.table = Table::with_default(Box::new(recorder));
    assert!(normal.step().error.is_none());
    assert!(normal.step().error.is_none());
    let retained = recording.lock().unwrap().clone();
    assert_eq!(retained.len(), 3);
    let plan = PlayerPlan {
        revision: 1,
        reset_revision: 0,
        base_checkpoint_id: 10,
        recorded_decisions: retained.clone(),
        recorded_request_ids: vec![],
    };
    let runner = PlanningRunner::start(&live, PlayerId::new("b"), plan, 16);
    let transcript = collect(&runner, &[]);
    assert_eq!(reason(&transcript), StopReason::UnsupportedOffer);
    assert_eq!(transcript.last().unwrap().progress.replayed, 2);
    assert_eq!(transcript.last().unwrap().progress.remaining, 1);
    assert_eq!(runner.plan().recorded_decisions, retained);
}

#[test]
fn replay_stops_at_a_rift_before_consuming_a_matching_later_answer() {
    let (live, destination, origin) = checkpoint(true, false);
    let mut normal = live.fork();
    normal
        .prepare_hypothetical_turn(&PlayerId::new("b"))
        .unwrap();
    let (recorder, recording) = RecordingDecider::new(Box::new(Scripted::new(answers(
        &destination,
        &origin,
        false,
    ))));
    normal.table = Table::with_default(Box::new(recorder));
    for _ in 0..4 {
        let _ = normal.step();
    }
    let retained = recording.lock().unwrap().clone();
    assert_eq!(retained.len(), 4);
    let runner = PlanningRunner::start(
        &live,
        PlayerId::new("b"),
        PlayerPlan {
            revision: 1,
            reset_revision: 0,
            base_checkpoint_id: 10,
            recorded_decisions: retained.clone(),
            recorded_request_ids: vec![],
        },
        16,
    );
    let transcript = collect(&runner, &[]);
    assert_eq!(reason(&transcript), StopReason::Uncertainty);
    assert_eq!(transcript.last().unwrap().progress.replayed, 3);
    assert_eq!(transcript.last().unwrap().progress.remaining, 1);
    assert_eq!(runner.plan().recorded_decisions, retained);
}

#[test]
fn other_player_question_stops_without_publishing_their_options() {
    let (mut live, target, _) = checkpoint(false, false);
    put(
        &mut live.state,
        &target,
        "destroyer",
        &PlayerId::new("a"),
        1,
    );
    live.state
        .player_mut(&PlayerId::new("a"))
        .unwrap()
        .technologies
        .insert(TechnologyId::new("nf"));
    let transcript = collect(&runner(&live), &["tactical".into(), target.to_string()]);
    assert_eq!(reason(&transcript), StopReason::OtherPlayerRequired);
    assert!(
        !serde_json::to_string(&transcript)
            .unwrap()
            .contains("nullification_field_end_turn")
    );
}

#[test]
fn unknown_optional_eligibility_is_excluded_before_it_can_inspect_a_hand() {
    let (mut live, _, _) = checkpoint(false, false);
    live.timing.register([Ability::new(
        "inspect_and_restore",
        PlayerId::new("b"),
        "TURN_BEGAN",
        Relation::When,
        Arc::new(|_, _| Ok(())),
    )
    .with_optional(true)
    .with_condition(Arc::new(|_, _| panic!("unaudited inspection must not run")))]);
    let transcript = collect(&runner(&live), &[]);
    assert_eq!(reason(&transcript), StopReason::UnsupportedParticipation);
    assert_eq!(transcript.len(), 1);
}

#[test]
fn a_public_aftermath_handoff_stops_before_its_automatic_effects_are_published() {
    let (live, _, origin) = checkpoint(false, false);
    let transcript = collect(
        &runner(&live),
        &["tactical".into(), origin.to_string(), "done_moving".into()],
    );
    assert_eq!(reason(&transcript), StopReason::UnsupportedSegment);
    assert_eq!(transcript.last().unwrap().progress.completed_steps, 2);
    assert_eq!(
        transcript
            .last()
            .unwrap()
            .progress
            .nested_answers_since_checkpoint,
        1
    );
}

#[test]
fn automatic_step_bound_and_edit_have_explicit_generation_boundaries() {
    let (live, _, _) = checkpoint(false, false);
    let mut runner = PlanningRunner::start(&live, PlayerId::new("b"), PlayerPlan::new(10), 1);
    let transcript = collect(&runner, &["tactical".into()]);
    assert_eq!(reason(&transcript), StopReason::StepLimit);
    assert_eq!(runner.plan().recorded_decisions.len(), 1);
    let old = transcript[0].identity;
    runner.edit(&live, 11, vec![]);
    assert!(matches!(next(&runner).update, PlanningUpdate::Preparing));
    let offer = next(&runner);
    assert!(matches!(offer.update, PlanningUpdate::SafeOffer(_)));
    assert_eq!(
        runner.submit(old, "tactical"),
        Err(SubmissionError::Retired)
    );
    assert_eq!(
        runner.submit(offer.identity, "pass"),
        Err(SubmissionError::UnknownOption)
    );
    assert!(runner.plan().recorded_decisions.is_empty());
}

/// Use a standing-slot identity so this test reaches the normal condition
/// boundary. The condition simulates activity inside a temporary engine helper.
fn observed_condition(
    live: &mut Game<'static>,
    condition: ti4_engine::timing::StatefulAbilityCondition,
) {
    let player = PlayerId::new("b");
    let owner = ti4_engine::promissory::faction_name(&live.state, &player);
    live.timing.register([Ability::stateful(
        format!("reaction:{owner}:TURN_BEGAN:when"),
        player,
        "TURN_BEGAN",
        Relation::When,
        Arc::new(|_, _, _| panic!("condition must not select an effect")),
    )
    .with_optional(true)
    .with_stateful_condition(condition)]);
}

#[test]
fn temporary_rng_and_direct_stream_activity_are_stopped_before_the_first_offer() {
    for direct in [false, true] {
        let (mut live, _, _) = checkpoint(false, false);
        observed_condition(
            &mut live,
            Arc::new(move |_, _, context| {
                let mut temporary = context.rng.clone();
                if direct {
                    let _ = temporary.stream("direct");
                } else {
                    let _ = temporary.die("temporary", 10);
                }
                false
            }),
        );
        let transcript = collect(&runner(&live), &[]);
        assert_eq!(reason(&transcript), StopReason::Uncertainty);
        assert_eq!(transcript.len(), 1);
    }
}

#[test]
fn zero_dice_does_not_stop_a_draft_but_positive_dice_does() {
    for count in [0, 1] {
        let (mut live, destination, origin) = checkpoint(false, false);
        observed_condition(
            &mut live,
            Arc::new(move |_, _, context| {
                let mut dice = context.dice.clone();
                let mut rng = context.rng.clone();
                dice.roll(&mut rng, count, "test boundary", None);
                false
            }),
        );
        let input = if count == 0 {
            answers(&destination, &origin, false)
        } else {
            vec![]
        };
        let transcript = collect(&runner(&live), &input);
        assert_eq!(
            reason(&transcript),
            if count == 0 {
                StopReason::MovementComplete
            } else {
                StopReason::Uncertainty
            }
        );
    }
}

#[test]
fn engine_failure_is_sanitized_and_uncertainty_takes_precedence_over_failure() {
    for uncertain in [false, true] {
        let (mut live, _, _) = checkpoint(false, false);
        observed_condition(
            &mut live,
            Arc::new(move |_, _, context| {
                if uncertain {
                    let mut temporary = context.rng.clone();
                    let _ = temporary.die("temporary", 10);
                }
                panic!("private card identity and speculative diagnostic");
            }),
        );
        let transcript = collect(&runner(&live), &[]);
        if uncertain {
            assert_eq!(reason(&transcript), StopReason::Uncertainty);
        } else {
            assert_eq!(
                transcript[0].update,
                PlanningUpdate::Failed(FailureCategory::Worker)
            );
        }
        assert_eq!(transcript.len(), 1);
        assert!(
            !serde_json::to_string(&transcript)
                .unwrap()
                .contains("private card identity")
        );
    }
}
