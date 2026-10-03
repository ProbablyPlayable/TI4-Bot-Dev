use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use ti4_content::{ContentStore, galaxy::all_systems};
use ti4_engine::fixtures::{game, hub_with_centre, put};
use ti4_model::content_types::POK;
use ti4_model::id::{PlayerId, SystemId};
use ti4_model::state::Phase;
use ti4_server::planning::runner::{PlanningEnvelope, PlanningUpdate, StopReason, SubmissionError};
use ti4_server::protocol::status::ViewerRole;
use ti4_server::session::registry::HistoryAction;
use ti4_server::session::{
    GameRegistry, GameSession, PlanningError, SeatController, SessionConfig,
};

const DEADLINE: Duration = Duration::from_secs(5);

fn fixture(cargo: bool) -> (SessionConfig, SystemId, SystemId, SystemId, SystemId) {
    let empty = all_systems(ContentStore::embedded(), POK)
        .iter()
        .find(|(_, system)| {
            system.planets().is_empty() && !system.is_anomaly() && !system.is_hyperlane()
        })
        .unwrap()
        .0
        .to_string();
    let hub = hub_with_centre(&empty);
    let origin_b = SystemId::new(&hub.outer[0]);
    let origin_a = SystemId::new(&hub.outer[1]);
    let target = if cargo {
        SystemId::new(&hub.centre)
    } else {
        SystemId::new(hub.across(origin_b.as_str()))
    };
    let centre = SystemId::new(&hub.centre);
    let mut state = game(&["a", "b"]);
    state.phase = Phase::Action;
    state.active = Some(PlayerId::new("a"));
    for (player, origin, ship) in [
        ("a", &origin_a, if cargo { "carrier" } else { "destroyer" }),
        ("b", &origin_b, if cargo { "carrier" } else { "cruiser" }),
    ] {
        put(&mut state, origin, ship, &PlayerId::new(player), 1);
        if cargo {
            put(&mut state, origin, "fighter", &PlayerId::new(player), 1);
        }
    }
    let config = SessionConfig::new("session_planning", state)
        .with_galaxy(hub.galaxy, vec![])
        .with_player_ids(vec![PlayerId::new("a"), PlayerId::new("b")])
        .with_seat(PlayerId::new("a"), SeatController::Human)
        .with_seat(PlayerId::new("b"), SeatController::Human);
    // The target for b is encoded separately so the live actor always moves to centre.
    assert_eq!(
        config
            .galaxy
            .as_ref()
            .unwrap()
            .distance(origin_b.as_str(), target.as_str()),
        Some(if cargo { 1 } else { 2 })
    );
    (config, origin_a, origin_b, target, centre)
}

struct LiveOffer {
    choice: ti4_engine::choice::Choice,
    nonce: String,
    game_version: u64,
}

fn live_offer(session: &GameSession, previous_nonce: Option<&str>) -> LiveOffer {
    let deadline = Instant::now() + DEADLINE;
    loop {
        assert!(session.error().is_none(), "{:?}", session.error());
        if let Some((seat, _, _)) = session.current_pending_decision() {
            let snapshot = session.get_snapshot(&ViewerRole::Player(seat));
            if let Some(pending) = snapshot.pending_choice {
                if previous_nonce != Some(pending.nonce.as_str()) {
                    return LiveOffer {
                        choice: pending.choice,
                        nonce: pending.nonce,
                        game_version: snapshot.game_version,
                    };
                }
            }
        }
        assert!(Instant::now() < deadline, "live offer deadline");
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn answer_live(session: &GameSession, option: &str) -> LiveOffer {
    let offer = live_offer(session, None);
    session
        .submit_choice(
            &offer.choice.player,
            &offer.nonce,
            offer.game_version,
            option,
        )
        .unwrap();
    live_offer(session, Some(&offer.nonce))
}

fn planning_offer(session: &GameSession) -> PlanningEnvelope {
    loop {
        let envelope = session
            .recv_planning_timeout(&PlayerId::new("b"), DEADLINE)
            .unwrap();
        match &envelope.update {
            PlanningUpdate::SafeOffer(_) => return envelope,
            PlanningUpdate::SafeStep(_) => {}
            other => panic!("expected planning offer, got {other:?}"),
        }
    }
}

fn draft(session: &GameSession, answers: &[String]) -> PlanningEnvelope {
    session.start_planning(&PlayerId::new("b")).unwrap();
    for answer in answers {
        let offer = planning_offer(session);
        session
            .submit_planning_choice(&PlayerId::new("b"), offer.identity, answer)
            .unwrap();
    }
    planning_offer(session)
}

fn replayed_offer(session: &GameSession) -> PlanningEnvelope {
    loop {
        let offer = planning_offer(session);
        if offer.progress.remaining == 0 {
            return offer;
        }
    }
}

#[test]
fn drafts_are_independent_and_refresh_only_after_completed_live_steps() {
    let (config, origin_a, origin_b, target, centre) = fixture(true);
    let session = GameSession::start(config.clone());
    let initial = live_offer(&session, None);
    let live_state = serde_json::to_value(session.current_state()).unwrap();
    let events = session.event_log();
    let decisions = session.decision_log();
    let script = vec![
        "tactical".into(),
        target.to_string(),
        format!("move|{origin_b}|0"),
        "load|0".into(),
    ];
    let old = draft(&session, &script);
    assert_eq!(
        session.current_pending_decision(),
        Some((PlayerId::new("a"), initial.nonce, initial.game_version))
    );
    assert_eq!(
        serde_json::to_value(session.current_state()).unwrap(),
        live_state
    );
    assert_eq!(session.event_log(), events);
    assert_eq!(session.decision_log(), decisions);
    let retained = session.plans()[&PlayerId::new("b")]
        .recorded_decisions
        .clone();
    assert_eq!(retained.len(), 4);

    answer_live(&session, "tactical");
    answer_live(&session, centre.as_str());
    let before_move = replayed_offer(&session);
    assert!(before_move.identity.checkpoint_id > old.identity.checkpoint_id);
    assert_eq!(before_move.progress.replayed, retained.len());

    let cargo = answer_live(&session, &format!("move|{origin_a}|0"));
    assert_eq!(cargo.choice.context.as_ref().unwrap().subtype, "load_cargo");
    let loading = replayed_offer(&session);
    assert!(loading.identity.checkpoint_id > before_move.identity.checkpoint_id);
    answer_live(&session, "load|0");
    let refreshed = replayed_offer(&session);
    assert!(refreshed.identity.checkpoint_id > loading.identity.checkpoint_id);
    assert!(refreshed.identity.generation_id > loading.identity.generation_id);
    assert_eq!(refreshed.progress.replayed, retained.len());
    assert_eq!(
        session.plans()[&PlayerId::new("b")].recorded_decisions,
        retained
    );
    let PlanningUpdate::SafeOffer(publication) = &refreshed.update else {
        unreachable!()
    };
    assert!(
        publication.position.board.systems[&centre]
            .units
            .iter()
            .any(|unit| unit.owner == PlayerId::new("a"))
    );
    assert_eq!(
        session.submit_planning_choice(&PlayerId::new("b"), old.identity, "done_moving"),
        Err(PlanningError::Submission(SubmissionError::Retired))
    );

    // Replaying the live history from the original seed also verifies that the
    // planning workers never advanced the authoritative RNG or decision stream.
    let normal = GameSession::start_recovered(config, session.decision_log(), session.event_log());
    normal.wait_replayed().unwrap();
    let _ = live_offer(&normal, None);
    assert_eq!(normal.current_state(), session.current_state());
    assert_eq!(normal.decision_hashes(), session.decision_hashes());
}

#[test]
fn a_nested_scanlink_offer_does_not_advance_the_planning_checkpoint() {
    use ti4_engine::fixtures::put_on_planet;
    use ti4_model::id::{PlanetId, TechnologyId};

    let planets = ti4_content::galaxy::all_planets(ContentStore::embedded(), POK);
    let (planet, record) = planets
        .iter()
        .find(|(_, planet)| {
            planet.system_id().is_some()
                && planet.homeworld_of().is_none()
                && !planet.planet_types().is_empty()
        })
        .unwrap();
    let target = SystemId::new(record.system_id().unwrap());
    let hub = hub_with_centre(target.as_str());
    let mut state = game(&["a", "b"]);
    state.phase = Phase::Action;
    state.active = Some(PlayerId::new("a"));
    state
        .player_mut(&PlayerId::new("a"))
        .unwrap()
        .technologies
        .insert(TechnologyId::new("sdn"));
    put_on_planet(
        &mut state,
        &target,
        &PlanetId::new(*planet),
        "infantry",
        &PlayerId::new("a"),
        1,
    );
    let config = SessionConfig::new("nested_planning", state)
        .with_galaxy(hub.galaxy, vec![])
        .with_seat(PlayerId::new("a"), SeatController::Human)
        .with_seat(PlayerId::new("b"), SeatController::Human);
    let session = GameSession::start(config);
    let _ = live_offer(&session, None);
    let _ = draft(&session, &["tactical".into()]);
    answer_live(&session, "tactical");
    let before = replayed_offer(&session);
    let nested = answer_live(&session, target.as_str());
    assert_eq!(
        nested.choice.context.as_ref().unwrap().subtype,
        "scanlink_explore"
    );
    assert_eq!(
        session.recv_planning_timeout(&PlayerId::new("b"), Duration::from_millis(50)),
        Err(mpsc::RecvTimeoutError::Timeout)
    );
    answer_live(&session, "decline");
    let after = replayed_offer(&session);
    assert!(after.identity.checkpoint_id > before.identity.checkpoint_id);
    assert_eq!(after.progress.replayed, 1);
}

#[test]
fn a_live_blockade_causes_replay_mismatch_and_keeps_the_script() {
    let (config, origin_a, origin_b, target, centre) = fixture(false);
    let session = GameSession::start(config);
    let _ = live_offer(&session, None);
    let old = draft(
        &session,
        &[
            "tactical".into(),
            target.to_string(),
            format!("move|{origin_b}|0"),
        ],
    );
    let retained = session.plans()[&PlayerId::new("b")]
        .recorded_decisions
        .clone();
    answer_live(&session, "tactical");
    answer_live(&session, centre.as_str());
    answer_live(&session, &format!("move|{origin_a}|0"));
    loop {
        let update = session
            .recv_planning_timeout(&PlayerId::new("b"), DEADLINE)
            .unwrap();
        if let PlanningUpdate::Stopped { reason, .. } = update.update {
            assert_eq!(reason, StopReason::ReplayMismatch);
            assert!(update.identity.checkpoint_id > old.identity.checkpoint_id);
            assert_eq!(update.progress.replayed, 2);
            assert_eq!(update.progress.remaining, 1);
            break;
        }
    }
    assert_eq!(
        session.plans()[&PlayerId::new("b")].recorded_decisions,
        retained
    );
}

#[test]
fn undo_and_redo_keep_drafts_and_reject_the_previous_sessions_messages() {
    let (config, _, origin_b, target, centre) = fixture(true);
    let registry = GameRegistry::new();
    let session = registry.create_game(config).unwrap();
    let _ = live_offer(&session, None);
    let token = session.seat_tokens()[&PlayerId::new("a")].clone();
    let _ = draft(
        &session,
        &[
            "tactical".into(),
            target.to_string(),
            format!("move|{origin_b}|0"),
            "load|0".into(),
        ],
    );
    let retained = session.plans()[&PlayerId::new("b")]
        .recorded_decisions
        .clone();
    answer_live(&session, "tactical");
    answer_live(&session, centre.as_str());
    let old = replayed_offer(&session);
    registry
        .change_history(
            session.id(),
            &token,
            session.game_version(),
            HistoryAction::Undo,
        )
        .unwrap();
    let undone = registry.get_game(session.id()).unwrap();
    let _ = live_offer(&undone, None);
    let fresh = replayed_offer(&undone);
    assert_ne!(fresh.identity.checkpoint_id, old.identity.checkpoint_id);
    assert_eq!(
        undone.plans()[&PlayerId::new("b")].recorded_decisions,
        retained
    );
    assert_eq!(
        session.recv_planning_timeout(&PlayerId::new("b"), Duration::ZERO),
        Err(mpsc::RecvTimeoutError::Disconnected)
    );
    assert_eq!(
        session.submit_planning_choice(&PlayerId::new("b"), old.identity, "done_moving"),
        Err(PlanningError::Unavailable)
    );
    assert_eq!(
        undone.submit_planning_choice(&PlayerId::new("b"), old.identity, "done_moving"),
        Err(PlanningError::Submission(SubmissionError::Retired))
    );

    registry
        .change_history(
            undone.id(),
            &token,
            undone.game_version(),
            HistoryAction::Redo,
        )
        .unwrap();
    let redone = registry.get_game(session.id()).unwrap();
    let _ = live_offer(&redone, None);
    let newest = replayed_offer(&redone);
    assert_ne!(newest.identity.checkpoint_id, fresh.identity.checkpoint_id);
    assert_eq!(
        redone.plans()[&PlayerId::new("b")].recorded_decisions,
        retained
    );
}

#[test]
fn session_stop_wakes_waiting_planner_and_live_input() {
    let (config, _, _, _, _) = fixture(true);
    let session = Arc::new(GameSession::start(config));
    let _ = live_offer(&session, None);
    assert_eq!(
        session.start_planning(&PlayerId::new("a")),
        Err(PlanningError::ActivePlayer)
    );
    assert_eq!(
        session.start_planning(&PlayerId::new("unknown")),
        Err(PlanningError::UnknownSeat)
    );
    session.start_planning(&PlayerId::new("b")).unwrap();
    let old = planning_offer(&session);
    let (done, completed) = mpsc::channel();
    let stopping = session.clone();
    let worker = std::thread::spawn(move || {
        stopping.stop();
        done.send(()).unwrap();
    });
    completed
        .recv_timeout(DEADLINE)
        .expect("session and planner stop within deadline");
    worker.join().unwrap();
    assert_eq!(
        session.submit_planning_choice(&PlayerId::new("b"), old.identity, "tactical"),
        Err(PlanningError::Unavailable)
    );
    assert_eq!(
        session.recv_planning_timeout(&PlayerId::new("b"), Duration::ZERO),
        Err(mpsc::RecvTimeoutError::Disconnected)
    );
}
