//! History, save and resume, batches and queries of the hosted game, through the JSON commands.

use std::sync::{Arc, Mutex};

use crate::common::{Act, GAME, Page, install, last_question, pending, send, setup, start};
use serde_json::{Value, json};
use ti4_wasm::host_api;

fn page(script: Vec<Act>) -> Arc<Mutex<Page>> {
    Arc::new(Mutex::new(Page {
        script: script.into(),
        ..Page::default()
    }))
}

fn decisions_hash() -> String {
    let save = send(&json!({ "type": "save_state" }));
    save["save"]["decisions_hash"].as_str().unwrap().to_owned()
}

/// The events a page knows: the ones of its snapshot and the ones it was sent since.
fn events_of(messages: &[Value]) -> Vec<Value> {
    let mut events = Vec::new();
    for message in messages {
        match message["type"].as_str() {
            Some("initial_snapshot") => {
                events = message["events"].as_array().cloned().unwrap_or_default();
            }
            Some("event") => events.push(message["entry"].clone()),
            _ => {}
        }
    }
    events
}

#[test]
fn slow_an_undo_goes_back_one_answer_and_the_game_goes_on_the_same() {
    let _serial = crate::common::serial();
    let seed = 13;
    // The game as it is played without an undo.
    let plain = page(vec![]);
    install(&plain, seed, "a");
    start(&setup(seed, 4), None);
    let reference = decisions_hash();
    let answers = plain.lock().unwrap().answers.len();

    // The same game, with an undo after the 25th answer.
    let undone = page(vec![
        Act::Answer(25),
        Act::Probe(Box::new(|page| {
            let question = last_question(&page.messages);
            assert_eq!(
                question["history"]["can_undo"], true,
                "{}",
                question["history"]
            );
            let version = question["game_version"].clone();
            page.script.push_front(Act::Cmd(json!({
                "type": "undo", "protocol_version": 4, "game_id": GAME,
                "expected_version": version,
            })));
        })),
    ]);
    install(&undone, seed, "a");
    let end = start(&setup(seed, 4), None);
    assert_eq!(end["end"]["finished"], true);
    assert_eq!(
        decisions_hash(),
        reference,
        "an undo must not change the game"
    );
    let page = undone.lock().unwrap();
    // The undo was a request for the engine to take an answer back; the snapshot after it says so.
    let snapshots: Vec<&Value> = page
        .messages
        .iter()
        .filter(|m| m["type"] == "initial_snapshot")
        .collect();
    assert_eq!(
        snapshots.len(),
        2,
        "a snapshot at the start and one after the undo"
    );
    assert_eq!(snapshots[1]["history"]["generation"], 1);
    assert_eq!(snapshots[1]["history"]["redo_count"], 1);
    // The page answered the question that was taken back a second time.
    assert_eq!(page.answers.len(), answers + 1);
}

#[test]
fn slow_a_save_plays_again_to_the_same_question() {
    let _serial = crate::common::serial();
    let seed = 21;
    let first = page(vec![
        Act::Answer(70),
        Act::Cmd(json!({ "type": "save_state" })),
        Act::Leave,
    ]);
    install(&first, seed, "a");
    let end = start(&setup(seed, 4), None);
    assert_eq!(end["end"]["left"], true);
    let (save, question, events) = {
        let first = first.lock().unwrap();
        let save = first.replies.last().unwrap()["save"].clone();
        assert_eq!(save["answers"].as_array().unwrap().len(), 70);
        (
            save,
            last_question(&first.messages).clone(),
            events_of(&first.messages),
        )
    };

    // From the seed: the save without its position replays every decision.
    let second = page(vec![Act::Leave]);
    install(&second, seed, "a");
    let end = crate::common::resume(&without_position(&save));
    assert_eq!(end["end"]["left"], true);
    let second = second.lock().unwrap();
    // It was told how far it got, and checked that the game came back to the saved position.
    assert!(second.progress.len() >= 3, "{:?}", second.progress);
    assert_eq!(
        second.progress.last().unwrap().1 as usize,
        save["decisions"].as_array().unwrap().len()
    );
    assert_eq!(
        second.asks[0]["resume_check"]["ok"], true,
        "{}",
        second.asks[0]["resume_check"]
    );
    // The first thing it gets is a full snapshot, and it is the position that was saved.
    let snapshot = &second.messages[0];
    assert_eq!(snapshot["type"], "initial_snapshot");
    assert_eq!(snapshot["state"], question["state"]);
    assert_eq!(snapshot["pending_choice"], question["pending_choice"]);
    assert_eq!(snapshot["history"]["cursor"], question["history"]["cursor"]);
    let again = events_of(&second.messages);
    assert_eq!(again.len(), events.len());
    for (index, (ours, theirs)) in again.iter().zip(&events).enumerate() {
        assert_eq!(ours, theirs, "event {index} (with its time of day)");
    }
}

#[test]
fn a_save_names_its_game_and_every_decision_and_plays_again_with_no_seat_deciding() {
    let _serial = crate::common::serial();
    let seed = 11;
    // Fifteen answers, a save, an undo of the last answer, and a save again.
    let first = page(vec![
        Act::Answer(15),
        Act::Cmd(json!({ "type": "save_state" })),
        Act::Probe(Box::new(|page| {
            let (_, version, _, _) = pending(&page.messages).unwrap();
            page.script.push_front(Act::Cmd(json!({
                "type": "undo", "protocol_version": 4, "game_id": GAME,
                "expected_version": version,
            })));
        })),
        Act::Cmd(json!({ "type": "save_state" })),
        Act::Leave,
    ]);
    install(&first, seed, "a");
    start(&setup(seed, 4), None);
    let (before, save, question) = {
        let first = first.lock().unwrap();
        let saves: Vec<&Value> = first
            .replies
            .iter()
            .filter(|reply| reply["save"].is_object())
            .map(|reply| &reply["save"])
            .collect();
        (
            saves[0].clone(),
            saves[1].clone(),
            last_question(&first.messages).clone(),
        )
    };
    assert_eq!(save["format"], 2);
    assert_eq!(save["seed"], seed);
    assert_eq!(save["players"], 4);
    assert_eq!(save["humans"], 1);
    assert_eq!(save["game"]["setup"]["human_seat"], 0);
    assert_eq!(save["table"]["player_count"], 4);
    assert_eq!(save["finished"], false);
    for gone in ["setup", "log", "human_seat", "game_id"] {
        assert!(save.get(gone).is_none(), "{gone} is not in a save");
    }
    // The undo cuts the decisions at the answer that it takes back.
    let cut = save["decisions"].as_array().unwrap();
    let all = before["decisions"].as_array().unwrap();
    assert!(cut.len() < all.len(), "{} of {}", cut.len(), all.len());
    assert_eq!(cut[..], all[..cut.len()]);
    assert!(
        save["answers"].as_array().unwrap().len() < before["answers"].as_array().unwrap().len()
    );

    // The save alone plays the game again: every decision is given, and no seat decides.
    let second = page(vec![Act::Leave]);
    install(&second, seed, "a");
    let picks = ti4_wasm::picks_native();
    let end = crate::common::resume(&save);
    assert_eq!(end["end"]["left"], true, "{end}");
    assert_eq!(ti4_wasm::picks_native(), picks, "a seat decided again");
    let second = second.lock().unwrap();
    assert_eq!(
        second.asks[0]["resume_check"]["ok"], true,
        "{}",
        second.asks[0]["resume_check"]
    );
    let snapshot = &second.messages[0];
    assert_eq!(snapshot["type"], "initial_snapshot");
    assert_eq!(snapshot["state"], question["state"]);
    assert_eq!(snapshot["pending_choice"], question["pending_choice"]);
    let again = send(&json!({ "type": "save_state" }))["save"].clone();
    assert_eq!(again["decisions"], save["decisions"]);
    assert_eq!(again["decisions_hash"], save["decisions_hash"]);
}

#[test]
fn a_save_of_another_format_is_not_read() {
    let _serial = crate::common::serial();
    let request = json!({ "setup": setup(3, 3), "resume": { "format": 1, "log": [] } });
    let len = host_api::put_input(&request.to_string());
    let status = ti4_wasm::ti4_host_start(u32::try_from(len).unwrap());
    assert!(status < 0);
    assert!(
        host_api::out_text().contains("format 1; this engine reads format 2"),
        "{}",
        host_api::out_text()
    );
}

#[test]
fn slow_a_rewind_and_a_redo_play_the_game_again_to_the_same_end() {
    let _serial = crate::common::serial();
    let seed = 8;
    let reference = page(vec![]);
    install(&reference, seed, "a");
    start(&setup(seed, 3), None);
    let want = decisions_hash();

    // Rewind to the cursor of the 12th question while at the 40th.
    let rewinding = page(vec![
        Act::Answer(40),
        Act::Probe(Box::new(|page| {
            let twelfth = pending(page.asks[12]["messages"].as_array().unwrap()).unwrap();
            page.script.push_front(Act::Cmd(json!({
                "type": "history", "action": { "restore_cursor": { "cursor": twelfth.3 } },
            })));
        })),
    ]);
    install(&rewinding, seed, "a");
    let end = start(&setup(seed, 3), None);
    assert_eq!(
        end["end"]["left"], true,
        "a rewind ends the run and asks for a new one"
    );
    let restart = rewinding.lock().unwrap().replies.last().unwrap()["restart"].clone();
    assert_eq!(restart["generation"], 1);
    let last_version = rewinding.lock().unwrap().asks.last().unwrap()["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|m| m["game_version"].as_u64())
        .max()
        .unwrap();
    assert!(restart["version"].as_u64().unwrap() >= last_version);
    let answers = restart["answers"].as_array().unwrap().len();
    let redo = restart["redo"].as_array().unwrap().len();
    assert!(answers <= 12 && answers > 0, "{answers}");
    assert_eq!(answers + redo, 40, "what went back is kept for a redo");

    // Play again from there: one redo, then on to the end.
    let again = page(vec![Act::Probe(Box::new(move |page| {
        let snapshot = &page.messages[0];
        assert_eq!(snapshot["type"], "initial_snapshot");
        assert_eq!(snapshot["history"]["generation"], 1);
        assert_eq!(snapshot["history"]["redo_count"], redo);
        page.script
            .push_front(Act::Cmd(json!({ "type": "history", "action": "redo" })));
    }))]);
    install(&again, seed, "a");
    let resume = restart.clone();
    let end = start(&setup(seed, 3), Some(&resume));
    assert_eq!(end["end"]["left"], true);
    let redone = again.lock().unwrap().replies.last().unwrap()["restart"].clone();
    assert_eq!(redone["answers"].as_array().unwrap().len(), answers + 1);
    assert_eq!(redone["redo"].as_array().unwrap().len(), redo - 1);

    let rest = page(vec![]);
    install(&rest, seed, "a");
    let resume = redone.clone();
    let end = start(&setup(seed, 3), Some(&resume));
    assert_eq!(end["end"]["finished"], true);
    assert_eq!(decisions_hash(), want);
}

#[test]
fn slow_queries_and_settings_answer_in_the_servers_shapes() {
    let _serial = crate::common::serial();
    let seed = 4;
    let card = ti4_content::ContentStore::embedded()
        .records(ti4_model::content_types::ContentType::ActionCards)[0]
        .text("name")
        .unwrap()
        .to_owned();
    let queried = page(vec![
        // The third time the person takes an action: bots have played in between.
        Act::Until(Box::new({
            let seen = std::sync::atomic::AtomicUsize::new(0);
            move |choice| {
                choice.prompt == "action phase"
                    && seen.fetch_add(1, std::sync::atomic::Ordering::Relaxed) >= 2
            }
        })),
        Act::Cmd(
            json!({ "type": "query_reach", "protocol_version": 4, "game_id": GAME,
                         "request_id": 9, "system_id": "18" }),
        ),
        Act::Cmd(
            json!({ "type": "query_reach", "protocol_version": 4, "game_id": GAME,
                         "request_id": 10, "system_id": "nowhere" }),
        ),
        Act::Cmd(json!({ "type": "subscribe", "protocol_version": 4, "game_id": GAME })),
        Act::Cmd(
            json!({ "type": "run_draft", "protocol_version": 4, "game_id": GAME,
                         "request_id": "d1", "script": [] }),
        ),
        Act::Cmd(
            json!({ "type": "set_reaction_mode", "protocol_version": 4, "game_id": GAME,
                         "card": card, "mode": "never" }),
        ),
        Act::Leave,
    ]);
    install(&queried, seed, "a");
    start(&setup(seed, 4), None);
    let page = queried.lock().unwrap();
    let find = |kind: &str| -> Vec<&Value> {
        page.messages.iter().filter(|m| m["type"] == kind).collect()
    };
    let reach = find("reach_into");
    assert_eq!(reach.len(), 2);
    assert_eq!(reach[0]["request_id"], 9);
    assert_eq!(reach[0]["refused"], Value::Null, "{}", reach[0]);
    assert_eq!(reach[1]["refused"], "unknown_system");
    // A new connection gets the position that the last update showed.
    let snapshots = find("initial_snapshot");
    assert_eq!(snapshots.len(), 2);
    let at = page
        .messages
        .iter()
        .rposition(|m| m["type"] == "initial_snapshot")
        .unwrap();
    let before = last_question(&page.messages[..at]);
    assert_eq!(snapshots[1]["state"], before["state"]);
    assert_eq!(snapshots[1]["pending_choice"], before["pending_choice"]);
    let outcome = find("draft_outcome");
    assert_eq!(outcome.len(), 1);
    assert_eq!(outcome[0]["request_id"], "d1");
    // The copy of the game that the draft is run on is the live game, though the other seats
    // are rule bots that decided since the last checkpoint.
    let at = page
        .messages
        .iter()
        .position(|m| m["type"] == "draft_outcome")
        .unwrap();
    let live = last_question(&page.messages[..at]);
    let (drafted, now) = (&outcome[0]["outcome"]["update"]["view"], &live["view"]);
    let differing: Vec<&String> = drafted
        .as_object()
        .unwrap()
        .keys()
        .filter(|key| drafted[key.as_str()] != now[key.as_str()])
        .collect();
    assert!(
        differing.is_empty(),
        "the draft starts where the game is: {differing:?}"
    );
    let update = find("state_update");
    assert_eq!(
        update.last().unwrap()["reaction_modes"][&card],
        "never",
        "the setting is in the next update"
    );
    drop(page);
    // The Never set is part of the save.
    let save = send(&json!({ "type": "save_state" }));
    assert_eq!(save["save"]["never"], json!([card]));
    assert!(host_api::out_text().contains("never"));
}

/// Answers with the decisions of a save, in order; with nothing left, it fails. A seat that draws
/// from the random seats' stream draws from `stream` too, which must give the saved decision.
struct Tail {
    log: std::collections::VecDeque<String>,
    stream: (ti4_engine::choice::SeededRandom, u32),
    drawn: Arc<Mutex<usize>>,
}

impl ti4_engine::choice::Decider for Tail {
    fn choose(
        &mut self,
        choice: &ti4_engine::choice::Choice,
    ) -> Result<ti4_engine::choice::ChoiceOption, ti4_engine::choice::IllegalChoice> {
        let wanted = self.log.pop_front().ok_or_else(|| {
            ti4_engine::choice::IllegalChoice::DeciderFailed {
                player: choice.player.clone(),
                prompt: choice.prompt.clone(),
                reason: "the save has no more decisions".to_owned(),
            }
        })?;
        let (stream, humans) = &mut self.stream;
        let seat = choice.player.as_str().as_bytes()[0] - b'a';
        if *humans >> seat & 1 == 0 {
            let drawn = stream.choose(choice)?;
            assert_eq!(drawn.id, wanted, "the stream draws the saved decision");
            *self.drawn.lock().unwrap() += 1;
        }
        Ok(choice
            .option(&wanted)
            .expect("the saved decision is offered")
            .clone())
    }
}

/// The game of `save`, from its position and the decisions after it: the decider runs out at the
/// question the save was taken at. Returns the game, the state that question was offered on, and
/// how many decisions of the random seats were drawn again from the stored stream.
fn played_from_position(
    save: &Value,
    position: &ti4_wasm::position::Position,
) -> (
    ti4_engine::game::Game<'static>,
    Option<ti4_model::state::GameState>,
    usize,
) {
    let start: ti4_wasm::host_setup::Start =
        serde_json::from_value(json!({ "resume": save })).unwrap();
    let built = start.build().unwrap();
    let decisions: Vec<String> = serde_json::from_value(save["decisions"].clone()).unwrap();
    assert!(
        !built.table && built.bots.iter().all(Option::is_none),
        "every seat of the page's game draws from the stream"
    );
    let mut stream = ti4_engine::choice::SeededRandom::new(built.seed);
    stream.set_position(position.play.random.expect("a game with random seats"));
    let drawn = Arc::new(Mutex::new(0));
    let tail = Tail {
        log: decisions[position.game.log_len..].iter().cloned().collect(),
        stream: (stream, built.humans),
        drawn: drawn.clone(),
    };
    let offered = Arc::new(Mutex::new(None));
    let mut table = ti4_engine::choice::Table::with_default(Box::new(tail));
    let seen = offered.clone();
    table.on_observed_offer(move |_, state| *seen.lock().unwrap() = Some(state.clone()));
    let mut game = position.game.clone().restore(
        &position.records,
        ti4_content::ContentStore::embedded(),
        table,
        built.galaxy,
    );
    for _ in 0..10_000 {
        if game.step().error.is_some() {
            break;
        }
    }
    let offered = offered.lock().unwrap().take();
    let drawn = *drawn.lock().unwrap();
    (game, offered, drawn)
}

/// A save, the position the page was shown, and the decisions of the session.
type Look = (Value, ti4_model::state::GameState, Vec<String>);

/// A save keeps the game at its last quiet step: the engine, the decisions before it, and what
/// the session and the play loop hold there. Restored and played on with the rest of the log, it
/// reaches the question that the save was taken at.
#[test]
fn a_late_save_keeps_a_position_that_plays_on_to_its_question() {
    let _serial = crate::common::serial();
    let seed = 5;
    // A save at each of ten questions; the session is looked at with each.
    let looks: Arc<Mutex<Vec<Look>>> = Arc::default();
    let mut script = vec![Act::Answer(70)];
    for _ in 0..10 {
        let looks = looks.clone();
        script.push(Act::Probe(Box::new(move |page| {
            let save = send(&json!({ "type": "save_state" }))["save"].clone();
            let (state, events, answers, log) = host_api::with(|session| {
                (
                    session.state().clone(),
                    session.events().to_vec(),
                    session.answers().len(),
                    session.decision_log().to_vec(),
                )
            })
            .unwrap();
            if let Some(saved) = save.get("position") {
                let position: ti4_wasm::position::Position =
                    serde_json::from_str(saved["data"].as_str().unwrap()).unwrap();
                // What the session holds there is a prefix of what it holds at the save.
                assert_eq!(log[..position.game.log_len], position.records[..]);
                let held = position.session.events.len();
                assert_eq!(events[..held], position.session.events[..]);
                assert!(position.session.answers <= answers);
                assert_eq!(position.session.undo.len(), position.session.answers);
            }
            let chosen = log.iter().map(|record| record.chosen.clone()).collect();
            looks.lock().unwrap().push((save, state, chosen));
            page.script.push_front(Act::Answer(1));
        })));
    }
    script.push(Act::Leave);
    let first = page(script);
    install(&first, seed, "a");
    // A local game: the seats that the page does not play draw from the random seats' stream.
    let request = json!({ "local": { "seed": seed, "players": 6, "humans": 1 } });
    let len = host_api::put_input(&request.to_string());
    assert!(
        ti4_wasm::ti4_host_start(u32::try_from(len).unwrap()) >= 0,
        "{}",
        host_api::out_text()
    );

    let mut drawn = 0;
    for (save, shown, log) in looks.lock().unwrap().iter() {
        let decisions: Vec<String> = serde_json::from_value(save["decisions"].clone()).unwrap();
        assert_eq!(&decisions, log);
        assert!(decisions.len() > 200, "{} decisions", decisions.len());
        let saved: ti4_wasm::position::SavedPosition =
            serde_json::from_value(save["position"].clone()).expect("a late save has a position");
        assert_eq!(saved.build, save["engine"]["build"]);
        assert_eq!(saved.content_digest, save["engine"]["content_digest"]);
        assert!(saved.log_len <= decisions.len());
        let position: ti4_wasm::position::Position = serde_json::from_str(&saved.data).unwrap();
        assert_eq!(position.game.log_len, saved.log_len);
        assert!(position.game.fits(&position.records));
        assert!(position.play.decided <= decisions.len() as u64);

        // Restored, the game plays the rest of the log, the random seats drawing from the
        // stored stream, and stops at the question of the save, on the position it was shown.
        let (game, offered, random) = played_from_position(save, &position);
        let replayed: Vec<&str> = game
            .table
            .log
            .records
            .iter()
            .map(|r| r.chosen.as_str())
            .collect();
        assert_eq!(replayed, decisions);
        assert_eq!(
            serde_json::to_value(offered.expect("the question is offered")).unwrap(),
            serde_json::to_value(shown).unwrap(),
        );
        drawn += random;
    }
    assert!(drawn > 0, "the random seats decided after a position");
}

/// An MLP seat carries its power map from its first decision on: a save of its table has no
/// position.
#[test]
fn a_save_of_a_table_with_an_mlp_seat_has_no_position() {
    let _serial = crate::common::serial();
    let _model = ti4_host::bots::test_model();
    let first = page(vec![
        Act::Answer(12),
        Act::Cmd(json!({ "type": "save_state" })),
        Act::Leave,
    ]);
    install(&first, 3, "a");
    let request = json!({
        "local": { "seed": 3, "players": 4, "humans": 1, "bots": [null, "mlp:test", "random"] },
    });
    let len = host_api::put_input(&request.to_string());
    assert!(
        ti4_wasm::ti4_host_start(u32::try_from(len).unwrap()) >= 0,
        "{}",
        host_api::out_text()
    );
    let save = first.lock().unwrap().replies.last().unwrap()["save"].clone();
    assert!(save["decisions"].as_array().unwrap().len() > 20);
    assert!(save.get("position").is_none(), "{}", save["position"]);
}

/// Start the game of `request` (with the page as `viewer`, answering by the rule bot of its
/// seat), run `acts`, save and leave; returns the save.
fn saved_after(request: &Value, seed: u64, viewer: &str, mut acts: Vec<Act>) -> Value {
    acts.push(Act::Cmd(json!({ "type": "save_state" })));
    acts.push(Act::Leave);
    let first = page(acts);
    install(&first, seed, viewer);
    let len = host_api::put_input(&request.to_string());
    assert!(
        ti4_wasm::ti4_host_start(u32::try_from(len).unwrap()) >= 0,
        "{}",
        host_api::out_text()
    );
    let first = first.lock().unwrap();
    first.replies.last().unwrap()["save"].clone()
}

/// What a run of a save showed and did.
#[derive(Clone)]
struct Resumed {
    /// The first message of the run: an `initial_snapshot`, or the `end` envelope of a game that
    /// was over.
    first: Value,
    /// The `resume_check` of the first ask.
    check: Value,
    /// The answers of the page after the snapshot.
    answers: Vec<String>,
    /// The save at the end of the run.
    save: Value,
    /// The decisions of the stored position the run started from.
    from: Option<usize>,
    /// Progress envelopes: `(done, total)`.
    progress: Vec<(u64, u64)>,
}

/// Resume `resume` (a save, or a restart with `game`), answer `more` questions, save and leave.
fn resumed(request: &Value, seed: u64, viewer: &str, more: usize) -> Resumed {
    let second = page(vec![
        Act::Answer(more),
        Act::Cmd(json!({ "type": "save_state" })),
        Act::Leave,
    ]);
    install(&second, seed, viewer);
    let len = host_api::put_input(&request.to_string());
    let status = ti4_wasm::ti4_host_start(u32::try_from(len).unwrap());
    let end: Value = serde_json::from_str(&host_api::out_text()).unwrap();
    assert!(status >= 0, "{end}");
    let from = host_api::restored_from();
    let second = second.lock().unwrap();
    let save = second
        .replies
        .iter()
        .rev()
        .find(|reply| reply["save"].is_object())
        .map_or_else(
            || send(&json!({ "type": "save_state" }))["save"].clone(),
            |reply| reply["save"].clone(),
        );
    Resumed {
        first: second.messages.first().cloned().unwrap_or(end),
        check: second
            .asks
            .first()
            .map_or(Value::Null, |ask| ask["resume_check"].clone()),
        answers: second.answers.clone(),
        save,
        from,
        progress: second.progress.clone(),
    }
}

/// `save` without its position.
fn without_position(save: &Value) -> Value {
    let mut save = save.clone();
    save.as_object_mut().unwrap().remove("position");
    save
}

fn position_of(save: &Value) -> ti4_wasm::position::Position {
    serde_json::from_str(save["position"]["data"].as_str().expect("a position")).unwrap()
}

/// The two runs are the same game: the same first snapshot (state, events with their times,
/// pending choice, history), the same check, and the same decisions after it.
fn same_runs(with: &Resumed, without: &Resumed) {
    same_runs_timed(with, without, true);
}

/// [`same_runs`]; without `timed` the times of day of the events are not compared (a new run
/// of a history change makes its events again, at the time it runs).
fn same_runs_timed(with: &Resumed, without: &Resumed, timed: bool) {
    let untimed = |first: &Value| {
        let mut first = first.clone();
        if !timed && let Some(events) = first["events"].as_array_mut() {
            for event in events {
                event.as_object_mut().unwrap().remove("timestamp");
            }
        }
        first
    };
    let (with_first, without_first) = (untimed(&with.first), untimed(&without.first));
    let (with, without) = (
        &Resumed {
            first: with_first,
            ..with.clone()
        },
        &Resumed {
            first: without_first,
            ..without.clone()
        },
    );
    assert_eq!(without.from, None);
    if !with.check.is_null() {
        assert_eq!(with.check["ok"], true, "{}", with.check);
    }
    assert_eq!(with.check, without.check);
    assert_eq!(with.first["type"], without.first["type"]);
    for key in [
        "state",
        "pending_choice",
        "history",
        "events",
        "game_version",
        "view",
    ] {
        assert_eq!(
            with.first[key], without.first[key],
            "{key} of the first message"
        );
    }
    assert_eq!(with.first, without.first);
    assert_eq!(with.answers, without.answers);
    for key in [
        "decisions",
        "decisions_hash",
        "answers",
        "redo",
        "switches",
        "version",
        "generation",
        "finished",
    ] {
        assert_eq!(with.save[key], without.save[key], "{key} of the save after");
    }
}

/// Resume `save` with and without its position, play `more` answers on, and check that both are
/// the same game. Returns the run with the position.
fn resumes_the_same(save: &Value, seed: u64, viewer: &str, more: usize) -> Resumed {
    let position = position_of(save);
    let with = resumed(&json!({ "resume": save }), seed, viewer, more);
    let without = resumed(
        &json!({ "resume": without_position(save) }),
        seed,
        viewer,
        more,
    );
    assert_eq!(
        with.from,
        Some(position.game.log_len),
        "the run starts from the position"
    );
    same_runs(&with, &without);
    // The progress counts only the decisions after the position.
    let decisions = save["decisions"].as_array().unwrap().len();
    if let Some((_, total)) = with.progress.last() {
        assert_eq!(*total as usize, decisions - position.game.log_len);
    }
    with
}

/// A late save of random seats resumes from its position to the same question as from its seed,
/// and plays on the same.
#[test]
fn a_resume_from_the_position_is_the_resume_from_the_seed() {
    let _serial = crate::common::serial();
    let seed = 5;
    let request = json!({ "local": { "seed": seed, "players": 6, "humans": 1 } });
    let save = saved_after(&request, seed, "a", vec![Act::Answer(45)]);
    assert!(save["position"].is_object(), "a late save has a position");
    resumes_the_same(&save, seed, "a", 8);
    // A save right after the reload keeps the position it started from.
    let right_after = resumed(&json!({ "resume": save }), seed, "a", 0);
    assert_eq!(right_after.save["position"], save["position"]);
}

/// A table with rule-bot seats and a random seat.
#[test]
fn a_table_resumes_from_its_position_the_same() {
    let _serial = crate::common::serial();
    let seed = 7;
    let request = json!({ "table": {
        "setup": { "player_count": 4, "seed": seed },
        "seats": [{ "kind": "human" }, { "kind": "smart" }, { "kind": "smart" }, { "kind": "random" }],
    }});
    let save = saved_after(&request, seed, "a", vec![Act::Answer(35)]);
    assert!(save["position"].is_object(), "a late save has a position");
    resumes_the_same(&save, seed, "a", 8);
}

/// The page changed its seats before the position: the switch is in force from the position on,
/// with the number of the question it came into force at.
#[test]
fn a_switch_of_the_seats_before_the_position_resumes_the_same() {
    let _serial = crate::common::serial();
    let seed = 9;
    let request = json!({ "local": { "seed": seed, "players": 4, "humans": 1 } });
    let save = saved_after(
        &request,
        seed,
        "a",
        vec![
            Act::Answer(10),
            Act::Cmd(json!({ "type": "switch_seat", "seat": "c" })),
            Act::Answer(30),
        ],
    );
    let switches = save["switches"].as_array().unwrap();
    assert_eq!(switches.len(), 1);
    let position = position_of(&save);
    assert!(position.game.log_len as u64 > switches[0]["decision"].as_u64().unwrap());
    assert_eq!(position.play.switches_asked.len(), 1);
    resumes_the_same(&save, seed, "a", 8);
}

/// A position of another build, or one whose decisions are not the save's, is not read: the game
/// replays from the seed, to the same question.
#[test]
fn a_position_of_another_build_or_other_decisions_is_not_read() {
    let _serial = crate::common::serial();
    let seed = 5;
    let request = json!({ "local": { "seed": seed, "players": 4, "humans": 1 } });
    let save = saved_after(&request, seed, "a", vec![Act::Answer(30)]);
    let without = resumed(&json!({ "resume": without_position(&save) }), seed, "a", 3);

    let mut other_build = save.clone();
    other_build["position"]["build"] = json!("0.0.0-other");
    let run = resumed(&json!({ "resume": other_build }), seed, "a", 3);
    assert_eq!(run.from, None);
    same_runs(&run, &without);

    // One decision of the position is not the save's.
    let mut position = position_of(&save);
    let at = position.game.log_len / 2;
    let other = position.records[at]
        .offered
        .iter()
        .find(|id| **id != position.records[at].chosen)
        .cloned()
        .unwrap_or_else(|| "another".to_owned());
    position.records[at].chosen = other;
    let mut changed = save.clone();
    changed["position"]["data"] = json!(serde_json::to_string(&position).unwrap());
    let run = resumed(&json!({ "resume": changed }), seed, "a", 3);
    assert_eq!(run.from, None);
    same_runs(&run, &without);

    // A position that does not read is dropped too.
    let mut broken = save.clone();
    broken["position"] = json!({ "build": 3 });
    let run = resumed(&json!({ "resume": broken }), seed, "a", 3);
    assert_eq!(run.from, None);
    same_runs(&run, &without);
}

/// After a reload from a position the checkpoints begin there. Undoing answers back past the
/// position plays the game again (a restart with the log cut there, and no position that fits
/// it); the game is the same as after the reload from the seed, where the checkpoints reach.
#[test]
fn an_undo_past_the_position_after_a_reload_plays_the_same() {
    let _serial = crate::common::serial();
    let seed = 5;
    let request = json!({ "local": { "seed": seed, "players": 4, "humans": 1 } });
    let save = saved_after(&request, seed, "a", vec![Act::Answer(30)]);
    let position = position_of(&save);
    let answers = save["answers"].as_array().unwrap().len();
    // One undo more than the answers after the position.
    let undos = answers - position.session.answers + 1;
    // Each undo is a command at the question it takes back from.
    // Returns the restart, the question after the undos and the save after four more answers.
    let run = |resume: &Value| -> (Option<Value>, Value, Value) {
        let mut acts = Vec::new();
        for _ in 0..undos {
            acts.push(Act::Probe(Box::new(|page| {
                let (_, version, _, _) = pending(&page.messages).unwrap();
                page.script.push_front(Act::Cmd(json!({
                    "type": "undo", "protocol_version": 4, "game_id": GAME,
                    "expected_version": version,
                })));
            })));
        }
        let undone: Arc<Mutex<Value>> = Arc::default();
        let seen = undone.clone();
        acts.push(Act::Probe(Box::new(move |page| {
            *seen.lock().unwrap() = last_question(&page.messages).clone();
        })));
        acts.push(Act::Answer(4));
        acts.push(Act::Cmd(json!({ "type": "save_state" })));
        acts.push(Act::Leave);
        let page = page(acts);
        install(&page, seed, "a");
        let len = host_api::put_input(&json!({ "resume": resume }).to_string());
        assert!(ti4_wasm::ti4_host_start(u32::try_from(len).unwrap()) >= 0);
        let page = page.lock().unwrap();
        let restart = page
            .replies
            .iter()
            .find(|reply| reply["restart"].is_object())
            .map(|reply| reply["restart"].clone());
        let save = page
            .replies
            .iter()
            .rev()
            .find(|reply| reply["save"].is_object())
            .map_or(Value::Null, |reply| reply["save"].clone());
        let undone = undone.lock().unwrap().clone();
        (restart, undone, save)
    };
    // From the seed: every undo comes from a checkpoint.
    let (restart, undone, plain) = run(&without_position(&save));
    assert_eq!(restart, None, "the checkpoints of the full replay reach");
    // From the position: the last undo goes back past it and restarts.
    let (restart, _, _) = run(&save);
    let restart = restart.expect("an undo past the position restarts the game");
    assert!(
        restart.get("position").is_none(),
        "the held position is after the answer that is taken back"
    );
    let log = restart["log"].as_array().unwrap().len();
    assert!(
        log < position.game.log_len,
        "{log} {}",
        position.game.log_len
    );
    let again = page(vec![
        Act::Answer(4),
        Act::Cmd(json!({ "type": "save_state" })),
        Act::Leave,
    ]);
    install(&again, seed, "a");
    let len =
        host_api::put_input(&json!({ "local": request["local"], "resume": restart }).to_string());
    assert!(ti4_wasm::ti4_host_start(u32::try_from(len).unwrap()) >= 0);
    assert_eq!(host_api::restored_from(), None);
    let again = again.lock().unwrap();
    let snapshot = &again.messages[0];
    assert_eq!(snapshot["type"], "initial_snapshot");
    assert_eq!(snapshot["state"], undone["state"]);
    assert_eq!(snapshot["pending_choice"], undone["pending_choice"]);
    let save = &again.replies.last().unwrap()["save"];
    assert_eq!(save["decisions"], plain["decisions"]);
    assert_eq!(save["decisions_hash"], plain["decisions_hash"]);
}

/// A rewind and a redo restart the game from the held position when it is before the first
/// answer they change, and play the same as from the seed.
#[test]
fn a_rewind_restarts_from_the_held_position() {
    let _serial = crate::common::serial();
    let seed = 5;
    let request = json!({ "local": { "seed": seed, "players": 4, "humans": 1 } });
    // A save at the 40th question, and at the 50th a rewind to the cursor of the 45th: the
    // position of the save is before it.
    let first = page(vec![
        Act::Answer(40),
        Act::Cmd(json!({ "type": "save_state" })),
        Act::Answer(10),
        Act::Probe(Box::new(|page| {
            let back = pending(page.asks[45]["messages"].as_array().unwrap()).unwrap();
            page.script.push_front(Act::Cmd(json!({
                "type": "history", "action": { "restore_cursor": { "cursor": back.3 } },
            })));
        })),
    ]);
    install(&first, seed, "a");
    let len = host_api::put_input(&request.to_string());
    assert!(ti4_wasm::ti4_host_start(u32::try_from(len).unwrap()) >= 0);
    let restart = first.lock().unwrap().replies.last().unwrap()["restart"].clone();
    assert!(
        restart["position"].is_object(),
        "the written position is before the cursor"
    );
    let with = resumed(
        &json!({ "local": request["local"], "resume": restart }),
        seed,
        "a",
        6,
    );
    let position: ti4_wasm::position::Position =
        serde_json::from_str(restart["position"]["data"].as_str().unwrap()).unwrap();
    assert_eq!(with.from, Some(position.game.log_len));
    let without = resumed(
        &json!({ "local": request["local"], "resume": without_position(&restart) }),
        seed,
        "a",
        6,
    );
    same_runs_timed(&with, &without, false);
}

/// A finished game resumes from its position to the same end.
#[test]
fn slow_a_finished_game_resumes_from_its_position_to_the_same_end() {
    let _serial = crate::common::serial();
    let seed = 3;
    let request = json!({ "local": { "seed": seed, "players": 3, "humans": 1 } });
    let first = page(vec![]);
    install(&first, seed, "a");
    let len = host_api::put_input(&request.to_string());
    assert!(ti4_wasm::ti4_host_start(u32::try_from(len).unwrap()) >= 0);
    let end: Value = serde_json::from_str(&host_api::out_text()).unwrap();
    assert_eq!(end["end"]["finished"], true, "{end}");
    let save = send(&json!({ "type": "save_state" }))["save"].clone();
    assert_eq!(save["finished"], true);
    assert!(save["position"].is_object());
    let with = resumed(&json!({ "resume": save }), seed, "a", 0);
    let without = resumed(&json!({ "resume": without_position(&save) }), seed, "a", 0);
    assert_eq!(with.from, Some(position_of(&save).game.log_len));
    same_runs(&with, &without);
    assert_eq!(with.save["finished"], true);
}
