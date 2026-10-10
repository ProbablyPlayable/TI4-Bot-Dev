#!/usr/bin/env bash
# Builds the engine for local play and puts it where web2 imports it (about 2 minutes).
# Needs: rustup target add wasm32-unknown-unknown
set -euo pipefail
cd "$(dirname "$0")/../.."
cargo build -p ti4-wasm --target wasm32-unknown-unknown --profile wasm-release
cp target/wasm32-unknown-unknown/wasm-release/ti4_wasm.wasm web2/src/session/ti4.wasm
ls -l web2/src/session/ti4.wasm
