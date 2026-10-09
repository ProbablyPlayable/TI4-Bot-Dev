//! `ti4-view` turns engine state into the redacted views a client is shown.
//!
//! It depends on the model, the content and the engine only, so the server and the wasm build
//! both use it.

#![allow(clippy::missing_panics_doc, clippy::missing_errors_doc)]

pub mod map;
pub mod projection;
pub mod status;
pub mod view;
