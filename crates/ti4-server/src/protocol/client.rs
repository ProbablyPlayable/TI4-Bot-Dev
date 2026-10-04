//! Client to server messages.

use serde::{Deserialize, Serialize};

/// Largest externally supplied protocol fields accepted by the server.
pub const MAX_GAME_ID_BYTES: usize = 64;
pub const MAX_PLAYER_SESSION_BYTES: usize = 128;
pub const MAX_NONCE_BYTES: usize = 128;
pub const MAX_OPTION_ID_BYTES: usize = 1024;

/// Messages submitted from a client to the authoritative server.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientMessage {
    /// Subscribe to live updates for a game session.
    Subscribe {
        protocol_version: u16,
        game_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        player_session: Option<String>,
    },
    /// Submit an engine-offered option ID for an outstanding decision.
    SubmitChoice {
        protocol_version: u16,
        game_id: String,
        nonce: String,
        expected_version: u64,
        option_id: String,
    },
    /// Start an inactive authenticated player's tactical draft.
    StartPlanning {
        protocol_version: u16,
        game_id: String,
    },
    ResetPlanning {
        protocol_version: u16,
        game_id: String,
        identity: crate::planning::runner::AttemptIdentity,
    },
    EditPlanningMovement {
        protocol_version: u16,
        game_id: String,
        identity: crate::planning::runner::AttemptIdentity,
    },
    ApplyPlanning {
        protocol_version: u16,
        game_id: String,
        identity: crate::planning::runner::AttemptIdentity,
        nonce: String,
        expected_version: u64,
    },
    /// Answer an offer from the player's current planning attempt.
    SubmitPlanningChoice {
        protocol_version: u16,
        game_id: String,
        identity: crate::planning::runner::AttemptIdentity,
        option_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
    },
    /// Keep-alive ping message.
    Ping {
        protocol_version: u16,
        sequence: u64,
    },
}

impl std::fmt::Debug for ClientMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ApplyPlanning {
                game_id,
                identity,
                nonce,
                expected_version,
                ..
            } => f
                .debug_struct("ApplyPlanning")
                .field("game_id", game_id)
                .field("identity", identity)
                .field("nonce", nonce)
                .field("expected_version", expected_version)
                .finish(),
            Self::ResetPlanning {
                game_id, identity, ..
            } => f
                .debug_struct("ResetPlanning")
                .field("game_id", game_id)
                .field("identity", identity)
                .finish(),
            Self::EditPlanningMovement {
                game_id, identity, ..
            } => f
                .debug_struct("EditPlanningMovement")
                .field("game_id", game_id)
                .field("identity", identity)
                .finish(),
            Self::StartPlanning { game_id, .. } => f
                .debug_struct("StartPlanning")
                .field("game_id", game_id)
                .finish(),
            Self::SubmitPlanningChoice {
                game_id,
                identity,
                option_id,
                ..
            } => f
                .debug_struct("SubmitPlanningChoice")
                .field("game_id", game_id)
                .field("identity", identity)
                .field("option_id", option_id)
                .finish(),
            Self::Subscribe {
                protocol_version,
                game_id,
                player_session,
            } => f
                .debug_struct("Subscribe")
                .field("protocol_version", protocol_version)
                .field("game_id", game_id)
                .field(
                    "player_session",
                    &player_session.as_ref().map(|_| "[redacted]"),
                )
                .finish(),
            Self::SubmitChoice {
                protocol_version,
                game_id,
                nonce,
                expected_version,
                option_id,
            } => f
                .debug_struct("SubmitChoice")
                .field("protocol_version", protocol_version)
                .field("game_id", game_id)
                .field("nonce", nonce)
                .field("expected_version", expected_version)
                .field("option_id", option_id)
                .finish(),
            Self::Ping {
                protocol_version,
                sequence,
            } => f
                .debug_struct("Ping")
                .field("protocol_version", protocol_version)
                .field("sequence", sequence)
                .finish(),
        }
    }
}

impl ClientMessage {
    /// Returns the protocol version advertised by this message.
    #[must_use]
    pub fn protocol_version(&self) -> u16 {
        match self {
            Self::Subscribe {
                protocol_version, ..
            }
            | Self::SubmitChoice {
                protocol_version, ..
            }
            | Self::Ping {
                protocol_version, ..
            }
            | Self::StartPlanning {
                protocol_version, ..
            }
            | Self::ResetPlanning {
                protocol_version, ..
            }
            | Self::EditPlanningMovement {
                protocol_version, ..
            }
            | Self::ApplyPlanning {
                protocol_version, ..
            }
            | Self::SubmitPlanningChoice {
                protocol_version, ..
            } => *protocol_version,
        }
    }

    /// Rejects variable-length client fields before they reach session state.
    pub fn validate_bounds(&self) -> Result<(), &'static str> {
        match self {
            Self::ApplyPlanning { game_id, nonce, .. } => {
                bounded(game_id, MAX_GAME_ID_BYTES, "game_id")?;
                bounded(nonce, MAX_NONCE_BYTES, "nonce")?;
            }
            Self::StartPlanning { game_id, .. }
            | Self::ResetPlanning { game_id, .. }
            | Self::EditPlanningMovement { game_id, .. } => {
                bounded(game_id, MAX_GAME_ID_BYTES, "game_id")?
            }
            Self::SubmitPlanningChoice {
                game_id,
                option_id,
                request_id,
                ..
            } => {
                bounded(game_id, MAX_GAME_ID_BYTES, "game_id")?;
                bounded(option_id, MAX_OPTION_ID_BYTES, "option_id")?;
                if let Some(request_id) = request_id {
                    bounded(request_id, MAX_NONCE_BYTES, "request_id")?;
                }
            }
            Self::Subscribe {
                game_id,
                player_session,
                ..
            } => {
                bounded(game_id, MAX_GAME_ID_BYTES, "game_id")?;
                if let Some(token) = player_session {
                    bounded(token, MAX_PLAYER_SESSION_BYTES, "player_session")?;
                }
            }
            Self::SubmitChoice {
                game_id,
                nonce,
                option_id,
                ..
            } => {
                bounded(game_id, MAX_GAME_ID_BYTES, "game_id")?;
                bounded(nonce, MAX_NONCE_BYTES, "nonce")?;
                bounded(option_id, MAX_OPTION_ID_BYTES, "option_id")?;
            }
            Self::Ping { .. } => {}
        }
        Ok(())
    }
}

fn bounded(value: &str, limit: usize, field: &'static str) -> Result<(), &'static str> {
    if value.is_empty() || value.len() > limit {
        Err(field)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planning_messages_round_trip_and_validate_bounds() {
        let identity = crate::planning::runner::AttemptIdentity {
            checkpoint_id: 12,
            plan_revision: 3,
            generation_id: 2,
        };
        for message in [
            ClientMessage::StartPlanning {
                protocol_version: 1,
                game_id: "game".into(),
            },
            ClientMessage::ResetPlanning {
                protocol_version: 1,
                game_id: "game".into(),
                identity,
            },
            ClientMessage::ApplyPlanning {
                protocol_version: 1,
                game_id: "game".into(),
                identity,
                nonce: "current-choice".into(),
                expected_version: 9,
            },
            ClientMessage::SubmitPlanningChoice {
                protocol_version: 1,
                game_id: "game".into(),
                identity,
                option_id: "tactical".into(),
                request_id: Some("answer-request".into()),
            },
        ] {
            let encoded = serde_json::to_string(&message).unwrap();
            assert_eq!(
                serde_json::from_str::<ClientMessage>(&encoded).unwrap(),
                message
            );
            assert_eq!(message.validate_bounds(), Ok(()));
            assert_eq!(message.protocol_version(), 1);
        }
        assert_eq!(
            ClientMessage::StartPlanning {
                protocol_version: 1,
                game_id: String::new()
            }
            .validate_bounds(),
            Err("game_id")
        );
        assert_eq!(
            ClientMessage::SubmitPlanningChoice {
                protocol_version: 1,
                game_id: "game".into(),
                identity,
                option_id: "x".repeat(MAX_OPTION_ID_BYTES + 1),
                request_id: None,
            }
            .validate_bounds(),
            Err("option_id")
        );
        for request_id in [String::new(), "x".repeat(MAX_NONCE_BYTES + 1)] {
            assert_eq!(
                ClientMessage::SubmitPlanningChoice {
                    protocol_version: 1,
                    game_id: "game".into(),
                    identity,
                    option_id: "tactical".into(),
                    request_id: Some(request_id),
                }
                .validate_bounds(),
                Err("request_id")
            );
        }
        assert!(serde_json::from_value::<ClientMessage>(serde_json::json!({
            "type": "start_planning", "protocol_version": 1, "game_id": "game", "seat": "someone_else"
        })).is_err());
    }

    #[test]
    fn rejects_oversized_client_fields() {
        let message = ClientMessage::SubmitChoice {
            protocol_version: 1,
            game_id: "game".to_owned(),
            nonce: "n".repeat(MAX_NONCE_BYTES + 1),
            expected_version: 1,
            option_id: "option".to_owned(),
        };

        assert_eq!(message.validate_bounds(), Err("nonce"));
    }
}
