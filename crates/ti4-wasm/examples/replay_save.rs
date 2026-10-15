//! Replays an offline save natively, with the same host crate the browser runs, to reproduce the
//! position of a feedback report, and times a resume.
//!
//! ```text
//! server feedback-save --data-dir /var/lib/ti4-public --out save.json fb_1760227200_ab12cd34
//! cargo run -p ti4-wasm --example replay_save -- save.json [--snapshot snapshot.json]
//! cargo run --release -p ti4-wasm --example replay_save -- --new 3 8 120 save.json
//! ```
//!
//! The file may be the save blob itself, a stored report (`context.local.save`) or a request body.
//! The game is played again from its seed and every saved decision until the saved position;
//! the tool prints whether the decisions came back the same (count and hash of the save) and what
//! the person was asked there. `--snapshot FILE` also writes the full `initial_snapshot` message
//! (the board as the person saw it) for inspection. Exit code 1 when the replay differs. A save
//! with a stored position is resumed twice, from the position and from the seed, and both are
//! timed.
//!
//! `--new SEED PLAYERS ANSWERS FILE` plays a new local game first (seat `a` answers option
//! `7n mod options` at its n-th question, the other seats draw at random), saves after every
//! question as the page does and times each save, and writes the save at question `ANSWERS` to
//! `FILE`; that save is then resumed as above.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use ti4_wasm::host_api;

fn save_of(file: &Value) -> Option<Value> {
    [
        file.pointer("/context/local/save"),
        file.pointer("/local/save"),
        file.get("save"),
        Some(file),
    ]
    .into_iter()
    .flatten()
    .find(|v| v.get("game").is_some() && v.get("decisions").is_some())
    .cloned()
}

/// Send a command to the parked game; returns its envelope.
fn command(request: &Value) -> Value {
    let len = host_api::put_input(&request.to_string());
    let status = host_api::command(len);
    let out = host_api::out_text();
    assert!(status >= 0, "command {request} failed: {out}");
    serde_json::from_str(&out).expect("an envelope is JSON")
}

/// One save of [`play_new`]: its time, the decisions of its position, and the size of the
/// position's data.
type Saved = (Duration, Option<u64>, usize);

/// Play a new local game of `players` seats to the question `answers` of seat `a`, saving after
/// every question; prints what the saves cost and writes the last one to `out`.
fn play_new(seed: u64, players: u64, answers: usize, out: &str) -> Result<(), String> {
    let saves: Arc<Mutex<Vec<Saved>>> = Arc::default();
    let last: Arc<Mutex<Option<Value>>> = Arc::default();
    let (sink, keep) = (saves.clone(), last.clone());
    let mut asked = 0_usize;
    ti4_wasm::set_native_host(move |text: &str| {
        let envelope: Value = serde_json::from_str(text).expect("the output is JSON");
        match envelope["kind"].as_str() {
            Some("progress") => return host_api::CONTINUE,
            Some("ask") => {}
            _ => return -1,
        }
        let start = Instant::now();
        let save = command(&json!({ "type": "save_state" }))["save"].clone();
        let took = start.elapsed();
        let position = save.get("position");
        sink.lock().expect("saves").push((
            took,
            position.and_then(|p| p["log_len"].as_u64()),
            position
                .and_then(|p| p["data"].as_str())
                .map_or(0, str::len),
        ));
        *keep.lock().expect("last") = Some(save);
        if asked == answers {
            return -1;
        }
        let options = envelope["messages"]
            .as_array()
            .and_then(|messages| {
                messages
                    .iter()
                    .rev()
                    .find_map(|m| m.pointer("/pending_choice/choice/options")?.as_array())
            })
            .map_or(1, Vec::len);
        let index = (7 * asked) % options;
        asked += 1;
        i32::try_from(index).expect("an index")
    });
    let request = json!({ "local": { "seed": seed, "players": players, "humans": 1 } });
    let started = Instant::now();
    let len = host_api::put_input(&request.to_string());
    let status = ti4_wasm::ti4_host_start(u32::try_from(len).map_err(|e| e.to_string())?);
    if status < 0 {
        return Err(format!("the game failed: {}", host_api::out_text()));
    }
    let played = started.elapsed();
    let save = last
        .lock()
        .expect("last")
        .take()
        .ok_or("no question was asked")?;
    let saves = saves.lock().expect("saves");
    let mut written: Vec<Duration> = Vec::new();
    let mut again: Vec<Duration> = Vec::new();
    let mut previous = None;
    for (took, log_len, _) in saves.iter() {
        if log_len.is_some() && *log_len != previous {
            written.push(*took);
        } else {
            again.push(*took);
        }
        previous = *log_len;
    }
    let stats = |times: &mut Vec<Duration>| {
        times.sort();
        let at = |share: f64| {
            times
                .get(((times.len() as f64 - 1.0) * share) as usize)
                .map_or(0.0, |t| t.as_secs_f64() * 1000.0)
        };
        format!(
            "{} saves, median {:.1} ms, 90% {:.1} ms, max {:.1} ms",
            times.len(),
            at(0.5),
            at(0.9),
            at(1.0)
        )
    };
    println!(
        "played {} decisions, {answers} questions of seat a, in {:.2} s (saves included)",
        save["decisions"].as_array().map_or(0, Vec::len),
        played.as_secs_f64()
    );
    println!(
        "saves that write the position anew: {}",
        stats(&mut written)
    );
    println!(
        "saves that write the last position again: {}",
        stats(&mut again)
    );
    let text = serde_json::to_string(&save).map_err(|e| e.to_string())?;
    println!(
        "the last save: {} bytes, of them the position {} bytes after {} of {} decisions",
        text.len(),
        save.pointer("/position/data")
            .and_then(Value::as_str)
            .map_or(0, str::len),
        save.pointer("/position/log_len").unwrap_or(&Value::Null),
        save["decisions"].as_array().map_or(0, Vec::len),
    );
    std::fs::write(out, text).map_err(|e| format!("{out}: {e}"))
}

/// Resume `save` to its question and leave; returns the ask (if any), the end and the time.
fn resume(save: &Value) -> Result<(Option<Value>, String, Duration), String> {
    // The first question after the replay ends the run; keep what it showed.
    let seen: Arc<Mutex<Option<Value>>> = Arc::default();
    let sink = seen.clone();
    ti4_wasm::set_native_host(move |text: &str| {
        let envelope: Value = serde_json::from_str(text).expect("the output is JSON");
        match envelope["kind"].as_str() {
            Some("progress") => return host_api::CONTINUE,
            Some("ask") => *sink.lock().expect("sink") = Some(envelope),
            _ => {}
        }
        -1
    });
    let request = json!({ "resume": save });
    let started = Instant::now();
    let len = host_api::put_input(&request.to_string());
    let status = ti4_wasm::ti4_host_start(u32::try_from(len).map_err(|e| e.to_string())?);
    let took = started.elapsed();
    let end = host_api::out_text();
    if status < 0 {
        return Err(format!("the replay failed: {end}"));
    }
    let ask = seen.lock().expect("seen").take();
    Ok((ask, end, took))
}

fn main() -> Result<(), String> {
    let mut path = None;
    let mut snapshot_path = None;
    let mut new = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--snapshot" => snapshot_path = Some(args.next().ok_or("--snapshot needs a file")?),
            "--new" => {
                let mut number = || -> Result<u64, String> {
                    args.next()
                        .ok_or("--new SEED PLAYERS ANSWERS FILE")?
                        .parse()
                        .map_err(|e| format!("--new: {e}"))
                };
                new = Some((number()?, number()?, number()?));
            }
            _ if path.is_none() => path = Some(arg),
            _ => return Err(format!("unexpected argument {arg:?}")),
        }
    }
    let path =
        path.ok_or("usage: replay_save SAVE.json [--snapshot FILE] [--new SEED PLAYERS ANSWERS]")?;
    if let Some((seed, players, answers)) = new {
        play_new(
            seed,
            players,
            usize::try_from(answers).map_err(|e| e.to_string())?,
            &path,
        )?;
    }
    let file: Value =
        serde_json::from_slice(&std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?)
            .map_err(|e| format!("{path}: {e}"))?;
    let save = save_of(&file).ok_or("no save found (need game and decisions)")?;
    let seed = save["seed"].as_u64().ok_or("save.seed")?;
    let humans = save["humans"].as_u64().unwrap_or(0);
    if let Some(local) = file.pointer("/context/local").or_else(|| file.get("local")) {
        println!(
            "report: seed {seed}, engine build {}, content {}, wasm {}",
            local.pointer("/engine/build").unwrap_or(&Value::Null),
            local
                .pointer("/engine/content_digest")
                .unwrap_or(&Value::Null),
            local.get("wasm_sha256").unwrap_or(&Value::Null),
        );
    }

    let (ask, end, took) = resume(&save)?;
    let decisions = save["decisions"].as_array().map_or(0, Vec::len);
    match host_api::restored_from() {
        Some(from) => println!(
            "resumed from the position after {from} decisions, {} replayed: {:.3} s",
            decisions - from,
            took.as_secs_f64()
        ),
        None => println!("resumed from the seed: {:.3} s", took.as_secs_f64()),
    }
    if save.get("position").is_some() {
        let mut plain = save.clone();
        plain
            .as_object_mut()
            .expect("a save is an object")
            .remove("position");
        let (_, _, seeded) = resume(&plain)?;
        println!(
            "resumed from the seed, {decisions} replayed: {:.3} s",
            seeded.as_secs_f64()
        );
    }
    let ask = ask.ok_or_else(|| format!("the game ended before a question: {end}"))?;
    let snapshot = ask["messages"]
        .as_array()
        .and_then(|m| m.iter().find(|m| m["type"] == "initial_snapshot"))
        .cloned()
        .unwrap_or(Value::Null);
    let check = &ask["resume_check"];
    println!(
        "replayed {} decisions, the page's seats {humans:#b}: round {} phase {} version {}",
        save["decisions"].as_array().map_or(0, Vec::len),
        snapshot.pointer("/state/round").unwrap_or(&Value::Null),
        snapshot.pointer("/state/phase").unwrap_or(&Value::Null),
        snapshot.get("game_version").unwrap_or(&Value::Null),
    );
    println!(
        "saved: format {} hash {}",
        save["format"], save["decisions_hash"]
    );
    println!("check: {check}");
    println!(
        "question: {}",
        snapshot
            .pointer("/pending_choice/choice/prompt")
            .unwrap_or(&Value::Null)
    );
    if let Some(out) = snapshot_path {
        std::fs::write(
            &out,
            serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("{out}: {e}"))?;
        println!("wrote {out}");
    }
    if check["ok"] == true {
        println!("OK: the position is reproduced");
        Ok(())
    } else {
        println!("DIFFERENT: this build decides otherwise than the one that made the save");
        std::process::exit(1);
    }
}
