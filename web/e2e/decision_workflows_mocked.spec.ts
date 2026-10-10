import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type InitialSnapshotMsg,
  type LobbyDto,
  type StateUpdateMsg,
  type PlanningEnvelope,
} from "../src/protocol/types";
import type { BasketPlan, MovementStep } from "../src/protocol/client";

const gameId = "mocked-decision";
const seat = "p1";
const session = "mock-session";
const nonce = "movement-7";

// Synthetic protocol-shaped decision: this test proves browser/socket behavior, not engine reachability.
const initial: InitialSnapshotMsg & { type: "initial_snapshot" } = {
  type: "initial_snapshot",
  protocol_version: PROTOCOL_VERSION,
  game_id: gameId,
  game_version: 7,
  viewer: { role: "player", seat },
  state: {},
  galaxy_layout: { version: 1, active_sources: [], placements: [] },
  view: {
    round: 1,
    phase: "action",
    speaker: seat,
    seating_order: [seat, "p2"],
    active_player: seat,
    finished: false,
    players: [],
    board: { systems: {} },
    table: {
      revealed_objectives: [],
      scored_objectives: {},
      unclaimed_strategy_cards: [],
      strategy_card_goods: {},
      laws: {},
    },
  },
  turn_status: {
    kind: "waiting_for_decision",
    seat,
    phase: "action",
    round: 1,
    stage: "movement_step",
  },
  pending_choice: {
    nonce,
    choice: {
      player: seat,
      prompt: "Move ships",
      context: { subtype: "movement_step", target: { System: "42" } },
      options: [{ id: "done_moving", kind: "decline", label: "Finish movement" }],
    },
  },
  events: [],
};

const lobby: LobbyDto = {
  game_id: gameId,
  phase: "running",
  lobby_version: 1,
  host_player_id: seat,
  slots: [seat, "p2"].map((id, index) => ({
    slot_id: `slot-${index + 1}`,
    position: index + 1,
    occupant: id,
    nickname: `Player ${index + 1}`,
    ready: true,
    connected: true,
    can_take_over: false,
  })),
};

const movementSnapshot: typeof initial = {
  ...initial,
  state: { active_system: "42" },
  view: {
    ...initial.view,
    players: [
      {
        id: seat,
        faction: "sol",
        victory_points: 0,
        trade_goods: 0,
        commodities: 0,
        tactic_tokens: 3,
        fleet_tokens: 2,
        strategic_tokens: 2,
        passed: false,
        strategy_cards: [],
        exhausted_strategy_cards: [],
        technologies: [],
        exhausted_technologies: [],
        relics: [],
        exhausted_relics: [],
        action_cards_count: 0,
        secret_objectives_count: 0,
        leaders: {},
      },
    ],
    board: {
      active_system: "42",
      systems: {
        "24": {
          system_id: "24",
          command_tokens: [],
          planets: {},
          units: [
            { owner: seat, unit_type: "carrier", damaged: false },
            ...[false, true].map((galvanized) => ({
              owner: seat,
              unit_type: "infantry",
              planet: "home",
              damaged: false,
              galvanized,
            })),
          ],
        },
        "42": {
          system_id: "42",
          command_tokens: [],
          planets: {},
          units: [
            { owner: seat, unit_type: "cruiser", damaged: false },
            { owner: seat, unit_type: "destroyer", damaged: false },
          ],
        },
      },
    },
  },
  pending_choice: {
    nonce,
    choice: {
      player: seat,
      prompt: "movement",
      // The Rust movement_step offer has a null target; the destination is projected on the board.
      context: { subtype: "movement_step", target: null },
      options: [
        {
          id: "move|24|0",
          kind: "move",
          label: "Carrier",
          payload: { origin: "24", unit: "carrier", damaged: false, capacity: 4 },
        },
        { id: "done_moving", kind: "decline", label: "Finish movement" },
      ],
    },
  },
};

function movementDraft(): PlanningEnvelope {
  return {
    publication_id: 1,
    identity: { checkpoint_id: 7, generation_id: 1, plan_revision: 2 },
    awaiting_answer: true,
    recorded_request_ids: [],
    assumptions: [],
    progress: {
      recorded_answers: 2,
      replayed: 2,
      remaining: 0,
      completed_steps: 2,
      nested_answers_since_checkpoint: 0,
    },
    update: {
      SafeOffer: {
        position: movementSnapshot.view,
        choice: movementSnapshot.pending_choice!.choice,
        events: [],
      },
    },
  };
}

function deliverDraft(socket: WebSocketRoute, envelope: PlanningEnvelope) {
  socket.send(
    JSON.stringify({
      type: "planning_status",
      protocol_version: PROTOCOL_VERSION,
      game_id: gameId,
      checkpoint_id: envelope.identity.checkpoint_id,
      available: true,
      can_start: true,
      has_draft: true,
      identity: envelope.identity,
    }),
  );
  socket.send(
    JSON.stringify({
      type: "planning_update",
      protocol_version: PROTOCOL_VERSION,
      game_id: gameId,
      envelope,
    }),
  );
}

test("draft landings continue through production, payment and placement using only private choices", async ({
  page,
}) => {
  const { socket } = await openMockedGame(page, { ...movementSnapshot, pending_choice: null });
  const position = structuredClone(movementSnapshot.view);
  position.players[0].trade_goods = 5;
  position.board.systems["42"].planets = {
    bereg: { planet_id: "bereg", controlled_by: seat, exhausted: false, attachments: [] },
  };
  position.board.systems["42"].units = [
    { owner: seat, unit_type: "carrier", damaged: false },
    { owner: seat, unit_type: "infantry", damaged: false },
  ];
  position.board.invasion = {
    system_id: "42",
    invasion_seq: 1,
    invader: seat,
    phase: "landing",
    planets: ["bereg"],
    current_planet: null,
    defender: null,
    ground_round: 0,
  };
  const produce = {
    player: seat,
    prompt: "produce in 42",
    context: {
      subtype: "produce_unit",
      target: { System: "42" },
      outstanding: [{ kind: "ProductionCapacity", amount: 4, paid: 0 }],
    },
    options: [
      {
        id: "build|infantry|2",
        kind: "produce",
        label: "Produce infantry",
        payload: {
          unit: "infantry",
          count: 2,
          production_spent: 2,
          cost: 1,
          available_resources: 5,
        },
      },
      { id: "done_producing", kind: "decline", label: "Finish production" },
    ],
  };
  const choices = [
    {
      player: seat,
      prompt: "commit ground forces in 42",
      context: { subtype: "commit_ground_forces", target: { System: "42" }, invasion_seq: 1 },
      options: [
        {
          id: "commit|0|bereg",
          kind: "commit",
          label: "Land infantry on Bereg",
          payload: { unit: "infantry", planet: "bereg", damaged: false },
        },
        { id: "done_committing", kind: "decline", label: "Finish landings" },
      ],
    },
    produce,
    {
      player: seat,
      prompt: "pay 1 more resources",
      context: {
        subtype: "pay_resources",
        target: { System: "42" },
        outstanding: [{ kind: "Resources", amount: 1, paid: 0 }],
      },
      options: [
        {
          id: "trade_good",
          kind: "pay",
          label: "Spend a trade good",
          payload: { worth: 1, owed: 1, kind: "resources" },
        },
      ],
    },
    {
      player: seat,
      prompt: "place the infantry",
      context: { subtype: "place_unit", target: { System: "42" } },
      options: [
        {
          id: "place|bereg",
          kind: "place",
          label: "Place on Bereg",
          payload: { unit: "infantry", count: 2, destination: "bereg", system: "42" },
        },
      ],
    },
    produce,
  ];
  let envelope = movementDraft();
  const messages: ClientMessage[] = [];
  const receipts: string[] = [];
  const offer = (index: number) => {
    const currentPosition = structuredClone(position);
    if (index > 0) currentPosition.board.invasion = null;
    const publication = { position: currentPosition, choice: choices[index] ?? null, events: [] };
    envelope = {
      ...envelope,
      publication_id: index + 1,
      identity: { ...envelope.identity, plan_revision: index + 2 },
      recorded_request_ids: receipts,
      awaiting_answer: index < choices.length,
      progress: { ...envelope.progress, recorded_answers: index + 2 },
      update:
        index < choices.length
          ? { SafeOffer: publication }
          : { Stopped: { reason: "MovementComplete", last_safe_publication: publication } },
    };
    deliverDraft(socket, envelope);
  };
  socket.onMessage((raw) => {
    const message = JSON.parse(String(raw)) as ClientMessage;
    messages.push(message);
    if (message.type !== "submit_planning_choice") return;
    receipts.push(message.request_id!);
    offer(receipts.length);
  });
  offer(0);
  const draft = await showDraft(page);
  await draft.getByRole("button", { name: "Confirm landings" }).click();
  await expect(draft.getByTestId("production-builder-drawer")).toBeVisible();
  await draft.getByTestId("produce-unit-btn-build|infantry|2").click();
  await draft.getByRole("button", { name: "Confirm builds" }).click();
  await expect(draft.getByTestId("payment-drawer")).toBeVisible();
  await draft.getByTestId("tg-increment-btn").click();
  await draft.getByTestId("confirm-payment-btn").click();
  await draft.getByTestId("place-spot-btn-place|bereg").click();
  await draft.getByTestId("done-producing-btn").click();
  await expect(draft.getByTestId("draft-status").first()).toContainText("Tactical action complete");
  expect(
    messages.filter((m) => m.type === "submit_planning_choice").map((m) => m.option_id),
  ).toEqual(["commit|0|bereg", "build|infantry|2", "trade_good", "place|bereg", "done_producing"]);
  expect(messages.some((m) => m.type === "submit_choice")).toBe(false);
});

test("a draft shows the planner's own ability question and records the answer privately", async ({
  page,
}) => {
  const { socket } = await openMockedGame(page, { ...initial, pending_choice: null });
  const envelope = movementDraft();
  const ability = "technology:sol:sdn:SYSTEM_ACTIVATED:after";
  Object.assign(envelope, {
    update: {
      SafeOffer: {
        position: movementSnapshot.view,
        events: [],
        choice: {
          ...movementSnapshot.pending_choice!.choice,
          prompt: "after SYSTEM_ACTIVATED",
          context: {
            ...movementSnapshot.pending_choice!.choice.context!,
            source: { Reaction: "SYSTEM_ACTIVATED" },
            subtype: "reaction_after_SYSTEM_ACTIVATED",
            optional: true,
          },
          options: [
            { id: ability, kind: "ability", label: "Scanlink Drone Network" },
            { id: "decline", kind: "decline", label: "Decline" },
          ],
        },
      },
    },
  });
  const messages: ClientMessage[] = [];
  socket.onMessage((raw) => messages.push(JSON.parse(String(raw)) as ClientMessage));
  deliverDraft(socket, envelope);
  const draft = await showDraft(page);
  await expect(draft).toContainText("Scanlink Drone Network");
  // The ordinary reaction prompt, with its way out.
  await expect(draft.getByRole("button", { name: /^Pass/ })).toBeVisible();
  await draft.getByRole("button", { name: "Use Scanlink Drone Network" }).click();
  await expect
    .poll(() => messages.filter((m) => m.type === "submit_planning_choice").map((m) => m.option_id))
    .toEqual([ability]);
  expect(messages.some((m) => m.type === "submit_choice")).toBe(false);
});

function recordedMove(payload: Record<string, unknown>, option_id = "old-move") {
  return {
    player: seat,
    prompt: "movement",
    context: { subtype: "movement_step" },
    option_id,
    kind: "move",
    payload,
  };
}

test("a shorter editor replacement stops the losing pipeline across a checkpoint refresh", async ({
  page,
}) => {
  const { socket } = await openMockedGame(page, { ...initial, pending_choice: null });
  const envelope = movementDraft();
  envelope.progress.recorded_answers = 6;
  deliverDraft(socket, envelope);
  const draft = await showDraft(page);
  const submissions: ClientMessage[] = [];
  socket.onMessage((raw) => {
    const message = JSON.parse(String(raw)) as ClientMessage;
    if (message.type !== "submit_planning_choice") return;
    submissions.push(message);
    if (submissions.length === 1)
      deliverDraft(socket, {
        ...envelope,
        publication_id: 2,
        identity: { checkpoint_id: 8, generation_id: 2, plan_revision: 7 },
        progress: { ...envelope.progress, recorded_answers: 3 },
        recorded_request_ids: ["other-tab-winner"],
      });
  });
  await draft.getByTestId("rally-inc-24-carrier").click();
  await draft.getByTestId("commit-moves-btn").click();
  await expect(draft.getByTestId("movement-error-banner")).toContainText(
    "Another connection answered",
  );
  expect(submissions).toHaveLength(1);
});

test("reopened Gravity Drive then Ionian movement executes sequential offers", async ({ page }) => {
  const { socket } = await openMockedGame(page, { ...initial, pending_choice: null });
  const envelope = movementDraft();
  const position = structuredClone(movementSnapshot.view);
  position.board.systems["24"].units = [false, false].map((damaged) => ({
    owner: seat,
    unit_type: "carrier",
    damaged,
  }));
  position.board.systems["42"].units = [];
  position.players[0].fleet_tokens = 4;
  position.players[0].technologies = ["gravity_drive", "ionian"];
  const gravity = {
    origin: "24",
    unit: "carrier",
    damaged: false,
    capacity: 4,
    gravity_drive: true,
    ionian: false,
  };
  const ionian = { ...gravity, gravity_drive: false, ionian: true };
  const choice = {
    ...movementSnapshot.pending_choice!.choice,
    options: [
      { id: "gravity", kind: "move", label: "Carrier", payload: gravity },
      { id: "done_moving", kind: "decline", label: "Finish" },
    ],
  };
  Object.assign(envelope, {
    editing_movement: true,
    movement_edit_revision: 1,
    recorded_decisions: [recordedMove(gravity), recordedMove(ionian)],
    update: { SafeOffer: { position, choice, events: [] } },
  });
  deliverDraft(socket, envelope);
  const draft = await showDraft(page);
  const submissions: string[] = [];
  socket.onMessage((raw) => {
    const message = JSON.parse(String(raw)) as ClientMessage;
    if (message.type !== "submit_planning_choice") return;
    submissions.push(message.option_id);
    if (submissions.length > 2) return;
    deliverDraft(socket, {
      ...envelope,
      publication_id: submissions.length + 1,
      identity: { ...envelope.identity, plan_revision: 3 + submissions.length },
      recorded_request_ids: [message.request_id!],
      editing_movement: false,
      update: {
        SafeOffer: {
          position,
          events: [],
          choice: {
            ...choice,
            options:
              submissions.length === 1
                ? [
                    { id: "ionian", kind: "move", label: "Carrier", payload: ionian },
                    choice.options[1],
                  ]
                : [choice.options[1]],
          },
        },
      },
    });
  });
  await expect(draft.getByTestId("commit-moves-btn")).toBeEnabled();
  await draft.getByTestId("rally-dec-24-carrier-gravity-drive").click();
  await expect(draft.getByTestId("commit-moves-btn")).toBeDisabled();
  await draft.getByTestId("rally-inc-24-carrier-gravity-drive").click();
  await expect(draft.getByTestId("commit-moves-btn")).toBeEnabled();
  await draft.getByTestId("commit-moves-btn").click();
  await expect.poll(() => submissions).toEqual(["gravity", "ionian", "done_moving"]);
});

test("reopened en-route planet cargo retains its pickup system and can be recommitted", async ({
  page,
}) => {
  const { socket } = await openMockedGame(page, { ...initial, pending_choice: null });
  const envelope = movementDraft();
  const position = structuredClone(movementSnapshot.view);
  position.board.systems["24"].units = [{ owner: seat, unit_type: "carrier", damaged: false }];
  position.board.systems["42"].units = [];
  position.board.systems["25"] = {
    system_id: "25",
    command_tokens: [],
    planets: {},
    units: [
      {
        owner: seat,
        unit_type: "infantry",
        planet: "route-planet",
        damaged: false,
        galvanized: false,
      },
    ],
  };
  Object.assign(envelope, {
    editing_movement: true,
    movement_edit_revision: 1,
    recorded_decisions: [
      recordedMove(movementSnapshot.pending_choice!.choice.options[0].payload!),
      {
        player: seat,
        prompt: "load",
        context: { subtype: "load_cargo" },
        option_id: "load|1",
        kind: "load",
        payload: {
          system: "24",
          pickup_system: "25",
          unit: "infantry",
          source: "route-planet",
          damaged: false,
          galvanized: false,
        },
      },
    ],
    update: {
      SafeOffer: { position, choice: movementSnapshot.pending_choice!.choice, events: [] },
    },
  });
  deliverDraft(socket, envelope);
  const draft = await showDraft(page);
  await expect(draft.getByTestId("rally-count-cargo-25-infantry-route-planet")).toHaveText("1");
  await expect(draft.getByTestId("commit-moves-btn")).toBeEnabled();
  const submissions: string[] = [];
  socket.onMessage((raw) => {
    const message = JSON.parse(String(raw)) as ClientMessage;
    if (message.type !== "submit_planning_choice") return;
    submissions.push(message.option_id);
    if (submissions.length !== 1) return;
    deliverDraft(socket, {
      ...envelope,
      publication_id: 2,
      identity: { ...envelope.identity, plan_revision: 3 },
      recorded_request_ids: [message.request_id!],
      editing_movement: false,
      update: {
        SafeOffer: {
          position,
          events: [],
          choice: {
            player: seat,
            prompt: "load",
            context: { subtype: "load_cargo" },
            options: [
              {
                id: "load-route",
                kind: "load",
                label: "Load infantry",
                payload: {
                  system: "24",
                  pickup_system: "25",
                  unit: "infantry",
                  source: "route-planet",
                  damaged: false,
                  galvanized: false,
                },
              },
              { id: "done_loading", kind: "decline", label: "Done" },
            ],
          },
        },
      },
    });
  });
  await draft.getByTestId("commit-moves-btn").click();
  await expect.poll(() => submissions).toEqual(["move|24|0", "load-route"]);
});

test("carrier-first staging cannot double-book one fighter as cargo and independent movement", async ({
  page,
}) => {
  const { socket } = await openMockedGame(page, { ...initial, pending_choice: null });
  const envelope = movementDraft();
  const position = structuredClone(movementSnapshot.view);
  position.board.systems["24"].units = ["carrier", "fighter"].map((unit_type) => ({
    owner: seat,
    unit_type,
    damaged: false,
  }));
  position.board.systems["42"].units = [];
  const choice = structuredClone(movementSnapshot.pending_choice!.choice);
  choice.options.splice(1, 0, {
    id: "move-fighter",
    kind: "move",
    label: "Fighter",
    payload: { origin: "24", unit: "fighter", damaged: false, capacity: 0 },
  });
  envelope.update = { SafeOffer: { position, choice, events: [] } };
  deliverDraft(socket, envelope);
  const draft = await showDraft(page);
  const submissions: ClientMessage[] = [];
  socket.onMessage((raw) => submissions.push(JSON.parse(String(raw))));
  await draft.getByTestId("rally-inc-24-carrier").click();
  await draft.getByTestId("rally-inc-24-fighter").click();
  await draft.getByTestId("rally-inc-cargo-24-fighter-space").click();
  await expect(draft.getByTestId("commit-moves-btn")).toBeDisabled();
  expect(submissions.filter((m) => m.type === "submit_planning_choice")).toHaveLength(0);
  await draft.getByTestId("rally-dec-24-fighter").click();
  await expect(draft.getByTestId("commit-moves-btn")).toBeEnabled();
});

async function showDraft(page: Page) {
  await page
    .getByTestId("live-workspace")
    .getByRole("button", { name: "Draft", exact: true })
    .first()
    .click();
  return page.getByTestId("draft-workspace");
}

async function openMockedGame(page: Page, snapshot = initial) {
  // Register both routes before navigation: the HTTP load and socket subscribe can race.
  await page.route(`**/api/games/${gameId}/lobby/join`, (route) =>
    route.fulfill({
      json: {
        player_session: session,
        player: { id: seat },
        lobby,
      },
    }),
  );
  await page.route(`**/api/games/${gameId}/lobby/heartbeat`, (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route(`**/api/games/${gameId}/snapshot`, (route) => route.fulfill({ json: snapshot }));

  let connected!: (connection: { socket: WebSocketRoute; subscribe: ClientMessage }) => void;
  const socketReady = new Promise<{ socket: WebSocketRoute; subscribe: ClientMessage }>(
    (resolve) => {
      connected = resolve;
    },
  );
  await page.routeWebSocket(`**/ws/games/${gameId}`, (socket) => {
    socket.onMessage((data) => {
      const message = JSON.parse(String(data)) as ClientMessage;
      if (message.type === "subscribe") {
        socket.send(JSON.stringify(snapshot));
        connected({ socket, subscribe: message });
      }
    });
  });
  await page.goto("/");
  await page.evaluate(
    ([id, credential]) => sessionStorage.setItem(`ti4.player-session:${id}`, credential),
    [gameId, session],
  );
  await page.goto(`/games/${gameId}`);
  return socketReady;
}

type BatchRequest = {
  request_id: string;
  expected_version: number;
  nonce: string;
  plan: BasketPlan | { kind: "tactical_movement"; destination: string; steps: MovementStep[] };
};

test("draft fleet supply includes destination ships with the Rust null-target movement offer", async ({
  page,
}) => {
  const { socket } = await openMockedGame(page, { ...initial, pending_choice: null });
  deliverDraft(socket, movementDraft());
  const draft = await showDraft(page);
  await draft.getByTestId("rally-inc-24-carrier").click();
  await expect(draft.getByTestId("fleet-supply-gauge")).toContainText("3 / 2 Ships");
  await expect(draft.getByTestId("fleet-supply-gauge")).toHaveAttribute("data-warning", "true");
  await expect(draft.getByTestId("tactical-movement-tray")).toContainText("Destination: system 42");
});

test("a refreshed null-target movement offer cannot redirect a committed draft pipeline", async ({
  page,
}) => {
  const { socket } = await openMockedGame(page, { ...initial, pending_choice: null });
  const envelope = movementDraft();
  deliverDraft(socket, envelope);
  const draft = await showDraft(page);
  const submissions: ClientMessage[] = [];
  socket.onMessage((raw) => {
    const message = JSON.parse(String(raw)) as ClientMessage;
    if (message.type !== "submit_planning_choice") return;
    submissions.push(message);
    if (submissions.length !== 1) return;
    deliverDraft(socket, {
      ...envelope,
      identity: { ...envelope.identity, checkpoint_id: 8, generation_id: 2, plan_revision: 3 },
      update: {
        SafeOffer: {
          position: {
            ...movementSnapshot.view,
            board: { ...movementSnapshot.view.board, active_system: "43" },
          },
          choice: movementSnapshot.pending_choice!.choice,
          events: [],
        },
      },
    });
  });
  await draft.getByTestId("rally-inc-24-carrier").click();
  await draft.getByTestId("commit-moves-btn").click();
  await expect(draft.getByTestId("movement-error-banner")).toContainText(
    "The movement destination changed",
  );
  await expect(draft.getByTestId("movement-progress")).toHaveCount(0);
  expect(submissions).toHaveLength(1);
});

for (const galvanized of [false, true]) {
  test(`Live movement batches preserve explicitly selected ${galvanized ? "galvanized" : "normal"} cargo`, async ({
    page,
  }) => {
    const batches = await mockBatchSubmission(page, movementSnapshot);
    await openMockedGame(page, movementSnapshot);
    await page.getByTestId("rally-inc-24-carrier").click();
    await page
      .getByTestId(`rally-inc-cargo-24-infantry-home${galvanized ? "-galvanized" : ""}`)
      .click();
    await page.getByTestId("commit-moves-btn").click();
    await expect.poll(() => batches.length).toBe(1);
    expect(batches[0].plan).toEqual({
      kind: "tactical_movement",
      destination: "42",
      steps: [
        { kind: "move", origin: "24", unit: "carrier", damaged: false },
        {
          kind: "load",
          origin: "24",
          unit: "infantry",
          source: "home",
          damaged: false,
          galvanized,
        },
        { kind: "done_loading" },
        { kind: "done_moving" },
      ],
    });
  });
}

for (const transition of ["submission", "refresh", "disconnect"] as const) {
  test(`generic draft modal keeps workspace navigation enabled during ${transition}`, async ({
    page,
  }) => {
    const { socket } = await openMockedGame(page, { ...initial, pending_choice: null });
    const envelope = movementDraft();
    const menu = {
      player: seat,
      prompt: "Choose an action",
      context: { subtype: "action_menu" },
      options: [{ id: "tactical", kind: "tactical", label: "Tactical action" }],
    };
    deliverDraft(socket, {
      ...envelope,
      update: { SafeOffer: { position: initial.view, choice: menu, events: [] } },
    });
    const draft = await showDraft(page);
    const dialog = draft.getByTestId("pending-choice-dialog");
    await expect(dialog).toBeVisible();
    if (transition === "submission") await dialog.getByTestId("submit-choice-button").click();
    else if (transition === "refresh")
      deliverDraft(socket, {
        ...envelope,
        identity: { ...envelope.identity, checkpoint_id: 8, generation_id: 2 },
        awaiting_answer: false,
        update: "Preparing",
      });
    else await socket.close({ code: 1012, reason: "Disconnected modal regression" });
    await expect(dialog.getByTestId("submit-choice-button")).toBeDisabled();
    await expect(dialog.getByRole("radio")).toBeDisabled();
    const live = dialog.getByRole("button", { name: /^Live/ });
    await expect(live).toBeEnabled();
    await live.click();
    await expect(page.getByTestId("live-workspace")).toBeVisible();
    await page
      .getByTestId("live-workspace")
      .getByRole("button", { name: "Draft", exact: true })
      .first()
      .click();
    await expect(dialog).toBeVisible();
  });
}

for (const scenario of ["normal", "galvanized", "ambiguous", "unknown-attributes"] as const) {
  test(`draft cargo execution handles ${scenario} cargo without selecting the first option`, async ({
    page,
  }) => {
    const snapshot: typeof initial = {
      ...initial,
      view: { ...initial.view, active_player: "p2" },
      pending_choice: null,
    };
    const { socket } = await openMockedGame(page, snapshot);
    const position = {
      ...snapshot.view,
      board: {
        systems: {
          "24": {
            system_id: "24",
            command_tokens: [],
            planets: {},
            units: [
              { owner: seat, unit_type: "carrier", damaged: false },
              ...[false, true].map((galvanized) => ({
                owner: seat,
                unit_type: "infantry",
                planet: "home",
                damaged: false,
                ...(scenario === "unknown-attributes" ? {} : { galvanized }),
              })),
            ],
          },
        },
      },
    };
    let envelope: PlanningEnvelope = {
      publication_id: 1,
      identity: { checkpoint_id: 7, generation_id: 1, plan_revision: 0 },
      awaiting_answer: true,
      recorded_request_ids: [],
      assumptions: [],
      progress: {
        recorded_answers: 0,
        replayed: 0,
        remaining: 0,
        completed_steps: 0,
        nested_answers_since_checkpoint: 0,
      },
      update: {
        SafeOffer: {
          position,
          events: [],
          choice: {
            player: seat,
            prompt: "movement",
            context: { subtype: "movement_step", target: { System: "42" } },
            options: [
              {
                id: "move-carrier",
                kind: "move",
                label: "Carrier",
                payload: { origin: "24", unit: "carrier", capacity: 4 },
              },
              { id: "done_moving", kind: "decline", label: "Finish movement" },
            ],
          },
        },
      },
    };
    const deliver = () =>
      socket.send(
        JSON.stringify({
          type: "planning_update",
          protocol_version: PROTOCOL_VERSION,
          game_id: gameId,
          envelope,
        }),
      );
    const submissions: Extract<ClientMessage, { type: "submit_planning_choice" }>[] = [];
    socket.onMessage((data) => {
      const message = JSON.parse(String(data)) as ClientMessage;
      if (message.type !== "submit_planning_choice") return;
      submissions.push(message);
      if (message.option_id !== "move-carrier") return;
      envelope = {
        ...envelope,
        publication_id: 2,
        identity: { ...envelope.identity, plan_revision: 1 },
        recorded_request_ids: [message.request_id!],
        progress: { ...envelope.progress, recorded_answers: 1 },
        update: {
          SafeOffer: {
            position,
            events: [],
            choice: {
              player: seat,
              prompt: "Load cargo",
              context: { subtype: "load_cargo" },
              // Galvanized is deliberately first: option order must not determine the load.
              options: [
                ...[true, false].map((galvanized) => ({
                  id: galvanized ? "load-galvanized" : "load-normal",
                  kind: "load",
                  label: "Load infantry",
                  payload: { unit: "infantry", source: "home", damaged: false, galvanized },
                })),
                ...(scenario === "ambiguous"
                  ? [
                      {
                        id: "load-normal-duplicate",
                        kind: "load",
                        label: "Load infantry",
                        payload: {
                          unit: "infantry",
                          source: "home",
                          damaged: false,
                          galvanized: false,
                        },
                      },
                    ]
                  : []),
                { id: "done_loading", kind: "decline", label: "Done loading" },
              ],
            },
          },
        },
      };
      deliver();
      socket.send(
        JSON.stringify({
          type: "planning_result",
          protocol_version: PROTOCOL_VERSION,
          game_id: gameId,
          identity: message.identity,
          request_id: message.request_id,
          rejection: null,
        }),
      );
    });
    socket.send(
      JSON.stringify({
        type: "planning_status",
        protocol_version: PROTOCOL_VERSION,
        game_id: gameId,
        checkpoint_id: 7,
        available: true,
        can_start: true,
        has_draft: true,
        identity: envelope.identity,
      }),
    );
    deliver();
    await page
      .getByTestId("live-workspace")
      .getByRole("button", { name: "Draft", exact: true })
      .first()
      .click();
    const draft = page.getByTestId("draft-workspace");
    await draft.getByTestId("rally-inc-24-carrier").click();
    const cargo = draft.locator('[data-testid^="rally-inc-cargo-24-infantry-home"]');
    if (scenario !== "unknown-attributes") {
      await expect(cargo).toHaveCount(2);
      await expect(draft.getByTestId("rally-row-cargo-24-infantry-home-galvanized")).toContainText(
        "Galvanized",
      );
    }
    await (scenario === "galvanized" ? cargo.last() : cargo.first()).click();
    await draft.getByTestId("commit-moves-btn").click();
    if (scenario === "ambiguous" || scenario === "unknown-attributes") {
      await expect(draft.getByTestId("movement-error-banner")).toContainText(/ambiguous.*paused/i);
      await expect(draft.getByTestId("movement-progress")).toHaveCount(0);
      expect(submissions.map((message) => message.option_id)).toEqual(["move-carrier"]);
    } else {
      await expect
        .poll(() => submissions.map((message) => message.option_id))
        .toEqual(["move-carrier", `load-${scenario}`]);
    }
  });
}

async function mockBatchSubmission(page: Page, snapshot: typeof initial) {
  const requests: BatchRequest[] = [];
  await page.route(`**/api/games/${gameId}/batches`, (route) => {
    const body = route.request().postDataJSON() as BatchRequest;
    requests.push(body);
    return route.fulfill({
      json: {
        request_id: body.request_id,
        batch_id: "batch-1",
        start_cursor: 0,
        end_cursor: body.plan.steps.length,
        active: true,
        snapshot: {
          ...snapshot,
          game_version: snapshot.game_version + body.plan.steps.length,
          pending_choice: null,
          turn_status: { kind: "active_turn", player: seat, phase: "action", round: 1 },
        },
      },
    });
  });
  return requests;
}

test("activation on the map shows confirmation bar and inspector without generic modal", async ({
  page,
}) => {
  const activation: typeof initial = {
    ...initial,
    view: {
      ...initial.view,
      board: {
        systems: {},
        map_tiles: [
          { system_id: "18", label: "Mecatol Rex", q: 0, r: 0 },
          { system_id: "34", label: "Abyz", q: 1, r: 0 },
        ],
      },
    },
    pending_choice: {
      nonce: "activate-7",
      choice: {
        player: seat,
        prompt: "Activate a system",
        context: { subtype: "activate_system" },
        options: [{ id: "activate|18", kind: "activate", label: "18", payload: { system: "18" } }],
      },
    },
  };
  const { socket } = await openMockedGame(page, activation);
  const submissions: ClientMessage[] = [];
  socket.onMessage((data) => {
    const message = JSON.parse(String(data)) as ClientMessage;
    if (message.type === "submit_choice") submissions.push(message);
  });
  await expect(page.getByTestId("pending-choice-dialog")).toHaveCount(0);
  await expect(page.getByTestId("system-activation-bar")).toBeVisible();
  await page.getByTestId("system-hex-18").click();
  await expect(page.getByTestId("system-inspector")).toBeVisible();
  await page.getByTestId("event-log-toggle").click();
  const inspector = await page.getByTestId("system-inspector").boundingBox();
  const eventLog = await page.locator("#event-log-drawer").boundingBox();
  expect(inspector).not.toBeNull();
  expect(eventLog).not.toBeNull();
  expect(inspector!.y + inspector!.height).toBeLessThanOrEqual(eventLog!.y);
  await page.getByTestId("close-inspector-button").click();
  await expect(page.getByTestId("system-inspector")).toHaveCount(0);
  await page.getByTestId("confirm-activation-btn").click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ option_id: "activate|18", nonce: "activate-7" });
});

test("production builder accepts a real pointer click on a unit", async ({ page }) => {
  const production: typeof initial = {
    ...initial,
    pending_choice: {
      nonce: "produce-7",
      choice: {
        player: seat,
        prompt: "produce in 18 (3 left)",
        context: {
          subtype: "produce_unit",
          target: { System: "18" },
          outstanding: [{ kind: "production_capacity", amount: 3, paid: 0 }],
        },
        options: [
          {
            id: "build|carrier|1",
            kind: "produce",
            label: "produce 1x carrier for 3",
            payload: { unit: "carrier", count: 1, cost: 3, available_resources: 5 },
          },
          { id: "done_producing", kind: "decline", label: "produce nothing further" },
        ],
      },
    },
  };
  const batches = await mockBatchSubmission(page, production);
  const { socket } = await openMockedGame(page, production);
  const submissions: ClientMessage[] = [];
  socket.onMessage((data) => {
    const message = JSON.parse(String(data)) as ClientMessage;
    if (message.type === "submit_choice") submissions.push(message);
  });
  await expect(page.getByTestId("production-builder-drawer")).toBeVisible();
  await expect(page.getByTestId("production-resources-counter")).toHaveText(
    "0 / 5 Resources (5 Left)",
  );
  await expect(page.getByText("1x carrier for 3")).toBeVisible();
  await expect(page.getByText("produce 1x carrier for 3")).toHaveCount(0);
  await page.getByTestId("produce-unit-btn-build|carrier|1").click({ timeout: 3_000 });
  await expect(page.getByTestId("produce-count-build|carrier|1")).toHaveText("1");
  await expect(page.getByTestId("production-capacity-counter")).toHaveText("1 / 3 Units (2 Left)");
  await expect(page.getByTestId("production-resources-counter")).toHaveText(
    "3 / 5 Resources (2 Left)",
  );
  await expect(page.getByTestId("produce-unit-btn-build|carrier|1")).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await page.getByRole("button", { name: "Confirm builds" }).click();
  await expect.poll(() => batches.length).toBe(1);
  expect(batches[0]).toMatchObject({
    expected_version: 7,
    nonce: "produce-7",
    plan: {
      kind: "production",
      destination: "18",
      steps: [{ kind: "produce", unit: "carrier", count: 1 }],
    },
  });
  expect(batches[0].request_id).toBeTruthy();
  expect(submissions).toHaveLength(0);
});

test("production unit grid fits within the modal and reset clears only the draft", async ({
  page,
}) => {
  const production: typeof initial = {
    ...initial,
    pending_choice: {
      nonce: "produce-scroll",
      choice: {
        player: seat,
        prompt: "produce in 18",
        context: {
          subtype: "produce_unit",
          target: { System: "18" },
          outstanding: [{ kind: "production_capacity", amount: 5, paid: 0 }],
        },
        options: [
          ...Array.from({ length: 18 }, (_, i) => ({
            id: `build|unit${i}|1`,
            kind: "produce",
            label: `Unit ${i}`,
            payload: { unit: `unit${i}`, production_spent: 1, cost: 1, available_resources: 12 },
          })),
          { id: "done_producing", kind: "decline", label: "Done" },
        ],
      },
    },
  };
  const { socket } = await openMockedGame(page, production);
  const submissions: ClientMessage[] = [];
  socket.onMessage((data) => {
    const message = JSON.parse(String(data)) as ClientMessage;
    if (message.type === "submit_choice") submissions.push(message);
  });
  const drawer = page.getByTestId("production-builder-drawer");
  const list = page.getByTestId("production-options-grid");
  await expect(drawer).toBeVisible();
  expect((await drawer.boundingBox())!.height).toBeLessThanOrEqual(720);
  expect(await list.locator(".production-drawer__unit").count()).toBe(18);
  await page.getByTestId("produce-unit-btn-build|unit17|1").click();
  await expect(page.getByTestId("produce-count-build|unit17|1")).toHaveText("1");
  await page.getByRole("button", { name: "Reset selection" }).click();
  await expect(page.getByTestId("produce-count-build|unit17|1")).toHaveText("0");
  expect(submissions).toHaveLength(0);
});

test("resource payment accepts real pointer clicks, retains draft on minimize, and submits an offered ID", async ({
  page,
}) => {
  const payment: typeof initial = {
    ...initial,
    pending_choice: {
      nonce: "pay-7",
      choice: {
        player: seat,
        prompt: "Pay 4 resources",
        context: {
          subtype: "pay_resources",
          outstanding: [{ kind: "resources", amount: 4, paid: 0 }],
        },
        options: [
          {
            id: "exhaust|jord",
            kind: "pay",
            label: "Exhaust Jord",
            payload: { worth: 4, planet_name: "Jord" },
          },
          { id: "trade_good", kind: "pay", label: "Spend a trade good", payload: { worth: 1 } },
        ],
      },
    },
  };
  const batches = await mockBatchSubmission(page, payment);
  const { socket } = await openMockedGame(page, payment);
  const submissions: ClientMessage[] = [];
  socket.onMessage((data) => {
    const message = JSON.parse(String(data)) as ClientMessage;
    if (message.type === "submit_choice") submissions.push(message);
  });
  await expect(page.getByTestId("decision-modal")).toBeVisible();
  await page.getByTestId("planet-card-exhaust|jord").click();
  await expect(page.getByTestId("committed-amount")).toHaveText("4 Resources");
  await page.getByRole("button", { name: "Minimize decision" }).click();
  await expect(page.getByTestId("resume-decision-btn")).toBeVisible();
  await page.getByTestId("resume-decision-btn").click();
  await expect(page.getByTestId("committed-amount")).toHaveText("4 Resources");
  await page.getByTestId("confirm-payment-btn").click();
  await expect.poll(() => batches.length).toBe(1);
  expect(batches[0]).toMatchObject({
    expected_version: 7,
    nonce: "pay-7",
    plan: { kind: "payment", steps: [{ kind: "exhaust", planet: "jord" }] },
  });
  expect(batches[0].request_id).toBeTruthy();
  expect(submissions).toHaveLength(0);
});

test("payment controls remain reachable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const payment: typeof initial = {
    ...initial,
    pending_choice: {
      nonce: "mobile-pay",
      choice: {
        player: seat,
        prompt: "Pay 1 resource",
        context: {
          subtype: "pay_resources",
          outstanding: [{ kind: "resources", amount: 1, paid: 0 }],
        },
        options: [
          { id: "trade_good", kind: "pay", label: "Spend a trade good", payload: { worth: 1 } },
        ],
      },
    },
  };
  await openMockedGame(page, payment);
  const dialog = page.getByTestId("decision-modal");
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBe(390);
  await page.getByTestId("tg-increment-btn").click();
  await expect(page.getByTestId("confirm-payment-btn")).toBeEnabled();
});

test("rejected movement submission stays actionable and retries with a fresh server nonce", async ({
  page,
}) => {
  const { socket, subscribe } = await openMockedGame(page);
  expect(subscribe).toEqual({
    type: "subscribe",
    protocol_version: PROTOCOL_VERSION,
    game_id: gameId,
    player_session: session,
  });
  const submissions: Extract<ClientMessage, { type: "submit_choice" }>[] = [];
  const sent = () => submissions.length;
  socket.onMessage((data) => {
    const message = JSON.parse(String(data)) as ClientMessage;
    if (message.type === "submit_choice") submissions.push(message);
  });

  const tray = page.getByTestId("tactical-movement-tray");
  const finish = page.getByTestId("commit-moves-btn");
  await expect(tray).toBeVisible();
  await expect(page.getByText("No ships eligible to move into the active system.")).toBeVisible();
  await expect(finish).toBeEnabled();
  await finish.focus();
  await expect(finish).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(sent, { timeout: 5_000 }).toBe(1);
  expect(submissions[0]).toEqual({
    type: "submit_choice",
    protocol_version: PROTOCOL_VERSION,
    game_id: gameId,
    option_id: "done_moving",
    nonce,
    expected_version: 7,
  });

  socket.send(
    JSON.stringify({
      type: "action_rejected",
      protocol_version: PROTOCOL_VERSION,
      game_id: gameId,
      game_version: 7,
      reason: { reason: "stale_nonce" },
    }),
  );
  await expect(tray.getByRole("alert")).toContainText("Stale decision nonce");
  await expect(finish).toBeEnabled();
  await expect(page.getByTestId("game-version")).toHaveText("v7");

  const fresh: StateUpdateMsg & { type: "state_update" } = {
    ...initial,
    type: "state_update",
    game_version: 8,
    pending_choice: { ...initial.pending_choice!, nonce: "movement-8" },
  };
  socket.send(JSON.stringify(fresh));
  socket.send(
    JSON.stringify({
      type: "pending_choice",
      protocol_version: PROTOCOL_VERSION,
      game_id: gameId,
      game_version: 8,
      nonce: "movement-8",
      choice: fresh.pending_choice!.choice,
      state: fresh.state,
      galaxy_layout: fresh.galaxy_layout,
    }),
  );
  await expect(page.getByTestId("game-version")).toHaveText("v8");
  await expect(finish).toBeEnabled();
  await finish.click(); // Real pointer hit target, after the refusal and authoritative refresh.
  await expect.poll(sent, { timeout: 5_000 }).toBe(2);
  expect(submissions[1]).toEqual({
    type: "submit_choice",
    protocol_version: PROTOCOL_VERSION,
    game_id: gameId,
    option_id: "done_moving",
    nonce: "movement-8",
    expected_version: 8,
  });

  socket.send(
    JSON.stringify({
      type: "action_accepted",
      protocol_version: PROTOCOL_VERSION,
      game_id: gameId,
      game_version: 8,
      option_id: "done_moving",
    }),
  );
  await expect(tray).toBeVisible(); // An acknowledgement alone cannot finish the workflow.
  await expect(finish).toBeDisabled();
  await expect(page.getByTestId("game-version")).toHaveText("v8");
  const next: StateUpdateMsg & { type: "state_update" } = {
    ...fresh,
    game_version: 9,
    pending_choice: null,
    turn_status: { kind: "active_turn", player: seat, phase: "action", round: 1 },
  };
  socket.send(JSON.stringify(next));
  await expect(page.getByTestId("game-version")).toHaveText("v9");
  await expect(tray).toHaveCount(0);
});
