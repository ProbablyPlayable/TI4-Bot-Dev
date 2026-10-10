import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ViewerRole } from "./protocol/types.ts";
import { useGameSession } from "./hooks/useGameSession.ts";
import { useLobbySession } from "./hooks/useLobbySession.ts";
import { useTurnSound } from "./hooks/useTurnSound.ts";
import { Board } from "./components/Board.tsx";
import { TurnStatusBar } from "./components/TurnStatusBar.tsx";
import { PlayerSheet } from "./components/PlayerSheet.tsx";
import { CreateLobby, LobbyStatus } from "./components/Lobby.tsx";
import { GameShell } from "./components/GameShell.tsx";
import { usePresence } from "./hooks/usePresence.ts";
import { PlayerIdentityProvider } from "./presentation/PlayerIdentity.tsx";
import { DecisionTableProvider } from "./components/PoliticsDecisionParts.tsx";
import { participantText } from "./presentation/participantText.ts";
import { CardDetails, CardSubject } from "./components/CardDetails.tsx";
import { TechnologyModal } from "./components/TechnologyModal.tsx";
import { ObjectivesModal } from "./components/ObjectivesModal.tsx";
import { WorkspaceContext, useWorkspace } from "./components/WorkspaceContext.tsx";
import { attemptKey, planningChoice, sameAttempt } from "./protocol/planning.ts";
import { ApplyDraftDialog } from "./components/ApplyDraftDialog.tsx";
import { SecondaryDraftStrip } from "./components/SecondaryDraftStrip.tsx";
import { describeSecondaryDraft } from "./presentation/secondaryDraft.ts";
import type { UseGameSessionReturn } from "./hooks/useGameSession.ts";
import type { AttemptIdentity, PendingChoiceDto, RecordedDecisionDto } from "./protocol/types.ts";
import { resolveMapTargetSelection } from "./presentation/planetSelection.ts";
import { isPlanetSelectionChoice } from "./presentation/choiceModel.ts";
import {
  derivePaymentOffer,
  isPaymentChoice,
  paymentOptionForPlanet,
  paymentPlanetKey,
} from "./presentation/paymentDraft.ts";
import { CornerToastLayer } from "./components/CornerToastLayer.tsx";
import { PaymentDraftProvider, usePaymentDraftState } from "./presentation/PaymentDraftContext.tsx";

const DevDecisionGallery = import.meta.env.DEV
  ? React.lazy(() =>
      import("./dev/DecisionGallery.tsx").then(({ DecisionGallery }) => ({
        default: DecisionGallery,
      })),
    )
  : null;

const DevScenarioLauncher = import.meta.env.DEV
  ? React.lazy(() =>
      import("./dev/ScenarioLauncher.tsx").then(({ ScenarioLauncher }) => ({
        default: ScenarioLauncher,
      })),
    )
  : null;

const DevMapPickerGallery = import.meta.env.DEV
  ? React.lazy(() =>
      import("./dev/MapPickerGallery.tsx").then(({ MapPickerGallery }) => ({
        default: MapPickerGallery,
      })),
    )
  : null;
const DevToastGallery = import.meta.env.DEV
  ? React.lazy(() =>
      import("./dev/ToastGallery.tsx").then(({ ToastGallery }) => ({
        default: ToastGallery,
      })),
    )
  : null;

const storageKey = (gameId: string) => `ti4.player-session:${gameId}`;
const pathGameId = () =>
  /^\/games\/([^/]+)$/.exec(window.location.pathname)?.[1]
    ? decodeURIComponent(/^\/games\/([^/]+)$/.exec(window.location.pathname)![1])
    : null;

export const App: React.FC = () => {
  const [gameId, setGameId] = useState(pathGameId);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(() =>
    gameId ? (sessionStorage.getItem(storageKey(gameId)) ?? undefined) : undefined,
  );
  const navigate = (id: string | null, nextToken?: string) => {
    if (id) {
      if (nextToken) sessionStorage.setItem(storageKey(id), nextToken);
      history.pushState({}, "", `/games/${encodeURIComponent(id)}`);
    } else history.pushState({}, "", "/");
    setGameId(id);
    setToken(nextToken);
  };
  useLayoutEffect(() => {
    const receive = () => {
      const id = pathGameId();
      setGameId(id);
      setToken(id ? (sessionStorage.getItem(storageKey(id)) ?? undefined) : undefined);
    };
    window.addEventListener("popstate", receive);
    return () => window.removeEventListener("popstate", receive);
  }, []);
  if (DevDecisionGallery && window.location.pathname === "/dev/decisions")
    return (
      <React.Suspense fallback={<main>Loading decision gallery…</main>}>
        <DevDecisionGallery />
      </React.Suspense>
    );
  if (DevMapPickerGallery && window.location.pathname === "/dev/map-picker")
    return (
      <React.Suspense fallback={<main>Loading map picker…</main>}>
        <DevMapPickerGallery />
      </React.Suspense>
    );
  if (DevToastGallery && window.location.pathname === "/dev/toasts")
    return (
      <React.Suspense fallback={<main>Loading toasts…</main>}>
        <DevToastGallery />
      </React.Suspense>
    );
  if (DevScenarioLauncher && window.location.pathname === "/dev/scenarios")
    return (
      <React.Suspense fallback={<main>Loading dev scenarios…</main>}>
        <DevScenarioLauncher />
      </React.Suspense>
    );
  if (!gameId)
    return (
      <>
        <CreateLobby
          onError={setError}
          onCreated={(created) => navigate(created.game_id, created.player_session)}
        />
        {error && (
          <div className="session-error" role="alert">
            {error}
          </div>
        )}
      </>
    );
  return (
    <GameRoute
      key={gameId}
      gameId={gameId}
      token={token}
      onCredential={(credential) => {
        sessionStorage.setItem(storageKey(gameId), credential);
        setToken(credential);
      }}
      onCredentialInvalid={() => {
        sessionStorage.removeItem(storageKey(gameId));
        setToken(undefined);
      }}
      onForget={() => {
        sessionStorage.removeItem(storageKey(gameId));
        navigate(null);
      }}
    />
  );
};

const GameRoute: React.FC<{
  gameId: string;
  token?: string;
  onCredential: (credential: string) => void;
  onCredentialInvalid: () => void;
  onForget: () => void;
}> = ({ gameId, token, onCredential, onCredentialInvalid, onForget }) => {
  const {
    lobby,
    playerId,
    error,
    loading,
    invalidCredential,
    pendingAction,
    setReady,
    start,
    reorder,
    chooseMap,
    join,
    leave,
    addBot,
    removeBot,
  } = useLobbySession(gameId, token);
  const [watching, setWatching] = useState(false);
  const invalidate = useCallback(() => onCredentialInvalid(), [onCredentialInvalid]);
  usePresence(gameId, token, invalidate);
  useEffect(() => {
    if (invalidCredential) onCredentialInvalid();
  }, [invalidCredential, onCredentialInvalid]);
  if (!lobby)
    return (
      <main className="lobby-page">
        <div className="panel lobby-panel">
          {loading ? "Loading lobby..." : "Unable to load lobby."}
        </div>
      </main>
    );
  const viewer: ViewerRole =
    token && playerId
      ? { role: "player", seat: playerId, playerSession: token }
      : { role: "spectator" };
  const enter = async (nickname: string, id?: string) => {
    const credential = await join(nickname, id);
    if (credential) {
      setWatching(false);
      onCredential(credential);
    }
  };
  const leaveLobby = async () => {
    if (await leave()) onForget();
  };
  return (
    <>
      {error && (
        <div className="session-error" role="alert">
          {participantText(error, lobby, [])} Check the lobby and try again.
        </div>
      )}
      {lobby.phase === "running" && (playerId || watching) ? (
        <GameViewContainer
          key={`${gameId}:${token ?? "watch"}`}
          gameId={gameId}
          lobby={lobby}
          viewer={viewer}
          onLeave={onForget}
        />
      ) : (
        <LobbyStatus
          lobby={lobby}
          playerId={playerId}
          watching={watching}
          pendingAction={pendingAction}
          onReady={(ready) => void setReady(ready)}
          onStart={() => void start()}
          onLeave={() => void leaveLobby()}
          onJoin={(name) => void enter(name)}
          onTakeover={(id, name) => void enter(name, id)}
          onReorder={(ids) => void reorder(ids)}
          onChooseMap={chooseMap}
          onWatch={() => setWatching(true)}
          onAddBot={(password, name) => addBot(password, name)}
          onRemoveBot={(targetId) => removeBot(targetId)}
        />
      )}
    </>
  );
};

const GameViewContainer: React.FC<{
  gameId: string;
  lobby: import("./protocol/types.ts").LobbyDto;
  viewer: ViewerRole;
  onLeave?: () => void;
}> = ({ gameId, lobby, viewer }) => {
  const session = useGameSession({ gameId, viewer });
  const [mode, setMode] = useState<"live" | "draft" | "secondary">("live");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    identity: AttemptIdentity;
    nonce: string;
    version: number;
    decisions: RecordedDecisionDto[];
  } | null>(null);
  const planning = session.planning;
  const application = planning.availability?.application;
  const applying = application?.state === "applying" || application?.state === "waiting_for_player";
  const applicationLabel =
    application &&
    {
      applying: "Applying draft",
      waiting_for_player: "Waiting for another player",
      needs_decision: "Needs your decision",
      applied: "Applied",
    }[application.state];
  const canApply =
    !!planning.availability?.can_apply &&
    planning.current &&
    !planning.envelope?.editing_movement &&
    !planning.busy &&
    session.status === "connected" &&
    session.pendingChoice?.context?.subtype === "action_menu";
  const hasDraft = planning.availability?.has_draft || !!planning.envelope;
  // A follower's secondary draft: its own slot, open while the card's window is.
  const secondary = viewer.role === "player" ? session.secondaryStatus : null;
  const secondaryPlanning = session.secondaryPlanning;
  const secondaryView = secondary ? describeSecondaryDraft(secondary, secondaryPlanning) : null;
  useEffect(() => {
    if (!secondary && mode === "secondary") setMode("live");
  }, [secondary, mode]);
  const attention =
    !applying &&
    viewer.role === "player" &&
    (session.pendingChoice?.actor === viewer.seat ||
      (session.turnStatus?.kind === "waiting_for_decision" &&
        session.turnStatus.seat === viewer.seat));
  const request = (operation: Promise<void>) => {
    setRequestError(null);
    void operation.catch((error) => setRequestError(String(error.message ?? error)));
  };
  const chrome = (
    <nav
      className={`workspace-switch${hasDraft || mode !== "live" || secondaryView ? " workspace-switch--segmented" : ""}`}
      aria-label="Game workspace"
    >
      {(hasDraft || mode !== "live" || secondaryView) && (
        <button
          type="button"
          aria-pressed={mode === "live"}
          className={`button ${attention ? "workspace-attention" : ""}`}
          onClick={() => setMode("live")}
        >
          Live{attention && <span> · Your decision</span>}
        </button>
      )}
      {hasDraft || mode === "draft" ? (
        <button
          type="button"
          aria-pressed={mode === "draft"}
          className="button"
          onClick={() => setMode("draft")}
        >
          Draft
        </button>
      ) : (
        viewer.role === "player" && (
          <button
            type="button"
            className="button"
            disabled={!planning.availability?.can_start || planning.busy}
            onClick={() => {
              setMode("draft");
              request(session.startPlanning());
            }}
          >
            Start tactical draft
          </button>
        )
      )}
      {secondary && secondaryView && (
        <button
          type="button"
          aria-pressed={mode === "secondary"}
          className="button"
          data-testid="secondary-draft-tab"
          disabled={!secondary.has_draft && !secondary.can_start}
          title={`Draft your ${secondaryView.cardName} secondary while you wait`}
          onClick={() => {
            setMode("secondary");
            if (!secondary.has_draft && !secondaryPlanning.busy)
              request(session.startSecondaryPlanning());
          }}
        >
          {secondaryView.cardName} secondary
          <span className="workspace-switch__detail">
            {" · "}
            {secondaryView.submitting
              ? secondaryView.state
              : secondaryView.ready
                ? "Ready"
                : secondary.has_draft
                  ? "Drafting"
                  : "Draft now"}
          </span>
        </button>
      )}
      {hasDraft &&
        (application ? (
          <span
            className="workspace-application"
            role="status"
            data-testid="draft-application-status"
          >
            {applicationLabel} · {application.applied} / {application.total}
          </span>
        ) : (
          <button
            type="button"
            className="button"
            disabled={!canApply}
            title={
              canApply
                ? "Apply the recorded choices to your live tactical action"
                : "Available when the current draft matches your live tactical action opportunity"
            }
            onClick={() => {
              if (!planning.envelope || !session.pendingChoice) return;
              setRequestError(null);
              setConfirmation({
                identity: planning.envelope.identity,
                nonce: session.pendingChoice.nonce,
                version: session.gameVersion,
                decisions: planning.envelope.recorded_decisions ?? [],
              });
            }}
          >
            Apply draft
          </button>
        ))}
    </nav>
  );
  const actionableChoice = planningChoice(planning);
  const displayedChoice = useRef<PendingChoiceDto | null>(null);
  const displayedResetEpoch = useRef(planning.resetEpoch);
  if (displayedResetEpoch.current !== planning.resetEpoch) {
    displayedChoice.current = null;
    displayedResetEpoch.current = planning.resetEpoch;
  }
  if (actionableChoice) displayedChoice.current = actionableChoice;
  const terminal =
    planning.envelope &&
    typeof planning.envelope.update === "object" &&
    ("Stopped" in planning.envelope.update || "Failed" in planning.envelope.update);
  if (terminal || application) displayedChoice.current = null;
  const identity = planning.envelope?.identity;
  const draftSession: UseGameSessionReturn = {
    ...session,
    snapshot:
      planning.publication && session.snapshot
        ? {
            ...session.snapshot,
            view: {
              ...planning.publication.position,
              board: {
                ...planning.publication.position.board,
                map_tiles: session.snapshot.view.board.map_tiles,
              },
            },
            state: {},
            pending_choice: null,
            events: [],
          }
        : null,
    pendingChoice: displayedChoice.current,
    turnStatus: null,
    events: [],
    history: { cursor: 0, redo_count: 0 },
    lastError: planning.error,
    submitChoice: (optionId) =>
      identity
        ? session.submitPlanningChoice(identity, optionId)
        : Promise.reject(new Error("Draft is preparing.")),
  };
  const update = planning.envelope?.update;
  const label = !planning.availability
    ? "Connecting"
    : !planning.availability.available
      ? "Planning unavailable in this phase"
      : !planning.current
        ? planning.publication
          ? "Previous preview · refreshing"
          : "Preparing"
        : typeof update === "object" && "Stopped" in update
          ? {
              MovementComplete: "Tactical action complete",
              ReplayMismatch: "Replay mismatch",
              Uncertainty: "Uncertainty",
              KnowledgeChanged: "Known information changed",
              OtherPlayerRequired: "Another player's decision is required",
              UnsupportedOffer: "Unsupported boundary",
              UnsupportedParticipation: "Unsupported boundary",
              UnsupportedSegment: "Unsupported boundary",
              StepLimit: "Preview step limit reached",
              SecondaryComplete: "Complete",
            }[update.Stopped.reason]
          : typeof update === "object" && "Failed" in update
            ? "Preview failed"
            : planning.envelope?.progress.remaining
              ? "Replaying recorded draft"
              : "Ready";
  const statusStrip = (
    <section className="draft-status" aria-label="Draft status" data-testid="draft-status">
      <div className="draft-status__summary">
        <div className="draft-status__heading">
          <strong className="draft-status__badge">Hypothetical</strong>
          <span className="draft-status__state" role="status">
            {planning.current &&
            identity &&
            planning.publicationIdentity &&
            !sameAttempt(identity, planning.publicationIdentity)
              ? `Previous preview · ${label.toLowerCase()}`
              : label}
          </span>
        </div>
        <p className="draft-status__description">
          {planning.envelope?.assumptions.join(" ") ||
            "Other players take no optional reactions in this hypothetical turn."}
        </p>
        <p className="draft-status__description">
          {application?.message ||
            (planning.envelope?.editing_movement
              ? "Edit the recorded fleet and cargo below, then commit to regenerate the preview."
              : typeof update === "object" &&
                  "Stopped" in update &&
                  update.Stopped.reason === "Uncertainty"
                ? "Preview stopped before an unknown outcome. Recorded choices can still be applied."
                : "Preview movement, invasion, and production until an unknown outcome. Apply draft executes recorded choices when your live tactical action is available.")}
        </p>
        {!!planning.envelope?.progress.recorded_answers && (
          <span className="draft-status__progress">
            Replayed {planning.envelope.progress.replayed} · Recorded{" "}
            {planning.envelope.progress.recorded_answers}
          </span>
        )}
      </div>
      <div className="draft-status__actions">
        {planning.envelope?.recorded_decisions?.some(
          (decision) => decision.context?.subtype === "movement_step",
        ) &&
          !application && (
            <button
              type="button"
              className="button button--secondary"
              disabled={
                !planning.availability?.available ||
                !planning.current ||
                planning.busy ||
                !identity ||
                !!planning.envelope.editing_movement
              }
              onClick={() => {
                if (!identity) return;
                setMode("draft");
                request(session.editPlanningMovement(identity));
              }}
            >
              Edit movement
            </button>
          )}
        {hasDraft && (
          <button
            type="button"
            className="button button--secondary"
            disabled={
              !planning.availability?.available ||
              !planning.current ||
              planning.busy ||
              !identity ||
              applying
            }
            onClick={() => identity && request(session.resetPlanning(identity))}
          >
            Reset draft
          </button>
        )}
        {attention && (
          <button
            type="button"
            className="button workspace-attention"
            onClick={() => setMode("live")}
          >
            The live game is waiting for you · Switch to Live
          </button>
        )}
      </div>
      {(requestError || planning.error) && (
        <span className="draft-status__error" role="alert">
          {requestError || planning.error}
        </span>
      )}
    </section>
  );
  const refreshKey = identity ? `${identity.checkpoint_id}:${identity.generation_id}` : "";
  const secondaryChoice = planningChoice(secondaryPlanning);
  const secondaryIdentity = secondaryPlanning.envelope?.identity;
  const secondarySession: UseGameSessionReturn = {
    ...session,
    snapshot:
      secondaryPlanning.publication && session.snapshot
        ? {
            ...session.snapshot,
            view: {
              ...secondaryPlanning.publication.position,
              board: {
                ...secondaryPlanning.publication.position.board,
                map_tiles: session.snapshot.view.board.map_tiles,
              },
            },
            state: {},
            pending_choice: null,
            events: [],
          }
        : null,
    pendingChoice: secondaryChoice,
    turnStatus: null,
    events: [],
    history: { cursor: 0, redo_count: 0 },
    lastError: secondaryPlanning.error,
    submitChoice: (optionId) =>
      secondaryIdentity
        ? session.submitSecondaryPlanningChoice(secondaryIdentity, optionId)
        : Promise.reject(new Error("Draft is preparing.")),
  };
  const secondaryStrip = secondaryView && (
    <SecondaryDraftStrip
      view={secondaryView}
      assumptions={secondaryPlanning.envelope?.assumptions ?? []}
      error={requestError || secondaryPlanning.error}
      onReady={(ready) =>
        secondary?.identity && request(session.setSecondaryReady(secondary.identity, ready))
      }
      onReset={() =>
        secondary?.identity && request(session.resetSecondaryPlanning(secondary.identity))
      }
      onLive={attention ? () => setMode("live") : undefined}
    />
  );
  const draftChrome = (
    <>
      {chrome}
      {statusStrip}
    </>
  );
  return (
    <>
      <WorkspaceContext.Provider
        value={{
          active: mode === "live",
          actionable: session.status === "connected" && !applying,
          draft: false,
          refreshKey: "",
          chrome,
        }}
      >
        <div hidden={mode !== "live"} data-testid="live-workspace">
          <GameWorkspace
            gameId={gameId}
            lobby={lobby}
            viewer={viewer}
            session={session}
            chrome={chrome}
            statusStrip={
              application && (
                <p className="draft-application-message" role="status">
                  {application.message}
                </p>
              )
            }
          />
        </div>
      </WorkspaceContext.Provider>
      {(hasDraft || mode === "draft") && (
        <WorkspaceContext.Provider
          value={{
            active: mode === "draft",
            actionable: !!actionableChoice,
            draft: true,
            refreshKey,
            chrome: draftChrome,
            movementEditRevision: planning.envelope?.movement_edit_revision ?? 0,
            movementEdit: planning.envelope?.editing_movement
              ? {
                  revision: planning.envelope.movement_edit_revision ?? 0,
                  decisions: planning.envelope.recorded_decisions ?? [],
                }
              : undefined,
          }}
        >
          <div hidden={mode !== "draft"} data-testid="draft-workspace">
            <GameWorkspace
              key={planning.resetEpoch}
              gameId={gameId}
              lobby={lobby}
              viewer={viewer}
              session={draftSession}
              chrome={chrome}
              statusStrip={statusStrip}
              draft
            />
          </div>
        </WorkspaceContext.Provider>
      )}
      {secondaryView && mode === "secondary" && (
        <WorkspaceContext.Provider
          value={{
            active: true,
            actionable: !!secondaryChoice,
            draft: true,
            refreshKey: secondaryIdentity
              ? `secondary:${secondaryIdentity.checkpoint_id}:${secondaryIdentity.generation_id}`
              : "secondary",
            chrome: (
              <>
                {chrome}
                {secondaryStrip}
              </>
            ),
          }}
        >
          <div data-testid="secondary-workspace">
            <GameWorkspace
              key={`secondary:${secondary?.card}:${secondaryPlanning.resetEpoch}`}
              gameId={gameId}
              lobby={lobby}
              viewer={viewer}
              session={secondarySession}
              chrome={chrome}
              statusStrip={secondaryStrip}
              draft
            />
          </div>
        </WorkspaceContext.Provider>
      )}
      {confirmation && (
        <ApplyDraftDialog
          decisions={confirmation.decisions}
          ready={
            !!canApply &&
            !!identity &&
            attemptKey(identity) === attemptKey(confirmation.identity) &&
            session.pendingChoice?.nonce === confirmation.nonce &&
            session.gameVersion === confirmation.version
          }
          busy={planning.busy}
          error={requestError || planning.error}
          onClose={() => setConfirmation(null)}
          onConfirm={() => {
            setRequestError(null);
            void session
              .applyPlanning(confirmation.identity, confirmation.nonce, confirmation.version)
              .then(() => {
                setConfirmation(null);
                setMode("live");
              })
              .catch((error) => setRequestError(String(error.message ?? error)));
          }}
        />
      )}
    </>
  );
};

const GameWorkspace: React.FC<{
  gameId: string;
  lobby: import("./protocol/types.ts").LobbyDto;
  viewer: ViewerRole;
  session: UseGameSessionReturn;
  chrome: React.ReactNode;
  statusStrip?: React.ReactNode;
  draft?: boolean;
}> = ({ lobby, viewer, session, chrome, statusStrip, draft }) => {
  const workspace = useWorkspace();
  const selectionBinding = useRef({
    nonce: session.pendingChoice?.nonce,
    refresh: workspace.refreshKey,
    subtype: session.pendingChoice?.context?.subtype,
  });
  const {
    status,
    gameVersion,
    snapshot,
    pendingChoice,
    turnStatus,
    lastError,
    events,
    history: gameHistory,
    submitChoice,
    setReactionMode,
    changeHistory,
    fetchReplay,
    submitMovementBatch,
    submitBatch,
    batchResume,
    resumeBatch,
    dismissBatchResume,
  } = session;
  const { playTurnNotification } = useTurnSound();
  const logHistoryKey = useRef<unknown>(null);
  if (
    snapshot?.type === "initial_snapshot" &&
    snapshot.events &&
    logHistoryKey.current !== snapshot.events
  )
    logHistoryKey.current = snapshot.events;
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const onChangeHistory = (action: import("./protocol/client.ts").HistoryChange, steps = 1) => {
    if (
      historyBusy ||
      (action === "undo_pipeline" &&
        !window.confirm("Undo the latest action and its follow-up decisions for everyone?")) ||
      (steps > 1 && !window.confirm(`Undo ${steps} decisions for everyone in this game?`))
    )
      return;
    setHistoryBusy(true);
    setHistoryError(null);
    void changeHistory(action)
      .then(() => {
        setSelectedOptionId(undefined);
        setSelectedPlanetId(null);
        setSelectedSystemId(null);
        setCardSubject(null);
      })
      .catch((error: unknown) =>
        setHistoryError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setHistoryBusy(false));
  };
  const userSeat = viewer.role === "player" ? viewer.seat : undefined;
  const paymentDraft = usePaymentDraftState(pendingChoice?.nonce);
  const [selectedOptionId, setSelectedOptionId] = useState<string>();
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [cardSubject, setCardSubject] = useState<CardSubject | null>(null);
  const [isTechModalOpen, setIsTechModalOpen] = useState(false);
  const [isObjectivesModalOpen, setIsObjectivesModalOpen] = useState(false);
  useEffect(() => {
    if (draft && !workspace.actionable) return;
    const previous = selectionBinding.current;
    const refreshed =
      previous.refresh !== workspace.refreshKey &&
      previous.subtype === pendingChoice?.context?.subtype;
    selectionBinding.current = {
      nonce: pendingChoice?.nonce,
      refresh: workspace.refreshKey,
      subtype: pendingChoice?.context?.subtype,
    };
    if (
      previous.nonce === pendingChoice?.nonce &&
      previous.refresh === workspace.refreshKey &&
      previous.subtype === pendingChoice?.context?.subtype
    )
      return;
    if (!draft || !refreshed) {
      setSelectedOptionId(undefined);
      setSelectedPlanetId(null);
    }
  }, [pendingChoice?.nonce, draft, workspace.refreshKey, workspace.actionable]);

  // Play sound notification when it becomes the player's turn
  const previousPendingChoiceRef = useRef<string | null>(null);
  useEffect(() => {
    // The draft workspace answers its own offers; only the live game pings.
    if (draft) return;
    const isPendingChoiceForViewer =
      pendingChoice && userSeat && pendingChoice.actor === userSeat;

    if (isPendingChoiceForViewer && previousPendingChoiceRef.current !== pendingChoice.nonce) {
      playTurnNotification();
    }

    previousPendingChoiceRef.current = pendingChoice?.nonce ?? null;
  }, [pendingChoice?.nonce, userSeat, pendingChoice?.actor, playTurnNotification, draft]);
  const cardIsVisible =
    cardSubject &&
    snapshot &&
    (cardSubject.kind === "publicObjective"
      ? snapshot.view.table.revealed_objectives.includes(cardSubject.id)
      : cardSubject.kind === "strategy"
        ? snapshot.view.players.some((player) => player.strategy_cards.includes(cardSubject.id))
        : cardSubject.kind === "action"
          ? snapshot.view.players.some(
              (player) =>
                player.id === userSeat && player.held_action_cards?.includes(cardSubject.id),
            )
          : snapshot.view.players.some(
              (player) =>
                player.scored_secret_objectives?.includes(cardSubject.id) ||
                (player.id === userSeat && player.held_secret_objectives?.includes(cardSubject.id)),
            ));
  const handleSelectTarget = (systemId: string, planetId?: string) => {
    if (!pendingChoice || pendingChoice.actor !== userSeat) return;
    // Paying: a click on a payable planet stages or unstages it (shared with the payment list).
    if (isPaymentChoice(pendingChoice)) {
      if (!planetId) return;
      const option = paymentOptionForPlanet(derivePaymentOffer(pendingChoice), planetId);
      if (!option) return;
      const staged = paymentDraft.draft.planetIds.find((id) => paymentPlanetKey(id) === planetId);
      paymentDraft.togglePlanet(staged ?? option.id);
      return;
    }
    const selection = resolveMapTargetSelection(
      pendingChoice,
      systemId,
      planetId,
      snapshot?.view.board,
    );
    if (selection.kind === "ignore") return;
    setSelectedOptionId(selection.optionId);
    setSelectedPlanetId(selection.planetId);
  };
  return (
    <PlayerIdentityProvider lobby={lobby} seatingOrder={snapshot?.view.seating_order ?? []}>
    <DecisionTableProvider table={snapshot?.view ?? null}>
      {/* The provider wraps the rest unindented to keep this diff small. */}
      <PaymentDraftProvider value={paymentDraft}>
      {historyError && (
        <div className="session-error" role="alert">
          {historyError}
        </div>
      )}
      {/* The draft snapshot is derived from the live one; only the live workspace toasts. */}
      {!draft && (
        <CornerToastLayer
          events={events}
          players={snapshot?.view.players}
          viewerSeat={userSeat}
          pendingChoice={pendingChoice}
          autoResolved={snapshot?.type === "state_update" ? snapshot.auto_resolved : undefined}
          ready={Boolean(snapshot)}
        />
      )}
      <GameShell
        header={
          <div className="game-header">
            <TurnStatusBar
              status={turnStatus}
              view={snapshot?.view ?? null}
              gameVersion={gameVersion}
              connectionStatus={status}
              userSeat={userSeat}
            />
            {chrome}
            {statusStrip}
            <div className="game-header__actions">
              <button
                type="button"
                data-testid="technology-modal-button"
                onClick={() => setIsTechModalOpen(true)}
                className="button button--secondary"
              >
                Technologies
              </button>
              <button
                type="button"
                data-testid="objectives-modal-button"
                onClick={() => setIsObjectivesModalOpen(true)}
                className="button button--secondary"
              >
                Objectives
              </button>
            </div>
          </div>
        }
        board={
          snapshot ? (
            <Board
              board={snapshot.view.board}
              seatingOrder={snapshot.view.seating_order}
              players={snapshot.view.players}
              pendingChoice={pendingChoice}
              viewerSeat={userSeat}
              selectedSystemId={selectedSystemId}
              onSelectSystem={(id) => {
                setSelectedSystemId(id);
                setCardSubject(null);
                // In a planet selection a hex click only inspects; it never drops the pick.
                if (
                  id &&
                  pendingChoice &&
                  pendingChoice.actor === userSeat &&
                  !isPlanetSelectionChoice(pendingChoice)
                ) {
                  const match = pendingChoice.options.find(
                    (option) =>
                      String(option.payload?.system ?? option.payload?.to ?? option.id) === id,
                  );
                  if (!match) {
                    setSelectedOptionId(undefined);
                  }
                }
              }}
              onSelectOptionId={(id) => {
                if (pendingChoice?.options.some((option) => option.id === id))
                  setSelectedOptionId(id);
              }}
              onSelectTarget={handleSelectTarget}
            />
          ) : (
            <div className="game-loading">Loading game state...</div>
          )
        }
        boardView={snapshot?.view.board}
        activeSystemId={
          snapshot?.view.board.active_system ??
          (typeof snapshot?.state.active_system === "string" ? snapshot.state.active_system : null)
        }
        playerSheet={
          snapshot ? (
            <PlayerSheet
              players={snapshot.view.players}
              userSeat={userSeat}
              seatingOrder={snapshot.view.seating_order}
              revealedObjectives={snapshot.view.table.revealed_objectives}
              board={snapshot.view.board}
              table={snapshot.view.table}
              reactionModes={snapshot.reaction_modes}
              onSetReactionMode={!draft && userSeat ? setReactionMode : undefined}
              onInspectCard={(subject) => {
                setSelectedSystemId(null);
                setCardSubject(subject);
              }}
            />
          ) : null
        }
        detail={
          cardSubject &&
          cardIsVisible && (
            <CardDetails subject={cardSubject} onClose={() => setCardSubject(null)} />
          )
        }
        events={events}
        currentPath={snapshot?.current_path}
        logHistoryKey={logHistoryKey.current}
        history={gameHistory}
        historyBusy={historyBusy}
        onChangeHistory={!draft && userSeat === lobby.host_player_id ? onChangeHistory : undefined}
        onFetchReplay={!draft && userSeat ? fetchReplay : undefined}
        choice={pendingChoice}
        viewerSeat={userSeat}
        players={snapshot?.view.players}
        turn={
          snapshot
            ? {
                phase: snapshot.view.phase,
                activePlayer: snapshot.view.active_player ?? null,
              }
            : undefined
        }
        revealedObjectives={snapshot?.view.table.revealed_objectives}
        scoredObjectives={snapshot?.view.table.scored_objectives}
        objectiveProgress={snapshot?.view.table.objective_progress}
        onSubmitChoice={submitChoice}
        reactionModes={snapshot?.reaction_modes}
        onSetReactionMode={!draft && userSeat ? setReactionMode : undefined}
        onSubmitMovementBatch={draft ? undefined : submitMovementBatch}
        onSubmitBasketBatch={draft ? undefined : submitBatch}
        batchResume={draft ? null : batchResume}
        onResumeBatch={draft ? undefined : resumeBatch}
        onDismissBatchResume={draft ? undefined : dismissBatchResume}
        lastError={lastError}
        selectedOptionId={selectedOptionId}
        selectedSystemId={selectedSystemId}
        onSelectOption={setSelectedOptionId}
        selectedPlanetId={selectedPlanetId}
        onSelectPlanet={setSelectedPlanetId}
        onShowSystem={setSelectedSystemId}
      />
      <TechnologyModal
        isOpen={isTechModalOpen}
        onClose={() => setIsTechModalOpen(false)}
        players={snapshot?.view.players}
      />
      <ObjectivesModal
        isOpen={
          isObjectivesModalOpen &&
          pendingChoice?.context?.subtype !== "score_objective" &&
          pendingChoice?.context?.subtype !== "imperial_score_objective"
        }
        onClose={() => setIsObjectivesModalOpen(false)}
        revealedObjectives={snapshot?.view.table.revealed_objectives}
        scoredObjectives={snapshot?.view.table.scored_objectives}
        objectiveProgress={snapshot?.view.table.objective_progress}
        players={snapshot?.view.players}
        viewerSeat={userSeat}
        onInspectCard={(subject) => {
          setSelectedSystemId(null);
          setCardSubject(subject);
        }}
      />
      </PaymentDraftProvider>
    </DecisionTableProvider>
    </PlayerIdentityProvider>
  );
};
