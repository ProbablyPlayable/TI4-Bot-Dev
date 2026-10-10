import type { Page } from "@playwright/test";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type DraftApplication,
  type EngineChoice,
  type PlanningUpdate,
  type SecondaryDraftStatus,
} from "../../../src/protocol/types";
import { GAME_ID, openMockedGame } from "../_shared/mockGame";
import { opponent, playerWithHand, withPlayer } from "../_shared/players";
import { actor } from "../_shared/fixtures";

const PRIMARY = opponent.id;

/** The window's own question, as the engine words it for a card. */
export function followQuestion(card: string, prompt: string, yes: string): EngineChoice {
  return {
    player: actor,
    prompt,
    options: [
      { id: "no", kind: "strategy", label: "decline" },
      { id: "yes", kind: "strategy", label: yes },
    ],
    details: {
      kind: "strategy_secondary",
      card,
      played_by: PRIMARY,
      tokens_left: 2,
      costs_token: true,
    },
  } as EngineChoice;
}

export const research: EngineChoice = {
  player: actor,
  prompt: "research a technology",
  context: { subtype: "research_technology" },
  options: [
    { id: "amd", kind: "research", label: "Antimass Deflectors" },
    { id: "nm", kind: "research", label: "Neural Motivator" },
    { id: "st", kind: "research", label: "Sarween Tools" },
    { id: "decline", kind: "decline", label: "Decline" },
  ],
} as EngineChoice;

/**
 * A follower's view of a strategic action: the opponent played `card`, and the synthetic server
 * acknowledges every secondary-draft request. Each capture then publishes the statuses and
 * draft publications of the moment it shows.
 */
export async function openRound(page: Page, card = "pok7technology") {
  const game = await openMockedGame(page, {
    players: [
      playerWithHand({ strategy_cards: ["pok3politics"] }),
      withPlayer(opponent, { strategy_cards: [card] }),
      withPlayer(opponent, { id: "third_seat", faction: "sol", strategy_cards: ["pok8imperial"] }),
    ],
    choice: null,
    view: { active_player: PRIMARY },
    turnStatus: {
      kind: "waiting_for_decision",
      seat: PRIMARY,
      phase: "action",
      round: 2,
      stage: "strategic_action",
    },
  });
  let secondary: SecondaryDraftStatus = {
    card,
    played_by: PRIMARY,
    window_open: false,
    seats_before: null,
    can_start: true,
    has_draft: false,
    identity: null,
    ready: false,
    application: null,
  };
  let publication = 0;
  const requests: string[] = [];
  game.socket.onMessage((data) => {
    const message = JSON.parse(String(data)) as ClientMessage;
    if (message.type !== "secondary_planning") return;
    requests.push(message.request.action);
    game.send({
      type: "planning_result",
      protocol_version: PROTOCOL_VERSION,
      game_id: GAME_ID,
      draft: "secondary",
      identity: "identity" in message.request ? message.request.identity : null,
      rejection: null,
    });
  });
  const status = (change: Partial<SecondaryDraftStatus> = {}) => {
    secondary = { ...secondary, ...change };
    game.send({
      type: "planning_status",
      protocol_version: PROTOCOL_VERSION,
      game_id: GAME_ID,
      checkpoint_id: 7,
      available: true,
      can_start: true,
      has_draft: false,
      identity: null,
      can_apply: false,
      application: null,
      secondary,
    });
  };
  /** One draft publication: an offer to answer, or where the preview stopped. */
  const publish = (update: PlanningUpdate, recorded: number) => {
    const identity = { checkpoint_id: 7, generation_id: 1, plan_revision: recorded };
    status({ has_draft: true, identity });
    publication += 1;
    game.send({
      type: "planning_update",
      protocol_version: PROTOCOL_VERSION,
      game_id: GAME_ID,
      draft: "secondary",
      envelope: {
        publication_id: publication,
        identity,
        awaiting_answer: typeof update === "object" && "SafeOffer" in update,
        recorded_request_ids: [],
        assumptions: [
          "Other players take no optional reactions in this hypothetical turn.",
          "The primary ability and earlier players' secondaries may not have resolved yet.",
        ],
        progress: {
          recorded_answers: recorded,
          replayed: recorded,
          remaining: 0,
          completed_steps: recorded,
          nested_answers_since_checkpoint: 0,
        },
        update,
      },
    });
  };
  const offer = (choice: EngineChoice, recorded: number) =>
    publish({ SafeOffer: { position: game.snapshot.view, choice, events: [] } }, recorded);
  const stopped = (reason: "SecondaryComplete" | "KnowledgeChanged", recorded: number) =>
    publish(
      {
        Stopped: {
          reason,
          last_safe_publication: { position: game.snapshot.view, choice: null, events: [] },
        },
      },
      recorded,
    );
  /** Opens the secondary workspace from the header tab and waits for the start request. */
  const openDraft = async () => {
    await page.getByTestId("secondary-draft-tab").click();
    await page.getByTestId("secondary-draft-status").waitFor();
  };
  const applied = (application: DraftApplication) => status({ application, ready: false });
  return { game, status, offer, stopped, openDraft, applied, requests };
}
