//! Writes the update of one choice of a native game to stdout, as a fixture for `web2/`.
//! Usage: cargo run -p ti4-wasm --example record -- <seed> <players> <human mask> <choice number> [option id ...]
//! Each asked choice is listed on stderr. The option ids answer the first choices, in order; a
//! choice without one is answered by a fixed rule.

use std::sync::{Arc, Mutex};

fn main() {
    let mut args = std::env::args().skip(1);
    let mut next = |default| {
        args.next()
            .and_then(|arg| arg.parse::<u32>().ok())
            .unwrap_or(default)
    };
    let (seed, players, mask, wanted) = (next(3), next(8), next(1), next(40));
    let mut script: std::collections::VecDeque<String> = args.collect();
    let recorded = Arc::new(Mutex::new(None));
    let sink = recorded.clone();
    let mut asked = 0_u32;
    ti4_wasm::set_native_host(move |update| {
        asked += 1;
        let value: serde_json::Value = serde_json::from_str(update).expect("an update is JSON");
        let choice = &value["pending_choice"]["choice"];
        let options = choice["options"].as_array().map_or(0, Vec::len);
        eprintln!(
            "{asked:4} {} {} [{options}] {} bytes",
            choice["player"].as_str().unwrap_or("?"),
            choice["prompt"].as_str().unwrap_or("?"),
            update.len()
        );
        if asked == wanted {
            *sink.lock().expect("sink lock") = Some(update.to_owned());
            return -1;
        }
        if let Some(id) = script.pop_front() {
            let index = choice["options"].as_array().and_then(|options| {
                options
                    .iter()
                    .position(|option| option["id"] == id.as_str())
            });
            let Some(index) = index else {
                eprintln!("choice {asked} does not offer {id:?}");
                return -1;
            };
            return i32::try_from(index).expect("an index is small");
        }
        // Not always the first option, so that the game moves on.
        i32::try_from(asked as usize * 7 % options.max(1)).expect("an index is small")
    });
    let status = ti4_wasm::ti4_play(seed, players, mask);
    if let Err(error) = ti4_wasm::response(status) {
        eprintln!("{error}");
        std::process::exit(1);
    }
    match recorded.lock().expect("sink lock").take() {
        Some(update) => println!("{update}"),
        None => {
            eprintln!("the game ended before choice {wanted}");
            std::process::exit(1);
        }
    }
}
