import {
  ClientMessage,
  InitialSnapshotMsg,
  PendingChoiceDto,
  PROTOCOL_VERSION,
  PublicTurnStatus,
  ServerMessage,
  StateUpdateMsg,
  ViewerRole,
  HistoryStatus,
} from "./types.ts";
import { decodeInitialSnapshot, decodeServerMessage, isStaleServerMessage } from "./decode.ts";
import {
  initialPlanningState,
  applyPlanningEnvelope,
  applyPlanningStatus,
  planningChoice,
  attemptKey,
  sameAttempt,
  PlanningRefreshError,
  type PlanningState,
} from "./planning.ts";
import type { AttemptIdentity } from "./types.ts";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
export type SnapshotState = InitialSnapshotMsg | StateUpdateMsg;
export type GameLogEntry = import("./types.ts").GameEvent;
export type HistoryChange =
  | "undo"
  | "undo_batch"
  | "undo_pipeline"
  | "redo"
  | "redo_batch"
  | "redo_pipeline"
  | { eventId: string }
  | { cursor: number };

export type MovementStep =
  | { kind: "move"; origin: string; unit: string; damaged: boolean }
  | {
      kind: "load";
      origin: string;
      unit: string;
      source: string | null;
      damaged: boolean;
      galvanized?: boolean;
    }
  | { kind: "done_loading" }
  | { kind: "done_moving" };
export type BasketPlan =
  | { kind: "payment"; steps: ({ kind: "exhaust"; planet: string } | { kind: "trade_good" })[] }
  | {
      kind: "agenda_vote_planets";
      steps: ({ kind: "vote_planet"; planet: string } | { kind: "done_voting" })[];
    }
  | {
      kind: "production";
      destination: string;
      steps: ({ kind: "produce"; unit: string; count: number } | { kind: "done_producing" })[];
    };

const HISTORY_RETRY_ATTEMPTS = 20;

export interface GameSessionState {
  planning: PlanningState;
  status: ConnectionStatus;
  gameVersion: number;
  snapshot: SnapshotState | null;
  pendingChoice: PendingChoiceDto | null;
  turnStatus: PublicTurnStatus | null;
  lastError: string | null;
  events: GameLogEntry[];
  history: HistoryStatus;
}

export interface GameSessionClientOptions {
  gameId: string;
  viewer: ViewerRole;
  serverUrl?: string;
}

type Listener = () => void;

const initialState: GameSessionState = {
  planning: initialPlanningState,
  status: "connecting",
  gameVersion: 0,
  snapshot: null,
  pendingChoice: null,
  turnStatus: null,
  lastError: null,
  events: [],
  history: { cursor: 0, redo_count: 0 },
};

/** Keep the complete authoritative history, including early rounds and batches. */
export function serverEventLog(entries: readonly GameLogEntry[] | undefined): GameLogEntry[] {
  return [...(entries ?? [])];
}

const eventIds = new WeakMap<GameLogEntry[], Set<string>>();
function idsFor(entries: GameLogEntry[]): Set<string> {
  let ids = eventIds.get(entries);
  if (!ids) {
    ids = new Set(entries.map((entry) => entry.id));
    eventIds.set(entries, ids);
  }
  return ids;
}

function rejectionMessage(message: Extract<ServerMessage, { type: "action_rejected" }>): string {
  switch (message.reason.reason) {
    case "stale_version":
      return `Rejected: Stale version (expected ${message.reason.expected}, server at ${message.reason.current})`;
    case "stale_nonce":
      return "Rejected: Stale decision nonce";
    case "unauthorized_seat":
      return "Rejected: Unauthorized seat";
    case "unknown_option":
      return `Rejected: Unknown option '${message.reason.option_id}'`;
    case "no_pending_choice":
      return "Rejected: No decision is currently pending";
    case "validation_failed":
      return `Rejected: ${message.reason.message}`;
  }
}

function pendingChoice(envelope: import("./types.ts").PendingChoiceEnvelope): PendingChoiceDto {
  if (!envelope.choice) return envelope as unknown as PendingChoiceDto;
  return {
    nonce: envelope.nonce,
    actor: envelope.choice.player,
    prompt: envelope.choice.prompt,
    options: envelope.choice.options,
    context: envelope.choice.context,
  };
}

/** Applies only validated, non-stale protocol messages to the client projection. */
export function reduceServerMessage(
  state: GameSessionState,
  message: ServerMessage,
): GameSessionState {
  if (isStaleServerMessage(message, state.gameVersion)) return state;

  switch (message.type) {
    case "planning_status":
      return { ...state, planning: applyPlanningStatus(state.planning, message) };
    case "planning_update":
      return { ...state, planning: applyPlanningEnvelope(state.planning, message.envelope) };
    case "planning_result":
      return state;
    case "initial_snapshot":
    case "state_update":
      return {
        ...state,
        snapshot: message,
        gameVersion: message.game_version,
        turnStatus: message.turn_status,
        pendingChoice: message.pending_choice ? pendingChoice(message.pending_choice) : null,
        events: message.type === "initial_snapshot" ? serverEventLog(message.events) : state.events,
        history: message.history ?? state.history,
      };
    case "event":
      if (idsFor(state.events).has(message.entry.id)) return state;
      const nextEvents = [...state.events, message.entry];
      eventIds.set(nextEvents, idsFor(state.events).add(message.entry.id));
      return {
        ...state,
        events: nextEvents,
        history:
          message.entry.decision_count === undefined
            ? state.history
            : {
                ...state.history,
                cursor: Math.max(state.history.cursor, message.entry.decision_count),
                redo_count: 0,
              },
      };
    case "pending_choice":
      return {
        ...state,
        gameVersion: message.game_version,
        pendingChoice: pendingChoice({ nonce: message.nonce, choice: message.choice }),
      };
    case "turn_status":
      return {
        ...state,
        gameVersion: message.game_version,
        turnStatus: message.status,
        // The server sends TurnStatus instead of PendingChoice to every non-actor.
        // A previous actor must not retain an actionable choice during a nested window.
        pendingChoice: null,
      };
    case "action_accepted":
      return { ...state, lastError: null };
    case "action_rejected":
      return { ...state, lastError: rejectionMessage(message) };
    case "error":
      return { ...state, lastError: `Server Error: ${message.message}` };
    case "game_over":
    case "pong":
      return state;
  }
}

/** Owns every network ingress point and the lifecycle of one game-session connection. */
export class GameSessionClient {
  private state = initialState;
  private readonly listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private stopped = false;
  private submission: {
    nonce: string;
    optionId: string;
    version: number;
    accepted: boolean;
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  // An engine step may offer another human reaction before acknowledging the
  // previous choice. Keep its promise until the step commits, but allow the
  // newly offered choice to be submitted meanwhile.
  private priorSubmissions: NonNullable<GameSessionClient["submission"]>[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pingSequence = 0;
  private pendingBatch: { nonce: string; plan: string; requestId: string } | null = null;
  private planningSubmission: {
    kind: "start" | "answer" | "reset" | "apply" | "edit";
    identity: AttemptIdentity | null;
    requestId: string;
    recorded: number;
    reconnecting: boolean;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(private readonly options: GameSessionClientOptions) {}

  getState(): GameSessionState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.stopped = false;
    this.setState({ ...this.state, status: "connecting", lastError: null });
    void this.loadSnapshot();
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.detachSocket();
    this.rejectSubmission("Submission stopped");
    this.rejectPlanning("Submission stopped");
  }

  startPlanning(): Promise<void> {
    return this.sendPlanning("start");
  }
  resetPlanning(identity: AttemptIdentity): Promise<void> {
    return this.sendPlanning("reset", identity);
  }
  editPlanningMovement(identity: AttemptIdentity): Promise<void> {
    return this.sendPlanning("edit", identity);
  }
  applyPlanning(identity: AttemptIdentity, nonce: string, expectedVersion: number): Promise<void> {
    if (!this.state.planning.availability?.can_apply || this.submission)
      return Promise.reject(new Error("The draft is not ready at this live action opportunity."));
    return this.sendPlanning("apply", identity, undefined, { nonce, expectedVersion });
  }
  submitPlanningChoice(identity: AttemptIdentity, optionId: string): Promise<void> {
    const choice = planningChoice(this.state.planning);
    if (
      !choice ||
      !this.state.planning.envelope ||
      attemptKey(identity) !== attemptKey(this.state.planning.envelope.identity)
    )
      return Promise.reject(
        new PlanningRefreshError("Draft refreshed; revalidating remaining instructions."),
      );
    if (!choice.options.some((option) => option.id === optionId))
      return Promise.reject(new Error("This draft selection is no longer available."));
    return this.sendPlanning("answer", identity, optionId);
  }
  private sendPlanning(
    kind: "start" | "answer" | "reset" | "apply" | "edit",
    identity?: AttemptIdentity,
    optionId?: string,
    live?: { nonce: string; expectedVersion: number },
  ): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Planning is not connected."));
    if (this.planningSubmission)
      return Promise.reject(new Error("A draft submission is still pending."));
    const requestId = crypto.randomUUID();
    const message: ClientMessage =
      kind === "start"
        ? {
            type: "start_planning",
            protocol_version: PROTOCOL_VERSION,
            game_id: this.options.gameId,
          }
        : kind === "reset" || kind === "edit"
          ? {
              type: kind === "edit" ? "edit_planning_movement" : "reset_planning",
              protocol_version: PROTOCOL_VERSION,
              game_id: this.options.gameId,
              identity: identity!,
            }
          : kind === "apply"
            ? {
                type: "apply_planning",
                protocol_version: PROTOCOL_VERSION,
                game_id: this.options.gameId,
                identity: identity!,
                nonce: live!.nonce,
                expected_version: live!.expectedVersion,
              }
            : {
                type: "submit_planning_choice",
                protocol_version: PROTOCOL_VERSION,
                game_id: this.options.gameId,
                identity: identity!,
                option_id: optionId!,
                request_id: requestId,
              };
    const promise = new Promise<void>((resolve, reject) => {
      this.planningSubmission = {
        kind,
        identity: identity ?? null,
        requestId,
        recorded: this.state.planning.envelope?.progress.recorded_answers ?? 0,
        reconnecting: false,
        resolve,
        reject,
      };
    });
    this.setState({
      ...this.state,
      planning: {
        ...this.state.planning,
        busy: true,
        error: null,
        current: kind === "answer" ? this.state.planning.current : false,
      },
    });
    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      this.rejectPlanning(String(error));
    }
    return promise;
  }

  private rejectPlanning(reason: string): void {
    const pending = this.planningSubmission;
    this.planningSubmission = null;
    pending?.reject(new Error(reason));
    this.setState({
      ...this.state,
      planning: {
        ...this.state.planning,
        busy: false,
        error: pending ? reason : this.state.planning.error,
      },
    });
  }

  async submitChoice(optionId: string): Promise<void> {
    const { pendingChoice, gameVersion } = this.state;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      const message = "Cannot submit choice: not connected to server";
      this.setState({ ...this.state, lastError: message });
      throw new Error(message);
    }
    if (!pendingChoice) {
      const message = "No decision currently pending";
      this.setState({ ...this.state, lastError: message });
      throw new Error(message);
    }
    if (this.submission) {
      if (this.submission.nonce === pendingChoice.nonce && this.submission.optionId === optionId)
        return this.submission.promise;
      if (this.submission.nonce === pendingChoice.nonce)
        throw new Error("Another choice submission is still pending");
      this.priorSubmissions.push(this.submission);
      this.submission = null;
    }

    const message: ClientMessage = {
      type: "submit_choice",
      protocol_version: PROTOCOL_VERSION,
      game_id: this.options.gameId,
      nonce: pendingChoice.nonce,
      expected_version: gameVersion,
      option_id: optionId,
    };
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    this.submission = {
      nonce: pendingChoice.nonce,
      optionId,
      version: gameVersion,
      accepted: false,
      promise,
      resolve,
      reject,
    };
    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      this.rejectSubmission(`Could not send choice: ${String(error)}`);
    }
    return promise;
  }

  async submitMovementBatch(destination: string, steps: MovementStep[]): Promise<void> {
    return this.submitBatch({ kind: "tactical_movement", destination, steps });
  }

  async submitBatch(
    plan: BasketPlan | { kind: "tactical_movement"; destination: string; steps: MovementStep[] },
  ): Promise<void> {
    if (this.options.viewer.role !== "player" || !this.options.viewer.playerSession)
      throw new Error("A player session is required");
    const pending = this.state.pendingChoice;
    if (!pending || pending.actor !== this.options.viewer.seat || !pending.context)
      throw new Error("Decision is no longer pending");
    const expected = {
      tactical_movement: ["movement_step"],
      payment: ["pay_resources", "pay_influence"],
      agenda_vote_planets: ["vote_exhaust_planet"],
      production: ["produce_unit"],
    }[plan.kind];
    if (!expected.includes(pending.context.subtype))
      throw new Error("Workflow is no longer pending");
    const serialized = JSON.stringify(plan);
    if (this.pendingBatch?.nonce !== pending.nonce || this.pendingBatch.plan !== serialized)
      this.pendingBatch = {
        nonce: pending.nonce,
        plan: serialized,
        requestId: crypto.randomUUID(),
      };
    const response = await fetch(this.snapshotUrl().replace(/\/snapshot$/, "/batches"), {
      method: "POST",
      headers: { ...this.snapshotHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        request_id: this.pendingBatch.requestId,
        expected_version: this.state.gameVersion,
        nonce: pending.nonce,
        plan,
      }),
    });
    if (!response.ok) {
      if (response.status !== 500 && response.status !== 502 && response.status !== 503)
        this.pendingBatch = null;
      const failure = (await response.json()) as {
        failed_step?: number;
        reason?: string;
        expected?: string;
      };
      throw new Error(
        `Batch step ${(failure.failed_step ?? 0) + 1}: ${failure.reason ?? "batch rejected"}${failure.expected ? ` (${failure.expected})` : ""}`,
      );
    }
    this.pendingBatch = null;
    const result = (await response.json()) as { snapshot: unknown; active?: boolean };
    if (result.active === false)
      throw new Error(
        "This confirmation was already committed but is now undone. Refresh the decision before confirming again.",
      );
    const snapshot = decodeInitialSnapshot(
      { type: "initial_snapshot", ...(result.snapshot as object) },
      this.options.gameId,
    );
    this.rejectSubmission("Game history changed");
    this.detachSocket();
    this.clearTimers();
    this.setState(
      reduceServerMessage(
        { ...this.state, pendingChoice: null, lastError: null },
        { ...snapshot, type: "initial_snapshot" },
      ),
    );
    this.openSocket();
  }

  /** The host changes the authoritative Rust timeline; all clients reconnect to it. */
  async changeHistory(action: HistoryChange): Promise<void> {
    if (this.options.viewer.role !== "player" || !this.options.viewer.playerSession)
      throw new Error("A player session is required");
    const url = this.snapshotUrl().replace(/\/snapshot$/, "/history");
    const body =
      typeof action === "string"
        ? { action }
        : "cursor" in action
          ? { action: "restore_cursor", cursor: action.cursor }
          : { action: "restore", event_id: action.eventId };
    let version = this.state.gameVersion;
    const cursor = this.state.history.cursor;
    let response!: Response;
    let conflictReason: string | undefined;
    for (let attempt = 0; attempt < HISTORY_RETRY_ATTEMPTS; attempt++) {
      conflictReason = undefined;
      response = await fetch(url, {
        method: "POST",
        headers: { ...this.snapshotHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ ...body, expected_version: version }),
      });
      if (response.ok || response.status !== 409) break;
      conflictReason = await response.text();
      if (
        attempt === HISTORY_RETRY_ATTEMPTS - 1 ||
        !conflictReason.includes("Game advanced or a decision is in flight")
      )
        break;
      // The worker may still be advancing automatically toward its next human choice.
      // Refresh the version, but never rewind a different decision if someone acted meanwhile.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const latest = await fetch(this.snapshotUrl(), { headers: this.snapshotHeaders() });
      if (!latest.ok) break;
      const snapshot = decodeInitialSnapshot(await latest.json(), this.options.gameId);
      if (snapshot.history?.cursor !== cursor) break;
      version = snapshot.game_version;
    }
    if (!response.ok) {
      const reason = conflictReason ?? (await response.text());
      const error = `History change failed (${response.status}): ${reason}`;
      this.setState({ ...this.state, lastError: error });
      throw new Error(error);
    }
    const snapshot = decodeInitialSnapshot(await response.json(), this.options.gameId);
    const expected = this.options.viewer;
    if (
      snapshot.viewer.role !== expected.role ||
      (expected.role === "player" &&
        (snapshot.viewer.role !== "player" || snapshot.viewer.seat !== expected.seat))
    ) {
      throw new Error("Server viewer identity does not match this session");
    }
    this.rejectSubmission("Game history changed");
    this.detachSocket();
    this.clearTimers();
    this.setState(
      reduceServerMessage(
        { ...this.state, pendingChoice: null, lastError: null },
        { ...snapshot, type: "initial_snapshot" },
      ),
    );
    this.openSocket();
  }

  private async loadSnapshot(): Promise<void> {
    try {
      const response = await fetch(this.snapshotUrl(), { headers: this.snapshotHeaders() });
      if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
      this.ingestHttpSnapshot(await response.json());
    } catch (error) {
      if (!this.stopped)
        this.setState({ ...this.state, lastError: `Snapshot request failed: ${String(error)}` });
    }
  }

  private openSocket(): void {
    if (this.planningSubmission?.kind === "answer") this.planningSubmission.reconnecting = true;
    this.setState({
      ...this.state,
      planning: { ...this.state.planning, availability: null, current: false },
    });
    const socket = new WebSocket(this.webSocketUrl());
    this.socket = socket;
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return;
      const playerSession =
        this.options.viewer.role === "player" ? this.options.viewer.playerSession : undefined;
      const message: ClientMessage = {
        type: "subscribe",
        protocol_version: PROTOCOL_VERSION,
        game_id: this.options.gameId,
        player_session: playerSession,
      };
      socket.send(JSON.stringify(message));
      if (playerSession)
        this.heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                type: "ping",
                protocol_version: PROTOCOL_VERSION,
                sequence: ++this.pingSequence,
              } satisfies ClientMessage),
            );
        }, 10_000);
      this.setState({ ...this.state, status: "connected", lastError: null });
    };
    socket.onmessage = (event) => {
      if (this.socket === socket && !this.stopped) this.ingestWebSocket(event.data);
    };
    socket.onerror = () => {
      if (!this.stopped && this.socket === socket) {
        this.setState({
          ...this.state,
          status: "error",
          lastError: "WebSocket network error occurred",
        });
      }
    };
    socket.onclose = (event) => {
      if (!this.stopped && this.socket === socket) {
        this.clearTimers();
        this.socket = null;
        this.rejectSubmission("Submission disconnected before confirmation");
        // An answer's outcome is reconciled from the server-held script on reconnect.
        if (this.planningSubmission?.kind !== "answer")
          this.rejectPlanning("Planning disconnected before confirmation");
        this.setState({
          ...this.state,
          status: "disconnected",
          planning: { ...this.state.planning, availability: null, current: false },
        });
        this.retry = setTimeout(
          () => {
            if (!this.stopped) {
              void this.loadSnapshot();
              this.openSocket();
            }
          },
          event?.code === 4001 ? 0 : 2_000,
        );
      }
    };
  }

  private ingestHttpSnapshot(value: unknown): void {
    this.apply(
      decodeInitialSnapshot(value, this.options.gameId) as Extract<
        ServerMessage,
        { type: "initial_snapshot" }
      >,
    );
  }

  private ingestWebSocket(value: unknown): void {
    try {
      this.apply(
        decodeServerMessage(
          typeof value === "string" ? JSON.parse(value) : value,
          this.options.gameId,
        ),
      );
    } catch (error) {
      if (!this.stopped) {
        const message = `Invalid server message: ${String(error)}`;
        this.setState({ ...this.state, lastError: message });
        this.rejectSubmission(message);
      }
    }
  }

  private apply(message: ServerMessage): void {
    if (message.type === "planning_result") {
      const pending = this.planningSubmission;
      if (
        !pending ||
        (pending.identity
          ? !message.identity || attemptKey(pending.identity) !== attemptKey(message.identity)
          : message.identity !== null)
      )
        return;
      // Answer results acknowledge reservation only. A publication confirms recording.
      if (pending.kind === "answer") {
        if (
          this.state.planning.envelope &&
          attemptKey(this.state.planning.envelope.identity) !== attemptKey(pending.identity!)
        )
          return;
        if (message.rejection && message.rejection !== "retired")
          this.rejectPlanning(`Draft answer rejected: ${message.rejection}`);
        return;
      }
      this.planningSubmission = null;
      if (message.rejection) {
        const reason =
          message.rejection === "replay_mismatch"
            ? "The draft no longer matches the live game. Review or reset it before applying."
            : message.rejection === "no_action_opportunity"
              ? "Apply draft is available only at your tactical action opportunity."
              : message.rejection === "retired"
                ? "The draft or live decision changed. Review the current draft and try again."
                : `Draft request rejected: ${message.rejection}`;
        pending.reject(new Error(reason));
        this.setState({
          ...this.state,
          planning: {
            ...this.state.planning,
            busy: false,
            error: reason,
          },
        });
      } else {
        this.setState({
          ...this.state,
          planning: {
            ...this.state.planning,
            busy: false,
          },
        });
        pending.resolve();
      }
      return;
    }
    if (message.type === "planning_update" || message.type === "planning_status") {
      const previousResetEpoch = this.state.planning.resetEpoch;
      const previousEditRevision = this.state.planning.envelope?.movement_edit_revision ?? 0;
      this.setState(reduceServerMessage(this.state, message));
      const pending = this.planningSubmission;
      const envelope = this.state.planning.envelope;
      if (pending?.kind === "answer" && this.state.planning.resetEpoch !== previousResetEpoch) {
        this.rejectPlanning("Draft reset; remaining instructions were cancelled.");
        return;
      }
      if (
        pending?.kind === "answer" &&
        (envelope?.movement_edit_revision ?? 0) !== previousEditRevision
      ) {
        this.rejectPlanning("Draft movement reopened; remaining instructions were cancelled.");
        return;
      }
      if (
        message.type === "planning_status" &&
        this.state.planning.availability === message &&
        !message.available &&
        this.planningSubmission?.kind === "answer"
      ) {
        this.rejectPlanning("Draft planning is unavailable; remaining instructions were paused.");
        return;
      }
      if (
        message.type === "planning_update" &&
        envelope === message.envelope &&
        pending?.kind === "answer" &&
        envelope.update !== "Preparing"
      ) {
        const recorded = envelope.recorded_request_ids.includes(pending.requestId);
        if (
          !recorded &&
          (envelope.progress.recorded_answers > pending.recorded ||
            envelope.progress.recorded_answers < pending.recorded ||
            (envelope.identity.plan_revision > pending.identity!.plan_revision &&
              sameAttempt(envelope.identity, pending.identity!)))
        ) {
          this.rejectPlanning(
            "Another connection answered this draft offer. Remaining instructions were paused.",
          );
          return;
        }
        const retired = pending.identity && !sameAttempt(pending.identity, envelope.identity);
        // Only the replacement socket's authoritative publication can prove that
        // an unchanged offer was never reserved. Ordinary duplicate deliveries cannot.
        const undelivered =
          pending.reconnecting &&
          envelope.awaiting_answer &&
          pending.identity &&
          attemptKey(pending.identity) === attemptKey(envelope.identity);
        const terminal =
          typeof envelope.update === "object" &&
          ("Stopped" in envelope.update || "Failed" in envelope.update);
        if (
          recorded ||
          undelivered ||
          (retired &&
            (envelope.awaiting_answer ||
              (typeof envelope.update === "object" &&
                ("Stopped" in envelope.update || "Failed" in envelope.update))))
        ) {
          this.planningSubmission = null;
          this.setState({ ...this.state, planning: { ...this.state.planning, busy: false } });
          if (recorded) pending.resolve();
          else
            pending.reject(
              new PlanningRefreshError("Draft refreshed; revalidating remaining instructions."),
            );
        } else if (terminal) {
          this.rejectPlanning(
            "The preview stopped before this answer was recorded. Remaining instructions were paused.",
          );
        }
      }
      return;
    }
    if (message.type === "initial_snapshot" || message.type === "state_update") {
      const expected = this.options.viewer;
      if (
        message.viewer.role !== expected.role ||
        (expected.role === "player" &&
          (message.viewer.role !== "player" || message.viewer.seat !== expected.seat))
      ) {
        this.setState({
          ...initialState,
          status: "error",
          lastError: "Server viewer identity does not match this session",
        });
        this.stop();
        return;
      }
    }
    // A state update may precede its acknowledgement on the broadcast channel.
    // Do not discard a late acknowledgement just because its version is older.
    if (message.type === "action_accepted") {
      const index = this.priorSubmissions.findIndex(
        (pending) =>
          pending.optionId === message.option_id && message.game_version >= pending.version,
      );
      if (index !== -1) {
        this.priorSubmissions.splice(index, 1)[0].resolve();
        this.setState(reduceServerMessage(this.state, message));
        return;
      }
    }
    if (message.type === "action_rejected") {
      const index = this.priorSubmissions.findIndex(
        (pending) => pending.version === message.game_version,
      );
      if (index !== -1) {
        const reason = rejectionMessage(message);
        this.priorSubmissions.splice(index, 1)[0].reject(new Error(reason));
        this.setState({ ...this.state, lastError: reason });
        return;
      }
    }
    if (
      message.type === "action_accepted" &&
      this.submission &&
      message.option_id === this.submission.optionId &&
      message.game_version >= this.submission.version
    ) {
      this.submission.accepted = true;
    }
    if (message.type === "action_rejected" && this.submission) {
      const reason = rejectionMessage(message);
      this.setState({ ...this.state, lastError: reason });
      this.rejectSubmission(reason);
      return;
    }
    this.setState(reduceServerMessage(this.state, message));
    const submission = this.submission;
    // The worker can announce the next choice at a newer version without sending
    // a state update at that version. That choice is itself confirmation of progress.
    if (
      submission?.accepted &&
      this.state.gameVersion > submission.version &&
      (this.state.snapshot?.game_version === this.state.gameVersion ||
        this.state.pendingChoice !== null) &&
      this.state.pendingChoice?.nonce !== submission.nonce
    ) {
      this.submission = null;
      submission.resolve();
    }
  }

  private rejectSubmission(reason: string): void {
    const submission = this.submission;
    this.submission = null;
    submission?.reject(new Error(reason));
    for (const prior of this.priorSubmissions.splice(0)) prior.reject(new Error(reason));
  }

  private detachSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
      socket.close();
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.retry) clearTimeout(this.retry);
    this.heartbeat = null;
    this.retry = null;
  }

  private setState(next: GameSessionState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private webSocketUrl(): string {
    if (this.options.serverUrl) return this.options.serverUrl;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws/games/${encodeURIComponent(this.options.gameId)}`;
  }

  private snapshotUrl(): string {
    if (!this.options.serverUrl)
      return `/api/games/${encodeURIComponent(this.options.gameId)}/snapshot`;
    const url = new URL(this.options.serverUrl, window.location.href);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = `/api/games/${encodeURIComponent(this.options.gameId)}/snapshot`;
    url.search = "";
    return url.toString();
  }

  private snapshotHeaders(): HeadersInit {
    return this.options.viewer.role === "player" && this.options.viewer.playerSession
      ? { "x-ti4-player-session": this.options.viewer.playerSession }
      : {};
  }
}
