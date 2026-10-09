// The whole screen from one update of the game and what the player staged in this page.
import type { ShellView } from "../../model";
import type { SessionUpdate } from "../wire";
import { type LocalState, boardTask, openChoice, selectAction } from "./action";
import { selectBoard } from "./board";
import { factionName, phaseName } from "./names";
import { selectPlayers, selectSeats } from "./players";

function status(update: SessionUpdate, local: LocalState): string {
  const turn = update.turn_status;
  const faction = (seat: string) =>
    factionName(update.view.players.find((player) => player.id === seat)?.faction ?? seat);
  if (local.error) {
    return "The game stopped";
  }
  if (local.replaying) {
    return `Replaying ${local.replaying.done} of ${local.replaying.total}`;
  }
  if (openChoice(update, local)) {
    return "Your decision";
  }
  switch (turn.kind) {
    case "game_over":
      return turn.winner ? `Game over · ${faction(turn.winner)} wins` : "Game over";
    case "waiting_for_decision":
      return local.sent ? "Sent · the game goes on" : `Waiting for ${faction(turn.seat)}`;
    case "active_turn":
      return `Turn of ${faction(turn.player)}`;
    case "phase_transition":
      return "Between phases";
  }
}

export function selectShell(update: SessionUpdate, local: LocalState): ShellView {
  return {
    seats: selectSeats(update),
    accent: local.staged ? "draft" : "live",
    toolbar: {
      round: update.view.round,
      phase: phaseName(update.view.phase),
      status: status(update, local),
      workspace: "live",
      draftLocked: "Not in local play yet",
      past: null,
      draft: null,
    },
    players: selectPlayers(update),
    board: selectBoard(update, local.inspected, boardTask(update, local)),
    action: selectAction(update, local),
    reference: { objectives: [], technology: [], cards: [], offerCards: [], log: [] },
    apply: null,
    reveal: null,
    toast: null,
    announcement: "",
  };
}
