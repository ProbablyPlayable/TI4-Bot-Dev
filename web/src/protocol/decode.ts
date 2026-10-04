import {
  JoinResponse,
  CreateGameResponse,
  InitialSnapshotMsg,
  LobbyDto,
  PROTOCOL_VERSION,
  ServerMessage,
} from "./types.ts";
import { validNickname } from "./nickname.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function fail(message: string): never {
  throw new Error(`Invalid server message: ${message}`);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

const isGameId = (value: unknown): value is string => isBoundedString(value, 64);
const isSlotId = (value: unknown): value is string => isBoundedString(value, 64);
const isPlayerId = (value: unknown): value is string => isBoundedString(value, 128);
const isPlayerSession = (value: unknown): value is string => isBoundedString(value, 128);

function isAttempt(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["checkpoint_id", "plan_revision", "generation_id"].every((key) =>
      isNonNegativeInteger(value[key]),
    )
  );
}

function isPlanningPublication(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.position) ||
    !isRecord(value.position.board) ||
    !isRecord(value.position.board.systems) ||
    !Array.isArray(value.position.players) ||
    !Array.isArray(value.position.seating_order) ||
    !isRecord(value.position.table) ||
    !Array.isArray(value.events) ||
    !value.events.every((event) => typeof event === "string")
  )
    return false;
  const choice = value.choice;
  return (
    choice === null ||
    (isRecord(choice) &&
      typeof choice.player === "string" &&
      typeof choice.prompt === "string" &&
      Array.isArray(choice.options) &&
      choice.options.every(
        (option) =>
          isRecord(option) &&
          typeof option.id === "string" &&
          typeof option.label === "string" &&
          (option.payload === undefined || isRecord(option.payload)),
      ) &&
      (choice.context === undefined ||
        (isRecord(choice.context) && typeof choice.context.subtype === "string")))
  );
}

export function decodeLobby(value: unknown, expectedGameId: string): LobbyDto {
  if (!isRecord(value) || value.game_id !== expectedGameId) fail("invalid lobby game id");
  if (value.phase !== "lobby" && value.phase !== "running") fail("invalid lobby phase");
  if (!isNonNegativeInteger(value.lobby_version) || !isPlayerId(value.host_player_id))
    fail("invalid lobby metadata");
  if (!Array.isArray(value.slots) || value.slots.length < 2 || value.slots.length > 8)
    fail("invalid lobby slots");
  const slots = new Set<string>();
  const players = new Set<string>();
  for (const [index, entry] of value.slots.entries()) {
    if (
      !isRecord(entry) ||
      !isSlotId(entry.slot_id) ||
      slots.has(entry.slot_id) ||
      entry.position !== index + 1 ||
      (entry.occupant !== null && !isPlayerId(entry.occupant)) ||
      typeof entry.ready !== "boolean" ||
      typeof entry.connected !== "boolean" ||
      typeof entry.can_take_over !== "boolean" ||
      (entry.occupant === null
        ? entry.nickname !== null || entry.ready || entry.connected || entry.can_take_over
        : !validNickname(entry.nickname)) ||
      (entry.occupant !== null && players.has(entry.occupant))
    )
      fail("invalid lobby slot");
    slots.add(entry.slot_id);
    if (entry.occupant !== null) players.add(entry.occupant);
  }
  if (!players.has(value.host_player_id)) fail("unknown lobby host");
  return {
    game_id: value.game_id,
    phase: value.phase,
    lobby_version: value.lobby_version,
    host_player_id: value.host_player_id,
    slots: value.slots.map((entry: Record<string, unknown>) => ({
      slot_id: entry.slot_id,
      position: entry.position,
      occupant: entry.occupant,
      nickname: entry.nickname,
      ready: entry.ready,
      connected: entry.connected,
      can_take_over: entry.can_take_over,
    })),
    bot_service_enabled: Boolean(value.bot_service_enabled),
  } as LobbyDto;
}

export function decodeCreateGameResponse(value: unknown): CreateGameResponse {
  if (
    !isRecord(value) ||
    !isGameId(value.game_id) ||
    !isPlayerSession(value.player_session) ||
    !isRecord(value.player) ||
    !isPlayerId(value.player.id)
  )
    fail("invalid game creation response");
  const lobby = decodeLobby(value.lobby, value.game_id);
  const player = value.player as Record<string, unknown>;
  if (!lobby.slots.some((slot) => slot.occupant === player.id)) fail("unknown player");
  return {
    game_id: value.game_id,
    player_session: value.player_session,
    player: { id: player.id as string },
    lobby,
  };
}

export function decodeJoinResponse(value: unknown, expectedGameId: string): JoinResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.player) ||
    !isPlayerId(value.player.id) ||
    (value.player_session !== null &&
      value.player_session !== undefined &&
      !isPlayerSession(value.player_session))
  )
    fail("invalid join response");
  const lobby = decodeLobby(value.lobby, expectedGameId);
  const player = value.player as Record<string, unknown>;
  if (!lobby.slots.some((slot) => slot.occupant === player.id)) fail("unknown player");
  return {
    player_session: value.player_session ?? undefined,
    player: { id: player.id as string },
    lobby,
  };
}

/** Validates the protocol envelope before React consumes any network payload. */
export function decodeServerMessage(value: unknown, expectedGameId: string): ServerMessage {
  if (!isRecord(value) || typeof value.type !== "string") fail("missing message type");
  if (value.protocol_version !== PROTOCOL_VERSION) fail("unsupported protocol version");

  const gameScoped = value.type !== "error" && value.type !== "pong";
  if (gameScoped && value.game_id !== expectedGameId) fail("unexpected game id");

  switch (value.type) {
    case "planning_status":
      if (
        !isNonNegativeInteger(value.checkpoint_id) ||
        ![value.available, value.can_start, value.has_draft].every((v) => typeof v === "boolean") ||
        (value.identity !== null && !isAttempt(value.identity)) ||
        (value.can_apply !== undefined && typeof value.can_apply !== "boolean") ||
        (value.application != null &&
          (!isRecord(value.application) ||
            !isNonNegativeInteger(value.application.applied) ||
            !isNonNegativeInteger(value.application.total) ||
            value.application.applied > value.application.total ||
            !["applying", "waiting_for_player", "needs_decision", "applied"].includes(
              String(value.application.state),
            ) ||
            typeof value.application.message !== "string"))
      )
        fail("invalid planning status");
      return value as unknown as ServerMessage;
    case "planning_result":
      if (
        (value.identity !== null && !isAttempt(value.identity)) ||
        (value.rejection !== null &&
          ![
            "unauthorized",
            "wrong_game",
            "unavailable",
            "unknown_seat",
            "active_player",
            "not_started",
            "retired",
            "not_waiting",
            "unknown_option",
            "no_action_opportunity",
            "replay_mismatch",
          ].includes(String(value.rejection)))
      )
        fail("invalid planning result");
      return value as unknown as ServerMessage;
    case "planning_update": {
      const e = value.envelope;
      if (
        !isRecord(e) ||
        !isNonNegativeInteger(e.publication_id) ||
        !isAttempt(e.identity) ||
        (e.reset_revision !== undefined && !isNonNegativeInteger(e.reset_revision)) ||
        (e.editing_movement !== undefined && typeof e.editing_movement !== "boolean") ||
        (e.movement_edit_revision !== undefined &&
          !isNonNegativeInteger(e.movement_edit_revision)) ||
        typeof e.awaiting_answer !== "boolean" ||
        !Array.isArray(e.recorded_request_ids) ||
        !e.recorded_request_ids.every((id) => typeof id === "string" && id.length > 0) ||
        (e.recorded_decisions !== undefined &&
          (!Array.isArray(e.recorded_decisions) ||
            !e.recorded_decisions.every(
              (decision) =>
                isRecord(decision) &&
                typeof decision.player === "string" &&
                typeof decision.prompt === "string" &&
                typeof decision.option_id === "string" &&
                typeof decision.kind === "string" &&
                isRecord(decision.payload) &&
                (decision.context === null ||
                  (isRecord(decision.context) && typeof decision.context.subtype === "string")),
            ))) ||
        !Array.isArray(e.assumptions) ||
        !e.assumptions.every((a) => typeof a === "string") ||
        !isRecord(e.progress) ||
        ![
          "recorded_answers",
          "replayed",
          "remaining",
          "completed_steps",
          "nested_answers_since_checkpoint",
        ].every((k) => isNonNegativeInteger((e.progress as Record<string, unknown>)[k]))
      )
        fail("invalid planning envelope");
      const update = e.update;
      if (update === "Preparing") return value as unknown as ServerMessage;
      if (!isRecord(update) || Object.keys(update).length !== 1) fail("invalid planning update");
      if ("SafeOffer" in update || "SafeStep" in update) {
        if (!isPlanningPublication(update.SafeOffer ?? update.SafeStep))
          fail("invalid planning publication");
      } else if ("Stopped" in update) {
        const stopped = update.Stopped;
        if (
          !isRecord(stopped) ||
          ![
            "Uncertainty",
            "UnsupportedOffer",
            "OtherPlayerRequired",
            "UnsupportedParticipation",
            "UnsupportedSegment",
            "KnowledgeChanged",
            "ReplayMismatch",
            "StepLimit",
            "MovementComplete",
          ].includes(String(stopped.reason)) ||
          (stopped.last_safe_publication !== null &&
            !isPlanningPublication(stopped.last_safe_publication))
        )
          fail("invalid planning stop");
      } else if (
        !("Failed" in update) ||
        !["Preparation", "Engine", "Worker"].includes(String(update.Failed))
      )
        fail("invalid planning failure");
      return value as unknown as ServerMessage;
    }
    case "initial_snapshot":
    case "state_update":
      if (
        !isNonNegativeInteger(value.game_version) ||
        !isRecord(value.view) ||
        !isRecord(value.viewer) ||
        !isRecord(value.turn_status)
      )
        fail("invalid snapshot");
      if (
        value.history !== undefined &&
        (!isRecord(value.history) ||
          !isNonNegativeInteger(value.history.cursor) ||
          !isNonNegativeInteger(value.history.redo_count) ||
          (value.history.generation !== undefined &&
            !isNonNegativeInteger(value.history.generation)))
      )
        fail("invalid history status");
      return value as unknown as ServerMessage;
    case "pending_choice":
      if (
        !isNonNegativeInteger(value.game_version) ||
        typeof value.nonce !== "string" ||
        !isRecord(value.choice) ||
        !isRecord(value.state) ||
        !isRecord(value.galaxy_layout)
      )
        fail("invalid pending choice");
      return value as unknown as ServerMessage;
    case "turn_status":
      if (!isNonNegativeInteger(value.game_version) || !isRecord(value.status))
        fail("invalid turn status");
      return value as unknown as ServerMessage;
    case "action_accepted":
      if (!isNonNegativeInteger(value.game_version) || typeof value.option_id !== "string")
        fail("invalid accepted action");
      return value as unknown as ServerMessage;
    case "action_rejected":
      if (!isNonNegativeInteger(value.game_version) || !isRecord(value.reason))
        fail("invalid rejected action");
      return value as unknown as ServerMessage;
    case "event":
      if (!isRecord(value.entry) || typeof value.entry.id !== "string") fail("invalid event");
      if (value.entry.batch_id !== undefined && typeof value.entry.batch_id !== "string")
        fail("invalid batch ID");
      if (value.entry.action_id !== undefined && typeof value.entry.action_id !== "string")
        fail("invalid action ID");
      if (value.entry.detail !== undefined && typeof value.entry.detail !== "string")
        fail("invalid event detail");
      if (
        value.entry.private_detail !== undefined &&
        typeof value.entry.private_detail !== "string"
      )
        fail("invalid private event detail");
      for (const field of ["batch_start_cursor", "batch_end_cursor", "action_start_cursor"]) {
        if (value.entry[field] !== undefined && !isNonNegativeInteger(value.entry[field]))
          fail(`invalid ${field}`);
      }
      if (
        value.entry.decision_count !== undefined &&
        !isNonNegativeInteger(value.entry.decision_count)
      )
        fail("invalid event cursor");
      return value as unknown as ServerMessage;
    case "game_over":
      if (!isNonNegativeInteger(value.game_version) || !isRecord(value.final_scores))
        fail("invalid game-over message");
      return value as unknown as ServerMessage;
    case "error":
      if (typeof value.kind !== "string" || typeof value.message !== "string")
        fail("invalid error");
      return value as unknown as ServerMessage;
    case "pong":
      if (!isNonNegativeInteger(value.sequence)) fail("invalid pong");
      return value as unknown as ServerMessage;
    default:
      return fail("unknown message type");
  }
}

export function decodeInitialSnapshot(value: unknown, expectedGameId: string): InitialSnapshotMsg {
  const message = decodeServerMessage(value, expectedGameId);
  if (message.type !== "initial_snapshot") fail("expected initial snapshot");
  return message;
}

export function isStaleServerMessage(message: ServerMessage, currentVersion: number): boolean {
  const version =
    "game_version" in message
      ? message.game_version
      : message.type === "event"
        ? message.entry.version
        : undefined;
  return version !== undefined && version < currentVersion;
}
