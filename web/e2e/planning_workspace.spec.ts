import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type Locator,
  type WebSocketRoute,
} from "@playwright/test";
import { createStartedGame, gameSnapshot, openPlayerGame } from "./lobbyHelpers";
import type { ClientMessage, ServerMessage, InitialSnapshotMsg } from "../src/protocol/types";

const backend = `http://127.0.0.1:${process.env.TI4_E2E_BACKEND_PORT ?? "8080"}`;

async function wire(page: Page) {
  const incoming: ServerMessage[] = [];
  const outgoing: ClientMessage[] = [];
  let hold = false;
  let holdStatuses = false;
  let held: (() => void)[] = [];
  let holdResults = false;
  let heldResults: (() => void)[] = [];
  let upstream: WebSocketRoute;
  let downstream: WebSocketRoute;
  let dropAnswer = false;
  await page.routeWebSocket(/\/ws\/games\//, (route) => {
    downstream = route;
    upstream = route.connectToServer();
    route.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as ClientMessage;
      outgoing.push(message);
      if (dropAnswer && message.type === "submit_planning_choice") {
        dropAnswer = false;
        return;
      }
      upstream.send(raw);
    });
    upstream.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as ServerMessage;
      incoming.push(message);
      if (
        hold &&
        (message.type === "planning_update" || (holdStatuses && message.type === "planning_status"))
      )
        held.push(() => route.send(raw));
      else if (holdResults && message.type === "planning_result")
        heldResults.push(() => route.send(raw));
      else route.send(raw);
    });
  });
  return {
    incoming,
    outgoing,
    envelopes: () =>
      incoming
        .filter(
          (m): m is Extract<ServerMessage, { type: "planning_update" }> =>
            m.type === "planning_update",
        )
        .map((m) => m.envelope),
    hold: (results = false, statuses = false) => {
      hold = true;
      holdStatuses = statuses;
      holdResults = results;
    },
    release: (results = true) => {
      hold = false;
      const pending = held;
      held = [];
      pending.forEach((send) => send());
      if (results) {
        holdResults = false;
        const pendingResults = heldResults;
        heldResults = [];
        pendingResults.forEach((send) => send());
      }
    },
    send: (message: ClientMessage) => {
      outgoing.push(message);
      upstream.send(JSON.stringify(message));
    },
    deliver: (message: ServerMessage) => downstream.send(JSON.stringify(message)),
    dropNextAnswer: () => {
      dropAnswer = true;
    },
    disconnect: async () => {
      await downstream.close({ code: 1012, reason: "Reconnect regression" });
      await upstream.close();
    },
  };
}

test("an undelivered draft answer becomes retryable after reconnect to the unchanged offer", async ({
  browser,
  request,
}) => {
  const { gameId, players, pages, wires, b } = await actionGame(browser, request);
  const page = pages[b];
  const trace = wires[b];
  await page.getByRole("button", { name: "Start tactical draft" }).click();
  const draft = page.getByTestId("draft-workspace");
  const confirm = draft.getByTestId("turn-bar-tactical");
  await expect(confirm).toBeEnabled();
  const offer = trace.envelopes().at(-1)!;
  trace.dropNextAnswer();
  await choose(draft, "tactical");
  await expect(confirm).toBeDisabled();
  const lost = trace.outgoing.at(-1)! as Extract<ClientMessage, { type: "submit_planning_choice" }>;
  const count = trace.envelopes().length;
  await trace.disconnect();
  await expect.poll(() => trace.envelopes().length).toBeGreaterThan(count);
  const replacement = trace.envelopes().at(-1)!;
  expect(replacement.identity).toEqual(offer.identity);
  expect(replacement.awaiting_answer).toBe(true);
  expect(replacement.recorded_request_ids).not.toContain(lost.request_id);
  await expect(confirm).toBeEnabled();
  await expect(draft.getByRole("button", { name: "Reset draft" }).last()).toBeEnabled();
  await choose(draft, "tactical");
  await expect(draft.getByTestId("system-activation-bar")).toBeVisible();
  const answers = trace.outgoing.filter(
    (message): message is Extract<ClientMessage, { type: "submit_planning_choice" }> =>
      message.type === "submit_planning_choice",
  );
  expect(answers).toHaveLength(2);
  expect(answers[1].request_id).not.toBe(lost.request_id);
  expect(
    (await gameSnapshot(request, gameId, players[b].session)).pending_choice ?? null,
  ).toBeNull();
});

test("an undelivered movement pipeline retries after reconnect without losing or repeating its cargo", async ({
  browser,
  request,
}) => {
  const { gameId, players, pages, wires, b } = await actionGame(browser, request);
  const trace = wires[b];
  const initial = await gameSnapshot(request, gameId, players[b].session);
  const { draft, target } = await beginDraft(pages[b], trace, initial, players[b].id);
  const offer = trace.envelopes().at(-1)!;
  trace.dropNextAnswer();
  await draft.getByTestId("commit-moves-btn").click();
  await expect
    .poll(() => trace.outgoing.filter((m) => m.type === "submit_planning_choice").length)
    .toBe(3);
  const count = trace.envelopes().length;
  await trace.disconnect();
  await expect.poll(() => trace.envelopes().length).toBeGreaterThan(count);
  expect(trace.envelopes()[count].identity).toEqual(offer.identity);
  expect(trace.envelopes()[count].awaiting_answer).toBe(true);
  await expect(draft.getByTestId("draft-status").first()).toContainText(
    /Tactical action complete|Unsupported boundary|Uncertainty/,
  );
  const submissions = trace.outgoing.filter(
    (m): m is Extract<ClientMessage, { type: "submit_planning_choice" }> =>
      m.type === "submit_planning_choice",
  );
  expect(submissions.filter((m) => m.option_id.startsWith("move|"))).toHaveLength(2);
  expect(submissions.filter((m) => m.option_id.startsWith("load|"))).toHaveLength(1);
  const stopped = trace.envelopes().at(-1)!;
  expect(stopped.progress.recorded_answers).toBe(submissions.length - 1);
  const publication =
    typeof stopped.update === "object" && "Stopped" in stopped.update
      ? stopped.update.Stopped.last_safe_publication!
      : null;
  expect(publication).not.toBeNull();
  expect(
    publication!.position.board.systems[target].units.filter((u) => u.owner === players[b].id),
  ).toHaveLength(2);
});

for (const staging of ["unsubmitted", "in-flight"] as const) {
  test(`a cross-tab reset clears ${staging} movement intent before a new draft offer`, async ({
    browser,
    request,
  }) => {
    const { gameId, players, pages, wires, b } = await actionGame(browser, request);
    const trace = wires[b];
    const initial = await gameSnapshot(request, gameId, players[b].session);
    const { draft, target, carrier } = await beginDraft(pages[b], trace, initial, players[b].id);
    const carrierCount = draft.getByTestId(
      (await carrier.getAttribute("data-testid"))!.replace("rally-inc-", "rally-count-"),
    );
    if (staging === "in-flight") {
      trace.dropNextAnswer();
      await draft.getByTestId("commit-moves-btn").click();
      await expect
        .poll(() => trace.outgoing.filter((m) => m.type === "submit_planning_choice").length)
        .toBe(3);
    }
    const answersBeforeReset = trace.outgoing.filter(
      (m) => m.type === "submit_planning_choice",
    ).length;
    const otherTab = await browser.newPage();
    const otherWire = await wire(otherTab);
    await openPlayerGame(otherTab, gameId, players[b].session);
    await otherTab
      .getByTestId("live-workspace")
      .getByRole("button", { name: "Draft", exact: true })
      .first()
      .click();
    const otherDraft = otherTab.getByTestId("draft-workspace");
    await expect(otherDraft.getByTestId("tactical-movement-tray")).toBeVisible();
    await otherDraft.getByRole("button", { name: "Reset draft" }).last().click();
    await choose(otherDraft, "tactical");
    await expect(otherDraft.getByTestId("system-activation-bar")).toBeVisible();
    await otherDraft.getByTestId(`system-hex-${target}`).dispatchEvent("click");
    await otherDraft.getByTestId("confirm-activation-btn").click();
    await expect(otherDraft.getByTestId("tactical-movement-tray")).toBeVisible();
    await expect
      .poll(() => trace.envelopes().at(-1)?.identity)
      .toEqual(otherWire.envelopes().at(-1)!.identity);
    await expect(draft.getByTestId("commit-moves-btn")).toHaveText("Done Moving");
    await expect(carrierCount).toHaveText("0");
    await expect(draft.getByTestId("movement-progress")).toHaveCount(0);
    expect(trace.outgoing.filter((m) => m.type === "submit_planning_choice")).toHaveLength(
      answersBeforeReset,
    );
  });
}

async function choose(scope: Locator, option: string) {
  // The turn menu is a bar whose buttons submit at once; every other question is a list.
  if (option === "tactical") {
    await scope.getByTestId("turn-bar-tactical").click();
    return;
  }
  await scope.locator(`[data-testid="choice-option"][data-option-id="${option}"]`).click();
  await scope.getByTestId("submit-choice-button").click();
}

async function actionGame(browser: import("@playwright/test").Browser, request: APIRequestContext) {
  const game = await createStartedGame(request, 2, 42);
  const pages = [await browser.newPage(), await browser.newPage()];
  const wires = [await wire(pages[0]), await wire(pages[1])];
  for (const [index, page] of pages.entries())
    await openPlayerGame(page, game.gameId, game.players[index].session);
  for (let pick = 0; pick < 8; pick++) {
    await expect
      .poll(async () => {
        const state = await gameSnapshot(request, game.gameId, game.players[0].session);
        return (
          state.view.phase.toLowerCase() === "action" ||
          state.turn_status.kind === "waiting_for_decision"
        );
      })
      .toBe(true);
    const state = await gameSnapshot(request, game.gameId, game.players[0].session);
    if (state.view.phase.toLowerCase() === "action") break;
    const seat = state.turn_status.kind === "waiting_for_decision" ? state.turn_status.seat : "";
    const index = game.players.findIndex((p) => p.id === seat);
    if (index < 0) {
      pick--;
      continue;
    }
    await expect
      .poll(
        async () =>
          (await gameSnapshot(request, game.gameId, game.players[index].session)).pending_choice
            ?.choice.context?.subtype,
      )
      .toBe("draft_strategy_card");
    const offer = await gameSnapshot(request, game.gameId, game.players[index].session);
    await choose(
      pages[index].getByTestId("live-workspace"),
      offer.pending_choice!.choice.options[0].id,
    );
  }
  await expect
    .poll(async () =>
      (await gameSnapshot(request, game.gameId, game.players[0].session)).view.phase.toLowerCase(),
    )
    .toBe("action");
  const state = await gameSnapshot(request, game.gameId, game.players[0].session);
  const a = game.players.findIndex((p) => p.id === state.view.active_player);
  expect(a).toBeGreaterThanOrEqual(0);
  const b = 1 - a;
  const spectator = await browser.newPage();
  const spectatorWire = await wire(spectator);
  await spectator.goto(`/games/${game.gameId}`);
  await spectator.getByRole("button", { name: /Watch/ }).click();
  await expect(spectator.getByTestId("game-container")).toBeVisible();
  return { ...game, pages, wires, a, b, spectator, spectatorWire };
}

function targetNear(state: InitialSnapshotMsg, seat: string, options: string[]) {
  const origin = Object.values(state.view.board.systems).find((s) =>
    s.units.some((u) => u.owner === seat && u.unit_type.includes("carrier")),
  );
  expect(origin).toBeDefined();
  const positions = new Map(state.galaxy_layout.placements.map((p) => [p.system_id, p]));
  const from = positions.get(origin!.system_id)!;
  const candidates = options.filter((id) => {
    const to = positions.get(id);
    const system = state.view.board.systems[id];
    const tile = state.view.board.map_tiles?.find((t) => t.system_id === id);
    return (
      to &&
      id !== origin!.system_id &&
      !system?.units.some((u) => u.owner !== seat) &&
      !tile?.anomalies?.length &&
      !tile?.hyperlane &&
      (Math.abs(from.q - to.q) +
        Math.abs(from.r - to.r) +
        Math.abs(from.q + from.r - to.q - to.r)) /
        2 ===
        1
    );
  });
  // Empty space avoids invasion decisions; a planet tile is still valid for drafting movement.
  const target =
    candidates.find(
      (id) => !state.view.board.map_tiles?.find((t) => t.system_id === id)?.planets?.length,
    ) ?? candidates[0];
  expect(target, "a safe adjacent activation").toBeDefined();
  return { origin: origin!.system_id, target };
}

async function beginDraft(
  page: Page,
  trace: Awaited<ReturnType<typeof wire>>,
  state: InitialSnapshotMsg,
  seat: string,
) {
  await page.getByRole("button", { name: "Start tactical draft" }).click();
  const draft = page.getByTestId("draft-workspace");
  await choose(draft, "tactical");
  await expect(draft.getByTestId("system-activation-bar")).toBeVisible();
  const offer = trace
    .envelopes()
    .findLast(
      (e) =>
        typeof e.update === "object" &&
        "SafeOffer" in e.update &&
        e.update.SafeOffer.choice?.context?.subtype === "activate_system",
    )!;
  expect(offer).toBeDefined();
  const publication =
    typeof offer.update === "object" && "SafeOffer" in offer.update ? offer.update.SafeOffer : null;
  const { origin, target } = targetNear(
    state,
    seat,
    publication!.choice!.options.map((o) => o.id),
  );
  await draft.getByTestId(`system-hex-${target}`).dispatchEvent("click");
  await draft.getByTestId("confirm-activation-btn").click();
  await expect(draft.getByTestId("tactical-movement-tray")).toBeVisible();
  const ship = draft
    .locator(`[data-testid^="rally-inc-${origin}-"]`)
    .filter({ hasNotText: "cargo" });
  const carrier = draft
    .locator(`[data-testid^="rally-inc-${origin}-"][data-testid$="carrier"]`)
    .first();
  await expect(carrier).toBeVisible();
  await carrier.click();
  const cargo = draft.locator(`[data-testid^="rally-inc-cargo-${origin}-"]`).first();
  await expect(cargo).toBeVisible();
  await cargo.click();
  return { draft, origin, target, carrier, cargo, ship };
}

async function history(
  request: APIRequestContext,
  gameId: string,
  session: string,
  action: "undo" | "redo",
) {
  await expect(async () => {
    const state = await gameSnapshot(request, gameId, session);
    const response = await request.post(`${backend}/api/games/${gameId}/history`, {
      headers: { "x-ti4-player-session": session },
      data: { action, expected_version: state.game_version },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }).toPass({ timeout: 5000 });
}

for (const delivery of ["refresh", "reconnect"] as const) {
  test(`a shorter cross-tab editor replacement stops stale movement after ${delivery}`, async ({
    browser,
    request,
  }) => {
    test.setTimeout(60_000);
    const { gameId, players, pages, wires, a, b } = await actionGame(browser, request);
    const trace = wires[b];
    const initial = await gameSnapshot(request, gameId, players[b].session);
    const { draft } = await beginDraft(pages[b], trace, initial, players[b].id);
    await draft.getByTestId("commit-moves-btn").click();
    await expect(draft.getByTestId("draft-status").first()).toContainText(
      /Tactical action complete|Unsupported boundary|Uncertainty/,
    );
    await draft.getByRole("button", { name: "Edit movement", exact: true }).first().click();
    await expect(draft.getByTestId("tactical-movement-tray")).toBeVisible();
    const offer = trace.envelopes().at(-1)!;
    expect(offer.progress.recorded_answers).toBeGreaterThan(3);
    const otherTab = await browser.newPage();
    const otherTrace = await wire(otherTab);
    await openPlayerGame(otherTab, gameId, players[b].session);
    await expect.poll(() => otherTrace.envelopes().at(-1)?.identity).toEqual(offer.identity);
    const choice =
      typeof offer.update === "object" && "SafeOffer" in offer.update
        ? offer.update.SafeOffer.choice!
        : null;
    const alternative = choice!.options.find(
      (o) => o.kind === "move" && !String(o.payload?.unit).includes("carrier"),
    )!;
    expect(alternative).toBeDefined();
    // Drop the losing answer, and withhold the winner's publication until the
    // live checkpoint advances. The losing client sees only the refreshed script.
    trace.hold(false, true);
    trace.dropNextAnswer();
    const before = trace.outgoing.filter((m) => m.type === "submit_planning_choice").length;
    await draft.getByTestId("commit-moves-btn").click();
    await expect
      .poll(() => trace.outgoing.filter((m) => m.type === "submit_planning_choice").length)
      .toBe(before + 1);
    otherTrace.send({
      type: "submit_planning_choice",
      protocol_version: 3,
      game_id: gameId,
      identity: offer.identity,
      option_id: alternative.id,
      request_id: "shorter-script-winner",
    });
    await expect.poll(() => otherTrace.envelopes().at(-1)?.progress.recorded_answers).toBe(3);
    await choose(pages[a].getByTestId("live-workspace"), "tactical");
    await expect
      .poll(() => otherTrace.envelopes().at(-1)?.identity.checkpoint_id)
      .toBeGreaterThan(offer.identity.checkpoint_id);
    if (delivery === "reconnect") {
      const count = trace.envelopes().length;
      const subscriptions = trace.outgoing.filter((m) => m.type === "subscribe").length;
      await trace.disconnect();
      await expect
        .poll(() => trace.outgoing.filter((m) => m.type === "subscribe").length)
        .toBeGreaterThan(subscriptions);
      await expect
        .poll(() =>
          trace
            .envelopes()
            .slice(count)
            .some(
              (e) =>
                e.update !== "Preparing" && e.identity.checkpoint_id > offer.identity.checkpoint_id,
            ),
        )
        .toBe(true);
      const status = trace.incoming.findLast((m) => m.type === "planning_status")!;
      trace.deliver(status);
    }
    const refreshed = trace.envelopes().at(-1)!;
    expect(refreshed.progress.recorded_answers).toBe(3);
    expect(refreshed.recorded_request_ids).toContain("shorter-script-winner");
    trace.deliver({
      type: "planning_update",
      protocol_version: 3,
      game_id: gameId,
      envelope: refreshed,
    });
    await expect(draft.getByTestId("movement-error-banner")).toContainText(
      "Another connection answered",
    );
    expect(trace.outgoing.filter((m) => m.type === "submit_planning_choice")).toHaveLength(
      before + 1,
    );
    await otherTab.close();
  });
}

test("Apply draft confirms the supported prefix in Live and reconnect never applies it twice", async ({
  browser,
  request,
}) => {
  const game = await actionGame(browser, request);
  const { gameId, players, pages, wires, a, b } = game;
  const page = pages[b];
  const initialLiveSubmissions = wires[b].outgoing.filter(
    (message) => message.type === "submit_choice",
  ).length;
  const initial = await gameSnapshot(request, gameId, players[b].session);
  const { draft, target } = await beginDraft(page, wires[b], initial, players[b].id);
  await draft.getByTestId("commit-moves-btn").click();
  await expect(draft.getByTestId("draft-status").first()).toContainText(
    /Tactical action complete|Unsupported boundary|Uncertainty/,
  );
  await expect(
    draft.getByRole("button", { name: "Apply draft", exact: true }).first(),
  ).toBeDisabled();
  // A takes an empty tactical action, then hands over the real action opportunity.
  for (let step = 0; step < 12; step++) {
    const state = await gameSnapshot(request, gameId, players[a].session);
    const offered = state.pending_choice;
    if (!offered) break;
    const options = offered.choice.options;
    const option =
      options.find((option) => option.id === "end_turn") ??
      (offered.choice.context?.subtype === "activate_system"
        ? options.find((option) => option.id === target)
        : undefined) ??
      options.find((option) => option.id === "done_moving") ??
      options.find((option) => option.kind === "decline") ??
      options.find((option) => option.id === "tactical");
    expect(option, `advance ${offered.choice.context?.subtype}`).toBeDefined();
    wires[a].send({
      type: "submit_choice",
      protocol_version: 3,
      game_id: gameId,
      nonce: offered.nonce,
      expected_version: state.game_version,
      option_id: option!.id,
    });
    await expect
      .poll(
        async () => (await gameSnapshot(request, gameId, players[a].session)).pending_choice?.nonce,
      )
      .not.toBe(offered.nonce);
  }
  const apply = draft.getByRole("button", { name: "Apply draft", exact: true }).first();
  await expect(apply).toBeEnabled();
  const before = await gameSnapshot(request, gameId, players[b].session);
  const ownerBefore = before.view.players.find((player) => player.id === players[b].id)!;
  await apply.click();
  const dialog = page.getByTestId("apply-draft-dialog");
  await expect(dialog).toContainText(`Activate system ${target}`);
  await expect(dialog).toContainText("Activation spends 1 tactic token");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(wires[b].outgoing.filter((message) => message.type === "apply_planning")).toHaveLength(0);
  expect((await gameSnapshot(request, gameId, players[b].session)).game_version).toBe(
    before.game_version,
  );
  await apply.click();
  await dialog.getByRole("button", { name: "Confirm and apply", exact: true }).click();
  const live = page.getByTestId("live-workspace");
  await expect(live).toBeVisible();
  await expect(live.getByTestId("draft-application-status").first()).toContainText(/^Applied/);
  const applied = await gameSnapshot(request, gameId, players[b].session);
  const ownerAfter = applied.view.players.find((player) => player.id === players[b].id)!;
  expect(ownerAfter.tactic_tokens).toBe(ownerBefore.tactic_tokens - 1);
  expect(applied.view.board.systems[target].command_tokens).toContain(players[b].id);
  expect(
    applied.view.board.systems[target].units.filter((unit) => unit.owner === players[b].id).length,
  ).toBeGreaterThanOrEqual(2);
  const submissions = wires[b].outgoing.filter((message) => message.type === "apply_planning");
  expect(submissions).toHaveLength(1);
  expect(wires[b].outgoing.filter((message) => message.type === "submit_choice")).toHaveLength(
    initialLiveSubmissions,
  );
  const progress = await live.getByTestId("draft-application-status").first().textContent();
  await page.reload();
  await expect(
    page.getByTestId("live-workspace").getByTestId("draft-application-status").first(),
  ).toHaveText(progress!);
  wires[b].send(submissions[0]);
  await expect
    .poll(
      () =>
        wires[b].incoming.filter(
          (message) => message.type === "planning_result" && message.rejection !== null,
        ).length,
    )
    .toBeGreaterThan(0);
  const reconnected = await gameSnapshot(request, gameId, players[b].session);
  expect(reconnected.history?.cursor).toBe(applied.history?.cursor);
  expect(reconnected.view.board).toEqual(applied.view.board);
  expect(
    reconnected.view.players.find((player) => player.id === players[b].id)!.tactic_tokens,
  ).toBe(ownerAfter.tactic_tokens);
  for (const opened of [...pages, game.spectator]) await opened.close();
});

test("a manual two-player game exposes tactical drafting after strategy selection in two browser tabs", async ({
  context,
  request,
}) => {
  const host = await context.newPage();
  await host.goto("/");
  await host.getByLabel("Players").selectOption("2");
  await host.getByLabel("Nickname").fill("Draft Host");
  await host.getByLabel("Seed (dev, optional)").fill("42");
  await host.getByTestId("create-game-button").click();
  await expect(host.getByTestId("ready-button")).toBeVisible();
  const gameUrl = host.url();
  const gameId = new URL(gameUrl).pathname.split("/").pop()!;

  const guest = await context.newPage();
  await guest.goto(gameUrl);
  await guest.getByLabel("Nickname").fill("Draft Guest");
  await guest.getByRole("button", { name: "Join game", exact: true }).click();
  // The host is shown the map picker first; the default map will do.
  await host.getByTestId("map-picker-done").click();
  await host.getByTestId("ready-button").click();
  await guest.getByTestId("ready-button").click();
  await host.getByTestId("start-game-button").click();
  const pages = [host, guest];
  const players = await Promise.all(
    pages.map(async (page) => {
      await expect(page.getByTestId("game-container")).toBeVisible();
      const session = await page.evaluate(
        (id) => sessionStorage.getItem(`ti4.player-session:${id}`)!,
        gameId,
      );
      const state = await gameSnapshot(request, gameId, session);
      return { session, id: state.viewer.role === "player" ? state.viewer.seat : "" };
    }),
  );
  expect(players[0].session).not.toBe(players[1].session);
  for (let pick = 0; pick < 8; pick++) {
    const state = await gameSnapshot(request, gameId, players[0].session);
    if (state.view.phase.toLowerCase() === "action") break;
    const seat = state.turn_status.kind === "waiting_for_decision" ? state.turn_status.seat : "";
    const index = players.findIndex((player) => player.id === seat);
    expect(index).toBeGreaterThanOrEqual(0);
    const offer = await gameSnapshot(request, gameId, players[index].session);
    expect(offer.pending_choice?.choice.context?.subtype).toBe("draft_strategy_card");
    await choose(
      pages[index].getByTestId("live-workspace"),
      offer.pending_choice!.choice.options[0].id,
    );
    await expect
      .poll(async () => (await gameSnapshot(request, gameId, players[index].session)).game_version)
      .toBeGreaterThan(offer.game_version);
  }
  const state = await gameSnapshot(request, gameId, players[0].session);
  expect(state.view.phase.toLowerCase()).toBe("action");
  const waiting = pages[players.findIndex((player) => player.id !== state.view.active_player)];
  const start = waiting.getByRole("button", { name: "Start tactical draft" }).first();
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
  for (const width of [1280, 1024, 768, 640, 390]) {
    await waiting.setViewportSize({ width, height: 720 });
    await expect(start, `draft control at viewport width ${width}`).toBeInViewport({ ratio: 1 });
  }
  await start.click();
  const draft = waiting.getByTestId("draft-workspace");
  await expect(draft).toBeVisible();
  await expect(
    draft.getByTestId("turn-bar-tactical"),
  ).toBeVisible();
});

test("reopening a recorded fleet preserves independent ships, cargo, and camera while editing", async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const game = await actionGame(browser, request);
  const { gameId, players, pages, wires, b } = game;
  const page = pages[b];
  const initial = await gameSnapshot(request, gameId, players[b].session);
  const { draft, origin } = await beginDraft(page, wires[b], initial, players[b].id);
  const independent = draft
    .locator(
      `[data-testid^="rally-inc-${origin}-"]:not([data-testid$="carrier"]):not([data-testid*="cargo"])`,
    )
    .first();
  await expect(independent).toBeVisible();
  const independentId = (await independent.getAttribute("data-testid"))!;
  await independent.click();
  await draft.getByTestId("commit-moves-btn").click();
  await expect(draft.getByTestId("draft-status").first()).toContainText(
    /Tactical action complete|Unsupported boundary|Uncertainty/,
  );
  const original = wires[b].envelopes().at(-1)!;
  await draft.getByTitle("Zoom In", { exact: true }).click();
  const camera = await draft.locator('[data-testid="ti4-board-svg"] > g').getAttribute("transform");
  await draft.getByRole("button", { name: "Edit movement", exact: true }).first().click();
  await expect(draft.getByTestId("tactical-movement-tray")).toBeVisible();
  await expect(draft.getByTestId(independentId.replace("rally-inc-", "rally-count-"))).toHaveText(
    "1",
  );
  await expect(draft.getByTestId("cargo-capacity-gauge-" + origin)).toContainText("1 loaded /");
  await expect(draft.locator('[data-testid="ti4-board-svg"] > g')).toHaveAttribute(
    "transform",
    camera!,
  );
  expect(wires[b].envelopes().at(-1)!.recorded_decisions).toEqual(original.recorded_decisions);
  await draft.getByTestId(independentId.replace("rally-inc-", "rally-dec-")).click();
  await expect(draft.getByTestId("commit-moves-btn")).toHaveText("Commit Moves (2)");
  await draft.getByRole("button", { name: /^Live/ }).last().click();
  await page
    .getByTestId("live-workspace")
    .getByRole("button", { name: "Draft", exact: true })
    .first()
    .click();
  await expect(draft.getByTestId(independentId.replace("rally-inc-", "rally-count-"))).toHaveText(
    "0",
  );
  await draft.getByTestId("commit-moves-btn").click();
  await expect(draft.getByTestId("draft-status").first()).toContainText(
    /Tactical action complete|Unsupported boundary|Uncertainty/,
  );
  const revised = wires[b].envelopes().at(-1)!;
  const moves = revised.recorded_decisions!.filter((decision) => decision.kind === "move");
  expect(moves).toHaveLength(1);
  expect(String(moves[0].payload.unit)).toContain("carrier");
  expect(revised.recorded_decisions!.filter((decision) => decision.kind === "load")).toHaveLength(
    1,
  );
  expect(revised.editing_movement).toBe(false);
  expect((await gameSnapshot(request, gameId, players[b].session)).view.board).toEqual(
    initial.view.board,
  );
  // Reloading an open editor restores its selections from the original server-held script.
  await draft.getByRole("button", { name: "Edit movement", exact: true }).first().click();
  await expect(draft.getByTestId("commit-moves-btn")).toHaveText("Commit Moves (2)");
  await page.reload();
  await page
    .getByTestId("live-workspace")
    .getByRole("button", { name: "Draft", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("draft-workspace").getByTestId("commit-moves-btn")).toHaveText(
    "Commit Moves (2)",
  );
  for (const opened of [...pages, game.spectator]) await opened.close();
});

test("private tactical draft preserves staging, refreshes after live movement, survives history/reload, and resets", async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const game = await actionGame(browser, request);
  const { gameId, players, pages, wires, a, b, spectatorWire } = game;
  const page = pages[b];
  await expect(
    pages[a].getByRole("button", { name: "Start tactical draft" }).last(),
  ).toBeDisabled();
  const initial = await gameSnapshot(request, gameId, players[b].session);
  const liveNonce = (await gameSnapshot(request, gameId, players[a].session)).pending_choice?.nonce;
  let batches = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/batches")) batches++;
  });
  const { draft, target, carrier } = await beginDraft(page, wires[b], initial, players[b].id);
  await draft.getByRole("button", { name: /^Live/, exact: false }).last().click();
  await expect(page.getByTestId("live-workspace")).toBeVisible();
  await page
    .getByTestId("live-workspace")
    .getByRole("button", { name: "Draft", exact: true })
    .first()
    .click();
  await expect(carrier).toBeVisible();
  await expect(draft.getByTestId("fleet-supply-gauge")).toContainText("1 /");
  await expect(draft.locator(`[data-testid^="cargo-capacity-gauge-"]`)).toContainText("1 loaded /");
  await draft.getByTestId("close-movement-tray").click();
  await draft.getByTitle("Zoom In", { exact: true }).click();
  const camera = await draft.locator('[data-testid="ti4-board-svg"] > g').getAttribute("transform");
  await draft.getByRole("button", { name: /^Live/ }).first().click();
  await page
    .getByTestId("live-workspace")
    .getByRole("button", { name: "Draft", exact: true })
    .first()
    .click();
  await expect(draft.getByTestId("choice-minimized-pill")).toBeVisible();
  await expect(draft.locator('[data-testid="ti4-board-svg"] > g')).toHaveAttribute(
    "transform",
    camera!,
  );
  await draft.getByTestId("resume-decision-btn").click();
  await draft.getByTestId("commit-moves-btn").click();
  await expect(draft.getByTestId("draft-status").first()).toContainText(
    /Tactical action complete|Uncertainty|Unsupported boundary/,
  );
  const completed = wires[b]
    .envelopes()
    .findLast((e) => typeof e.update === "object" && "Stopped" in e.update)!;
  const stopped =
    typeof completed.update === "object" && "Stopped" in completed.update
      ? completed.update.Stopped
      : null;
  const units = stopped!.last_safe_publication!.position.board.systems[target].units;
  expect(units.filter((u) => u.owner === players[b].id).length).toBeGreaterThanOrEqual(2);
  expect(batches).toBe(0);
  expect((await gameSnapshot(request, gameId, players[a].session)).pending_choice?.nonce).toBe(
    liveNonce,
  );
  expect((await gameSnapshot(request, gameId, players[b].session)).view.board).toEqual(
    initial.view.board,
  );
  await expect(draft.getByTestId("commit-moves-btn")).toHaveCount(0);

  // A advances real activation and movement while B continues inspecting Draft.
  await choose(pages[a].getByTestId("live-workspace"), "tactical");
  await expect(pages[a].getByTestId("system-activation-bar")).toBeVisible();
  const active = await gameSnapshot(request, gameId, players[a].session);
  const liveTarget = targetNear(
    active,
    players[a].id,
    active.pending_choice!.choice.options.map((o) => o.id),
  );
  await pages[a].getByTestId(`system-hex-${liveTarget.target}`).dispatchEvent("click");
  await pages[a].getByTestId("confirm-activation-btn").click();
  await expect(pages[a].getByTestId("tactical-movement-tray")).toBeVisible();
  await pages[a]
    .locator(`[data-testid^="rally-inc-${liveTarget.origin}-"][data-testid$="carrier"]`)
    .first()
    .click();
  await pages[a].getByTestId("commit-moves-btn").click();
  await expect
    .poll(
      () =>
        wires[b]
          .envelopes()
          .findLast(
            (e) => e.awaiting_answer || (typeof e.update === "object" && "Stopped" in e.update),
          )?.identity.checkpoint_id,
    )
    .toBeGreaterThan(completed.identity.checkpoint_id);
  await expect(draft).toBeVisible();
  await expect(draft.getByTestId("draft-status").first()).toContainText(
    /Tactical action complete|Replay mismatch|Uncertainty|Unsupported boundary/,
  );
  const beforeUndo = wires[b].envelopes().at(-1)!.identity.checkpoint_id;
  await history(request, gameId, players[0].session, "undo");
  await expect
    .poll(() => wires[b].envelopes().at(-1)?.identity.checkpoint_id)
    .toBeGreaterThan(beforeUndo);
  const beforeRedo = wires[b].envelopes().at(-1)!.identity.checkpoint_id;
  await history(request, gameId, players[0].session, "redo");
  await expect
    .poll(() => wires[b].envelopes().at(-1)?.identity.checkpoint_id)
    .toBeGreaterThan(beforeRedo);
  await expect(draft).toBeVisible();
  const recorded = completed.progress.recorded_answers;
  await expect.poll(() => wires[b].envelopes().at(-1)?.progress.recorded_answers).toBe(recorded);
  await page.reload();
  await page
    .getByTestId("live-workspace")
    .getByRole("button", { name: "Draft", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("draft-status").first()).toContainText(`Recorded ${recorded}`);
  expect(
    await page
      .getByTestId("draft-workspace")
      .locator('[data-testid="ti4-board-svg"] > g')
      .getAttribute("transform"),
  ).not.toBe(camera);
  const zoom = page.getByTestId("draft-workspace").getByTitle("Zoom In", { exact: true });
  await zoom.focus();
  // Finish A's deterministic live workflow until the server asks B a real question.
  for (let step = 0; step < 16; step++) {
    const state = await gameSnapshot(request, gameId, players[b].session);
    if (state.pending_choice?.choice.player === players[b].id) break;
    await expect
      .poll(
        async () => (await gameSnapshot(request, gameId, players[a].session)).pending_choice?.nonce,
      )
      .toBeTruthy();
    const current = await gameSnapshot(request, gameId, players[a].session);
    const offered = current.pending_choice!;
    const option =
      offered.choice.options.find((o) => o.id === "end_turn") ??
      offered.choice.options.find((o) => o.kind === "decline") ??
      offered.choice.options.find((o) => o.id.startsWith("done_"));
    expect(
      option,
      `finish ${offered.choice.context?.subtype}: ${offered.choice.options.map((o) => o.id).join(", ")}`,
    ).toBeDefined();
    wires[a].send({
      type: "submit_choice",
      protocol_version: 3,
      game_id: gameId,
      nonce: offered.nonce,
      expected_version: current.game_version,
      option_id: option!.id,
    });
    await expect
      .poll(
        async () => (await gameSnapshot(request, gameId, players[a].session)).pending_choice?.nonce,
      )
      .not.toBe(offered.nonce);
  }
  await expect(
    page
      .getByTestId("draft-workspace")
      .getByRole("button", { name: /^Live · Your decision/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId("draft-status").first()).toContainText(
    "The live game is waiting for you",
  );
  await expect(zoom).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .getByTestId("draft-workspace")
      .locator(".workspace-attention")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.getByRole("button", { name: /The live game is waiting for you/ }).click();
  await expect(
    page
      .getByTestId("live-workspace")
      .getByRole("button", { name: /^Live · Your decision/ })
      .first(),
  ).toBeVisible();
  await page
    .getByTestId("live-workspace")
    .getByRole("button", { name: "Draft", exact: true })
    .last()
    .click();
  // Existing drafts can be reset and answered even during their owner's live turn.
  await page.getByRole("button", { name: "Reset draft" }).click();
  await expect(
    page
      .getByTestId("draft-workspace")
      .getByTestId("turn-bar-tactical"),
  ).toBeVisible();
  await expect.poll(() => wires[b].envelopes().at(-1)?.progress.recorded_answers).toBe(0);
  for (const trace of [wires[a], spectatorWire])
    expect(
      trace.incoming.filter((m) => m.type === "planning_update" || m.type === "planning_result"),
    ).toEqual([]);
});

test("socket replacement preserves unsubmitted activation, fleet, and cargo selections on the same draft offer", async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const { gameId, players, pages, wires, b } = await actionGame(browser, request);
  const page = pages[b];
  const trace = wires[b];
  const initial = await gameSnapshot(request, gameId, players[b].session);
  await page.getByRole("button", { name: "Start tactical draft" }).click();
  const draft = page.getByTestId("draft-workspace");
  await choose(draft, "tactical");
  await expect(draft.getByTestId("system-activation-bar")).toBeVisible();
  const activation = trace.envelopes().at(-1)!;
  const publication =
    typeof activation.update === "object" && "SafeOffer" in activation.update
      ? activation.update.SafeOffer
      : null;
  const { origin, target } = targetNear(
    initial,
    players[b].id,
    publication!.choice!.options.map((option) => option.id),
  );

  const reconnect = async (control: Locator) => {
    const offer = trace.envelopes().at(-1)!;
    const count = trace.envelopes().length;
    const answers = trace.outgoing.filter(
      (message) => message.type === "submit_planning_choice",
    ).length;
    trace.hold(false, true);
    await trace.disconnect();
    await expect(control).toBeDisabled();
    await expect(draft.getByTestId("draft-status").first()).toContainText(
      /Connecting|Previous preview/,
    );
    await expect.poll(() => trace.envelopes().length).toBeGreaterThan(count);
    const replacement = trace.envelopes().at(-1)!;
    expect(replacement.identity).toEqual(offer.identity);
    expect(replacement.update).toEqual(offer.update);
    trace.release();
    await expect(control).toBeEnabled();
    expect(
      trace.outgoing.filter((message) => message.type === "submit_planning_choice"),
    ).toHaveLength(answers);
  };

  await draft.getByTestId(`system-hex-${target}`).dispatchEvent("click");
  const confirmActivation = draft.getByTestId("confirm-activation-btn");
  await reconnect(confirmActivation);
  await expect(draft.getByTestId("system-activation-bar")).toContainText(`(#${target})`);
  await confirmActivation.click();
  await expect(draft.getByTestId("tactical-movement-tray")).toBeVisible();
  const carrier = draft
    .locator(`[data-testid^="rally-inc-${origin}-"][data-testid$="carrier"]`)
    .first();
  await carrier.click();
  const cargo = draft.locator(`[data-testid^="rally-inc-cargo-${origin}-"]`).first();
  await cargo.click();
  const carrierCount = draft.getByTestId(
    (await carrier.getAttribute("data-testid"))!.replace("rally-inc-", "rally-count-"),
  );
  const cargoCount = draft.getByTestId(
    (await cargo.getAttribute("data-testid"))!.replace("rally-inc-", "rally-count-"),
  );
  await reconnect(draft.getByTestId("commit-moves-btn"));
  await expect(carrierCount).toHaveText("1");
  await expect(cargoCount).toHaveText("1");
  await expect(draft.getByTestId("commit-moves-btn")).toHaveText("Commit Moves (2)");

  // Move just the carrier to exercise the standalone cargo tray before submitting its loads.
  const movement = trace.envelopes().at(-1)!;
  const movePublication =
    typeof movement.update === "object" && "SafeOffer" in movement.update
      ? movement.update.SafeOffer
      : null;
  const move = movePublication!.choice!.options.find(
    (option) =>
      option.kind === "move" &&
      option.payload?.origin === origin &&
      String(option.payload?.unit).includes("carrier"),
  )!;
  trace.send({
    type: "submit_planning_choice",
    protocol_version: 3,
    game_id: gameId,
    identity: movement.identity,
    option_id: move.id,
  });
  const cargoTray = draft.getByTestId("cargo-loading-tray");
  await expect(cargoTray).toBeVisible();
  await cargoTray
    .getByRole("button", { name: /^Stage / })
    .first()
    .click();
  await reconnect(cargoTray.getByRole("button", { name: "Confirm 1 load" }));
  await expect(cargoTray.getByTestId("cargo-summary")).toContainText("Staged: 1");
  expect((await gameSnapshot(request, gameId, players[b].session)).view.board).toEqual(
    initial.view.board,
  );
});

for (const rejectionOrder of ["before", "after"] as const) {
  test(`another tab's different answer cannot advance the losing movement pipeline (rejection ${rejectionOrder} publication)`, async ({
    browser,
    request,
  }) => {
    test.setTimeout(60_000);
    const { gameId, players, pages, wires, b } = await actionGame(browser, request);
    const initial = await gameSnapshot(request, gameId, players[b].session);
    const { draft, target, carrier } = await beginDraft(pages[b], wires[b], initial, players[b].id);
    const offer = wires[b].envelopes().at(-1)!;
    const choice =
      typeof offer.update === "object" && "SafeOffer" in offer.update
        ? offer.update.SafeOffer.choice!
        : null;
    expect(choice?.context?.subtype).toBe("movement_step");
    const alternative = choice!.options.find(
      (option) => option.kind === "move" && !String(option.payload?.unit).includes("carrier"),
    );
    expect(alternative, "a different ship for the competing answer").toBeDefined();

    const otherTab = await browser.newPage();
    const otherWire = await wire(otherTab);
    await openPlayerGame(otherTab, gameId, players[b].session);
    await otherTab
      .getByTestId("live-workspace")
      .getByRole("button", { name: "Draft", exact: true })
      .first()
      .click();
    await expect(
      otherTab.getByTestId("draft-workspace").getByTestId("tactical-movement-tray"),
    ).toBeVisible();
    await expect.poll(() => otherWire.envelopes().at(-1)?.identity).toEqual(offer.identity);

    // Keep B's displayed offer stale while A answers the same server-held draft.
    wires[b].hold(rejectionOrder === "after", true);
    const winningRequestId = `competing-${rejectionOrder}`;
    otherWire.send({
      type: "submit_planning_choice",
      protocol_version: 3,
      game_id: gameId,
      identity: offer.identity,
      option_id: alternative!.id,
      request_id: winningRequestId,
    });
    await expect
      .poll(() => otherWire.envelopes().at(-1)?.progress.recorded_answers)
      .toBe(offer.progress.recorded_answers + 1);
    await draft.getByTestId("commit-moves-btn").click();
    await expect
      .poll(() => wires[b].outgoing.filter((m) => m.type === "submit_planning_choice").length)
      .toBe(3);
    const losing = wires[b].outgoing.at(-1)! as Extract<
      ClientMessage,
      { type: "submit_planning_choice" }
    >;
    expect(losing.identity).toEqual(offer.identity);
    expect(losing.option_id).not.toBe(alternative!.id);
    expect(losing.request_id).toBeTruthy();
    await expect
      .poll(() =>
        wires[b].incoming.some(
          (m) =>
            m.type === "planning_result" &&
            m.rejection === "retired" &&
            JSON.stringify(m.identity) === JSON.stringify(offer.identity),
        ),
      )
      .toBe(true);
    const recorded = wires[b].envelopes().at(-1)!;
    expect(recorded.recorded_request_ids).toContain(winningRequestId);
    expect(recorded.recorded_request_ids).not.toContain(losing.request_id);

    wires[b].release(false);
    await expect(draft.getByTestId("movement-error-banner")).toContainText(
      "Another connection answered this draft offer. Remaining instructions were paused.",
    );
    // The requested carrier is still available, and the losing pipeline is paused.
    await expect(carrier).toBeVisible();
    wires[b].release();
    await expect(draft.getByTestId("commit-moves-btn")).toBeEnabled();
    expect(wires[b].outgoing.filter((m) => m.type === "submit_planning_choice")).toHaveLength(3);
    const publication =
      typeof recorded.update === "object" && "SafeOffer" in recorded.update
        ? recorded.update.SafeOffer
        : null;
    expect(publication).not.toBeNull();
    expect(
      publication!.position.board.systems[target].units.some(
        (unit) => unit.owner === players[b].id && unit.unit_type.includes("carrier"),
      ),
    ).toBe(false);
    expect((await gameSnapshot(request, gameId, players[b].session)).view.board).toEqual(
      initial.view.board,
    );
  });
}

test("an in-flight draft pipeline reconciles refresh and continues while Live is visible; stale deliveries cannot revive controls", async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const { gameId, players, pages, wires, a, b } = await actionGame(browser, request);
  const initial = await gameSnapshot(request, gameId, players[b].session);
  const { draft } = await beginDraft(pages[b], wires[b], initial, players[b].id);
  const oldOffer = wires[b].envelopes().at(-1)!;
  wires[b].hold();
  await draft.getByTestId("commit-moves-btn").click();
  await expect
    .poll(() => wires[b].outgoing.filter((m) => m.type === "submit_planning_choice").length)
    .toBe(3);
  await draft.getByRole("button", { name: /^Live/ }).last().click();
  await choose(pages[a].getByTestId("live-workspace"), "tactical");
  await expect
    .poll(() => wires[b].envelopes().at(-1)?.identity.checkpoint_id)
    .toBeGreaterThan(oldOffer.identity.checkpoint_id);
  await pages[b]
    .getByTestId("live-workspace")
    .getByRole("button", { name: "Draft", exact: true })
    .first()
    .click();
  await expect(draft.getByTestId("commit-moves-btn")).toBeDisabled();
  await expect(draft.getByTestId("draft-status").last()).toContainText(
    "Previous preview · refreshing",
  );
  await draft.getByRole("button", { name: /^Live/ }).last().click();
  wires[b].release();
  await expect
    .poll(() =>
      wires[b].envelopes().some((e) => typeof e.update === "object" && "Stopped" in e.update),
    )
    .toBe(true);
  await expect(pages[b].getByTestId("live-workspace")).toBeVisible();
  await pages[b]
    .getByTestId("live-workspace")
    .getByRole("button", { name: "Draft", exact: true })
    .first()
    .click();
  await expect(draft.getByTestId("draft-status").first()).toContainText(
    /Tactical action complete|Uncertainty|Unsupported boundary/,
  );
  // Re-deliver a genuinely old server offer/result after the replacement stopped.
  wires[b].deliver({
    type: "planning_update",
    protocol_version: 3,
    game_id: gameId,
    envelope: oldOffer,
  });
  wires[b].deliver({
    type: "planning_result",
    protocol_version: 3,
    game_id: gameId,
    identity: oldOffer.identity,
    rejection: null,
  });
  await expect(draft.getByTestId("commit-moves-btn")).toHaveCount(0);
  const submissions = wires[b].outgoing.filter(
    (m): m is Extract<ClientMessage, { type: "submit_planning_choice" }> =>
      m.type === "submit_planning_choice",
  );
  expect(submissions.filter((m) => m.option_id.startsWith("move|")).length).toBe(1);
  expect(submissions.filter((m) => m.option_id.startsWith("load|")).length).toBe(1);
  const settled = wires[b].envelopes().at(-1)!.progress.recorded_answers;
  wires[b].send({
    type: "submit_planning_choice",
    protocol_version: 3,
    game_id: gameId,
    identity: oldOffer.identity,
    option_id: "done_moving",
  });
  await expect
    .poll(() =>
      wires[b].incoming.some((m) => m.type === "planning_result" && m.rejection === "retired"),
    )
    .toBe(true);
  expect(wires[b].envelopes().at(-1)!.progress.recorded_answers).toBe(settled);
  await expect(draft.getByRole("alert")).toHaveCount(0);
});
