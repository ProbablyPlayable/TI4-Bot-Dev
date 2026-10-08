import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";
import { createStartedGame, gameSnapshot, openPlayerGame } from "./lobbyHelpers";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type InitialSnapshotMsg,
  type PlanningEnvelope,
  type ServerMessage,
} from "../src/protocol/types";

type Pending = NonNullable<InitialSnapshotMsg["pending_choice"]>;

/** The seat's own socket: what the server sent it, and a way to answer live for it. */
async function wire(page: Page) {
  const incoming: ServerMessage[] = [];
  let upstream: WebSocketRoute;
  await page.routeWebSocket(/\/ws\/games\//, (route) => {
    upstream = route.connectToServer();
    route.onMessage((raw) => upstream.send(raw));
    upstream.onMessage((raw) => {
      incoming.push(JSON.parse(String(raw)) as ServerMessage);
      route.send(raw);
    });
  });
  return {
    incoming,
    send: (message: ClientMessage) => upstream.send(JSON.stringify(message)),
    /** This seat's secondary-draft publications, oldest first. */
    secondary: (): PlanningEnvelope[] =>
      incoming.flatMap((message) =>
        message.type === "planning_update" && message.draft === "secondary"
          ? [message.envelope]
          : [],
      ),
    /** Live secondary questions the server actually put to this seat. */
    promptedForSecondary: () =>
      incoming.filter(
        (message) =>
          message.type === "pending_choice" && message.choice.details?.kind === "strategy_secondary",
      ).length,
  };
}

const cardOf = (optionId: string, name: string) => optionId.toLowerCase().includes(name);
const isSecondary = (pending: Pending) => pending.choice.details?.kind === "strategy_secondary";
const subtype = (pending: Pending) => pending.choice.context?.subtype;

interface Table {
  gameId: string;
  players: { id: string; session: string }[];
  pages: Page[];
  wires: Awaited<ReturnType<typeof wire>>[];
  request: APIRequestContext;
}

async function pendingFor(table: Table): Promise<{ seat: number; pending: Pending; version: number } | null> {
  for (const [seat, player] of table.players.entries()) {
    const state = await gameSnapshot(table.request, table.gameId, player.session);
    if (state.pending_choice?.choice.player === player.id)
      return { seat, pending: state.pending_choice, version: state.game_version };
  }
  return null;
}

/**
 * Answers live questions for whichever seat is asked until `stop` accepts one, and returns it
 * unanswered. `pick` chooses the option; undefined means the first one offered.
 */
async function advance(
  table: Table,
  stop: (seat: number, pending: Pending) => boolean,
  pick: (seat: number, pending: Pending) => string | undefined = () => undefined,
) {
  let answered = "";
  for (let step = 0; step < 120; step++) {
    let current: Awaited<ReturnType<typeof pendingFor>> = null;
    await expect
      .poll(
        async () => {
          current = await pendingFor(table);
          return !!current && current.pending.nonce !== answered;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const { seat, pending, version } = current!;
    if (stop(seat, pending)) return { seat, pending, version };
    table.wires[seat].send({
      type: "submit_choice",
      protocol_version: PROTOCOL_VERSION,
      game_id: table.gameId,
      nonce: pending.nonce,
      expected_version: version,
      option_id: pick(seat, pending) ?? pending.choice.options[0].id,
    });
    answered = pending.nonce;
  }
  throw new Error("the game did not reach the awaited decision");
}

/** Two seats in the action phase: seat `tech` holds Technology, seat `politics` holds Politics. */
async function draftedTable(browser: Browser, request: APIRequestContext) {
  const { table, holders, first } = await tableHolding(browser, request, ["politics", "technology"]);
  return { table, politics: holders[0], tech: holders[1], first };
}

/** Two seats in the action phase; `holders[i]` is the seat that drafted `cards[i]`. */
async function tableHolding(browser: Browser, request: APIRequestContext, cards: [string, string]) {
  const game = await createStartedGame(request, 2, 42);
  const pages = [await browser.newPage(), await browser.newPage()];
  const wires = [await wire(pages[0]), await wire(pages[1])];
  for (const [index, page] of pages.entries())
    await openPlayerGame(page, game.gameId, game.players[index].session);
  const table: Table = { ...game, pages, wires, request };
  // Answers go out over each seat's own socket, so both must be subscribed first.
  await expect
    .poll(() => wires.every((seat) => seat.incoming.some((m) => m.type === "initial_snapshot")))
    .toBe(true);
  const holders = [-1, -1];
  const first = await advance(
    table,
    (_, pending) => subtype(pending) === "action_menu",
    (seat, pending) => {
      if (subtype(pending) !== "draft_strategy_card") return undefined;
      const ids = pending.choice.options.map((option) => option.id);
      // The first card goes to the first picker: with seed 42 that leaves the other card's
      // follower a seat whose home planets can pay a secondary's cost.
      for (const [index, name] of cards.entries()) {
        const card = ids.find((id) => cardOf(id, name));
        if (card && holders[index] < 0 && !holders.includes(seat)) {
          holders[index] = seat;
          return card;
        }
      }
      // Leave the other seat's card on the mat.
      return ids.find((id) => !cards.some((name) => cardOf(id, name))) ?? ids[0];
    },
  );
  for (const [index, name] of cards.entries())
    expect(holders[index], `a seat drafted ${name}`).toBeGreaterThanOrEqual(0);
  return { table, holders, first };
}

/** The action-menu option that plays `name`: a one-card holding offers a bare `strategic`. */
function strategic(pending: Pending, unused: string[], name: string) {
  const ids = pending.choice.options.map((option) => option.id);
  return (
    ids.find((id) => id.startsWith("strategic") && cardOf(id, name)) ??
    (ids.includes("strategic") && unused.length === 1 && cardOf(unused[0], name)
      ? "strategic"
      : undefined)
  );
}

async function seatView(table: Table, seat: number) {
  const state = await gameSnapshot(table.request, table.gameId, table.players[seat].session);
  return state.view.players.find((player) => player.id === table.players[seat].id)!;
}

/**
 * `actor` plays `name` and is left inside its primary. Returns once the follower's page shows the
 * secondary tab, which is before the primary has resolved.
 */
async function play(table: Table, actor: number, follower: number, name: string) {
  const menu = await advance(
    table,
    (seat, pending) => seat === actor && subtype(pending) === "action_menu",
    (_, pending) => (isSecondary(pending) ? "no" : undefined),
  );
  const view = await seatView(table, actor);
  const unused = view.strategy_cards.filter(
    (card) => !view.exhausted_strategy_cards.includes(card),
  );
  const option = strategic(menu.pending, unused, name);
  expect(option, `${name} can be played from ${JSON.stringify(menu.pending.choice.options.map((o) => o.id))}`).toBeTruthy();
  table.wires[actor].send({
    type: "submit_choice",
    protocol_version: PROTOCOL_VERSION,
    game_id: table.gameId,
    nonce: menu.pending.nonce,
    expected_version: menu.version,
    option_id: option!,
  });
  const tab = table.pages[follower]
    .getByTestId("live-workspace")
    .getByTestId("secondary-draft-tab")
    .first();
  await expect(tab).toBeVisible();
  await expect(tab).toContainText(new RegExp(`${name} secondary`, "i"));
  return tab;
}

/** Resolves the actor's primary and everything after it, up to the next turn's action menu. */
async function resolve(table: Table, actor: number) {
  return advance(
    table,
    (seat, pending) => subtype(pending) === "action_menu" && seat !== actor,
    // Nobody answers a secondary by hand here: a prompt would hang the test at the poll.
    (seat, pending) => {
      expect(isSecondary(pending), `seat ${seat} was asked the secondary live`).toBe(false);
      return undefined;
    },
  );
}

test("followers draft a secondary during the primary and the server submits it on their turn", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { table, tech, politics, first } = await draftedTable(browser, request);
  // Initiative decides who acts first; either card's round works as the opening one.
  const order = first.seat === tech ? ["technology", "politics"] : ["politics", "technology"];

  for (const name of order) {
    const actor = name === "technology" ? tech : politics;
    const follower = 1 - actor;
    const page = table.pages[follower];
    const before = await seatView(table, follower);
    const prompts = table.wires[follower].promptedForSecondary();

    const tab = await play(table, actor, follower, name);
    await expect(tab).toContainText("Draft now");
    // The primary player has no secondary of their own card.
    await expect(table.pages[actor].getByTestId("secondary-draft-tab")).toHaveCount(0);

    await tab.click();
    const workspace = page.getByTestId("secondary-workspace");
    const strip = workspace.getByTestId("secondary-draft-status").first();
    await expect(strip.getByTestId("secondary-draft-stage")).toHaveText("Primary still resolving");
    await expect(workspace.getByTestId("strategy-secondary-panel")).toBeVisible();
    await expect(strip.getByTestId("secondary-draft-ready-btn")).toBeDisabled();
    await workspace.getByTestId("secondary-yes-btn").click();

    if (name === "technology") {
      // The draft continues into the research pick the live game would ask.
      await expect(workspace.getByTestId("technology-modal")).toBeVisible();
      await expect
        .poll(() => table.wires[follower].secondary().at(-1)?.progress.recorded_answers)
        .toBe(1);
      const offer = table.wires[follower].secondary().at(-1)!;
      const offered =
        typeof offer.update === "object" && "SafeOffer" in offer.update
          ? (offer.update.SafeOffer.choice?.options ?? [])
          : [];
      const technology = offered.find((option) => option.kind === "research");
      expect(technology, "the draft offers a technology").toBeTruthy();
      await workspace.getByTestId(`tech-card-${technology!.id}`).click();
      await workspace.getByTestId("confirm-research-btn").click();
      await expect(strip.getByTestId("secondary-draft-state")).toHaveText("Draft complete");
    } else {
      // Drawing is never previewed: the follow is recorded and the draft stops there.
      await expect(strip.getByTestId("secondary-draft-state")).toHaveText(
        "Recorded up to an unknown outcome",
      );
    }
    // Nothing reached the live game yet.
    expect((await seatView(table, follower)).strategic_tokens).toBe(before.strategic_tokens);

    await strip.getByTestId("secondary-draft-ready-btn").click();
    await expect(strip.getByTestId("secondary-draft-ready")).toBeVisible();
    await expect(page.getByTestId("secondary-workspace").getByTestId("secondary-draft-tab")).toContainText(
      "Ready",
    );

    await resolve(table, actor);
    const after = await seatView(table, follower);
    expect(after.strategic_tokens).toBe(before.strategic_tokens - 1);
    if (name === "technology")
      expect(after.technologies.length).toBe(before.technologies.length + 1);
    else expect(after.action_cards_count).toBeGreaterThanOrEqual(before.action_cards_count + 2);
    expect(
      table.wires[follower].promptedForSecondary(),
      "the follower was never shown the live secondary question",
    ).toBe(prompts);
    // The round is over: the tab is gone and the page is back on Live.
    await expect(page.getByTestId("secondary-draft-tab")).toHaveCount(0);
    await expect(page.getByTestId("secondary-workspace")).toHaveCount(0);
  }
});

test("a follower who is not ready is asked live, and a reset draft cannot be made ready", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { table, tech, politics, first } = await draftedTable(browser, request);
  const name = first.seat === tech ? "technology" : "politics";
  const actor = name === "technology" ? tech : politics;
  const follower = 1 - actor;
  const page = table.pages[follower];

  const tab = await play(table, actor, follower, name);
  await tab.click();
  const workspace = page.getByTestId("secondary-workspace");
  const strip = workspace.getByTestId("secondary-draft-status").first();
  await workspace.getByTestId("secondary-skip-btn").click();
  await expect(strip.getByTestId("secondary-draft-state")).toHaveText("Draft complete");
  await strip.getByTestId("secondary-draft-reset").click();
  await expect(workspace.getByTestId("strategy-secondary-panel")).toBeVisible();
  await expect(strip.getByTestId("secondary-draft-ready-btn")).toBeDisabled();

  // Not ready: the live window asks this seat as usual once the primary is done.
  const asked = await advance(table, (seat, pending) => seat === follower && isSecondary(pending));
  await expect
    .poll(() => table.wires[follower].promptedForSecondary())
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("secondary-draft-stage").first()).toHaveText(
    "Window open · you are next",
  );
  const before = await seatView(table, follower);
  table.wires[follower].send({
    type: "submit_choice",
    protocol_version: PROTOCOL_VERSION,
    game_id: table.gameId,
    nonce: asked.pending.nonce,
    expected_version: asked.version,
    option_id: "no",
  });
  await advance(table, (_, pending) => subtype(pending) === "action_menu");
  expect((await seatView(table, follower)).strategic_tokens).toBe(before.strategic_tokens);
  await expect(page.getByTestId("secondary-draft-tab")).toHaveCount(0);
});

/**
 * Both seats activate a system and end the action at once; returns at `seat`'s next menu. A
 * command token on the board is what makes Warfare's primary stop to ask, leaving time to draft.
 */
async function activateSomewhere(table: Table, seat: number) {
  const activated = new Set<number>();
  await advance(
    table,
    (asked, pending) =>
      asked === seat && subtype(pending) === "action_menu" && activated.size === 2,
    (asked, pending) => {
      const ids = pending.choice.options.map((option) => option.id);
      if (subtype(pending) === "action_menu") return "tactical";
      if (subtype(pending) === "activate_system") {
        activated.add(asked);
        return ids[0];
      }
      if (isSecondary(pending)) return "no";
      return (
        pending.choice.options.find(
          (option) => option.kind === "decline" || option.id.startsWith("done_"),
        )?.id ?? ids[0]
      );
    },
  );
}

test("Construction and Warfare secondaries are drafted through their nested choices and applied", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const cards: [string, string] = ["construction", "warfare"];
  const { table, holders, first } = await tableHolding(browser, request, cards);
  const order = first.seat === holders[0] ? [0, 1] : [1, 0];

  for (const index of order) {
    const name = cards[index];
    const actor = holders[index];
    const follower = 1 - actor;
    const page = table.pages[follower];
    if (name === "warfare") await activateSomewhere(table, actor);
    const before = await seatView(table, follower);
    const prompts = table.wires[follower].promptedForSecondary();
    const units = async () => {
      const state = await gameSnapshot(table.request, table.gameId, table.players[follower].session);
      return Object.values(state.view.board.systems)
        .flatMap((system) => system.units)
        .filter((unit) => unit.owner === table.players[follower].id).length;
    };
    const unitsBefore = await units();

    const tab = await play(table, actor, follower, name);
    await expect(tab).toContainText("Draft now");
    await tab.click();
    const workspace = page.getByTestId("secondary-workspace");
    const strip = workspace.getByTestId("secondary-draft-status").first();
    await workspace.getByTestId("secondary-yes-btn").click();

    if (name === "construction") {
      // The draft goes on to where the structure is placed.
      await expect(workspace.getByTestId("planet-selection-bar")).toBeVisible();
      await workspace.locator('[data-testid^="planet-chip-"]').first().click();
      // One structure on offer confirms; several ask which one.
      const pick = workspace
        .getByTestId("confirm-planet-btn")
        .or(workspace.locator('[data-testid^="planet-option-"]'))
        .first();
      await pick.click();
    } else {
      // The draft goes on to home production, its payment and where the units stand.
      await expect(workspace.getByTestId("production-builder-drawer")).toBeVisible();
      await workspace
        .locator('[data-testid^="produce-unit-btn-build|"][data-testid*="infantry"]')
        .first()
        .click();
      await workspace.getByRole("button", { name: "Confirm builds" }).click();
      for (let step = 0; step < 8; step++) {
        const state = strip.getByTestId("secondary-draft-state");
        if ((await state.textContent()) === "Draft complete") break;
        if (await workspace.getByTestId("confirm-payment-btn").isVisible()) {
          const auto = workspace.getByTestId("auto-pay-btn");
          if (await auto.isEnabled()) await auto.click();
          await workspace.getByTestId("confirm-payment-btn").click();
        } else if (await workspace.locator('[data-testid^="place-spot-btn-"]').first().isVisible()) {
          await workspace.locator('[data-testid^="place-spot-btn-"]').first().click();
        } else if (await workspace.getByTestId("done-producing-btn").isVisible()) {
          await workspace.getByTestId("done-producing-btn").click();
        }
        await page.waitForTimeout(250);
      }
    }
    await expect(strip.getByTestId("secondary-draft-state")).toHaveText("Draft complete");
    expect(table.wires[follower].secondary().at(-1)!.progress.recorded_answers).toBeGreaterThan(1);
    // Nothing reached the live game yet.
    expect((await seatView(table, follower)).strategic_tokens).toBe(before.strategic_tokens);
    expect(await units()).toBe(unitsBefore);

    await strip.getByTestId("secondary-draft-ready-btn").click();
    await expect(strip.getByTestId("secondary-draft-ready")).toBeVisible();
    await resolve(table, actor);

    expect((await seatView(table, follower)).strategic_tokens).toBe(before.strategic_tokens - 1);
    expect(await units()).toBeGreaterThan(unitsBefore);
    expect(
      table.wires[follower].promptedForSecondary(),
      "the follower was never shown the live secondary question",
    ).toBe(prompts);
    await expect(page.getByTestId("secondary-draft-tab")).toHaveCount(0);
  }
});
