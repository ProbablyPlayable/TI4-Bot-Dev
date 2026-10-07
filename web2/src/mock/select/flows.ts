// Actions that are not tactical: the same panel frame with other steps.
import type {
  BlockView,
  FlowActionView,
  FooterView,
  PaymentView,
  PillView,
  RowView,
  StepTabView,
} from "../../model";
import { plural } from "../../model";
import { PAY, SEATS } from "../data";
import { E } from "../loose";
import type { State, World } from "../world";
import { button } from "./shared";

function leadershipEditor(state: State): BlockView[] {
  const own = state.flow.mine;
  const free: number = E.flowFree(state);
  const total = free + own.buy;
  const placed = own.pools.t + own.pools.f + own.pools.s;
  const paid: number = E.flowPaid(state);
  const pools: RowView[] = (
    [
      ["t", "Tactic pool", 0],
      ["f", "Fleet pool", 1],
      ["s", "Strategy pool", 2],
    ] as const
  ).map(([key, name, index]) => ({
    icon: "token",
    title: [name],
    subtitle: `${SEATS.sol.tokens[index]} now${own.pools[key] ? ` → ${SEATS.sol.tokens[index] + own.pools[key]}` : ""}`,
    control: {
      kind: "counter",
      counter: {
        id: `pools.${key}`,
        value: own.pools[key],
        max: own.pools[key] + Math.max(0, total - placed),
        label: name.toLowerCase() + " token",
      },
    },
  }));
  const payment: PaymentView = {
    title: "Payment",
    cost: own.buy * 3,
    paid,
    unit: "influence",
    summary: "",
    choices: PAY.map((source) => ({
      id: source.id,
      label: source.label,
      system: source.system ?? null,
      aside: `${plural(source.inf ?? source.res, "influence", "influence")}${source.system ? ` · gives up ${plural(source.res, "resource")}` : ""}`,
      checked: !!own.pay[source.id],
    })),
  };
  return [
    {
      kind: "card",
      title: "Command tokens",
      aside: `${free ? "3 free · " : ""}${own.buy} bought · ${placed} / ${total} placed`,
      bad: placed !== total,
      rows: [
        {
          icon: "token",
          title: ["Buy tokens"],
          subtitle: "3 influence each · up to 3",
          control: {
            kind: "counter",
            counter: { id: "buy", value: own.buy, max: 3, label: "bought token" },
          },
        },
        ...pools,
      ],
    },
    ...(own.buy ? [{ kind: "payment" as const, payment }] : []),
  ];
}

type Parts = {
  title: [string, string];
  heading: string;
  pill: PillView | null;
  trail?: FlowActionView["trail"];
  blocks: BlockView[];
  footer: FooterView;
};

function flowParts(state: State): Parts {
  const flow = state.flow;
  const wait = E.flowNeed(state);
  const step: number = state.selected;
  const foot = (note: string, actions: FooterView["actions"] = [], error = false): FooterView => ({
    note,
    actions,
    error,
  });
  const sim =
    wait && !wait.mine
      ? [button({ type: "simulate" }, `Simulate ${SEATS[wait.seat].name} (demo)`, "demo")]
      : [];
  if (state.kind === "picker") {
    const pick = (
      icon: RowView["icon"],
      name: string,
      text: string,
      label: string,
      intent: Parameters<typeof button>[0] | null,
    ): RowView => ({
      icon,
      title: [name],
      subtitle: text,
      control: {
        kind: "button",
        button: intent
          ? button(intent, label, "default")
          : button({ type: "backToPicker" }, label, "quiet", true),
      },
    });
    return {
      title: ["Your turn", "Choose one action"],
      heading: "Choose an action",
      pill: { tone: "live", label: "Your decision" },
      blocks: [
        {
          kind: "card",
          title: "Tactical action",
          aside: `${SEATS.sol.tokens[0]} tactic tokens`,
          rows: [
            pick(
              "planet",
              "Activate a system",
              "Then move ships, fight, invade, and produce there. You choose the system on the board.",
              "Choose system",
              { type: "pickAction", action: "tactical" },
            ),
          ],
        },
        {
          kind: "card",
          title: "Strategic action",
          aside: "Your strategy card",
          rows: [
            pick(
              "card",
              "1 Leadership",
              "Gain 3 command tokens. Buy more for 3 influence each.",
              "Choose",
              { type: "pickAction", action: "strategic" },
            ),
          ],
        },
        {
          kind: "card",
          title: "Component action",
          aside: "Action cards, technologies, leaders",
          rows: [
            pick(
              "card",
              "Mining Initiative",
              "Action card · gain trade goods equal to the resources of 1 planet you control.",
              "Choose",
              { type: "pickAction", action: "component" },
            ),
          ],
        },
        {
          kind: "card",
          title: "Pass",
          aside: "Ends your actions for this round",
          rows: [
            pick(
              "minus",
              "Pass",
              "You must use your strategy card before you can pass.",
              "Not allowed yet",
              null,
            ),
          ],
        },
        {
          kind: "note",
          tone: "quiet",
          text: "Not your turn? This panel shows the acting player's action, and you can draft your next tactical action in Draft.",
        },
      ],
      footer: foot("Your turn. Choose one action."),
    };
  }
  if (state.kind === "component") {
    const done = flow.stage === "done";
    const own = flow.owner === "sol";
    const rows: RowView[] = PAY.filter((source) => source.system).map((source) => ({
      icon: "planet",
      title: [`${source.label.replace("Exhaust ", "")} · #${source.system}`],
      subtitle: `${plural(source.res, "resource")} → +${plural(source.res, "trade good")}`,
      link: [`pl:${source.id}`, `sys:${source.system}`],
      control: {
        kind: "button",
        button: {
          ...button(
            { type: "flowTarget", planet: source.id },
            flow.target === source.id ? "Selected" : "Select",
            flow.target === source.id ? "primary" : "quiet",
          ),
          pressed: flow.target === source.id,
        },
      },
    }));
    return {
      title: [
        "Component action",
        `${flow.card} · ${SEATS[flow.owner].name} (${SEATS[flow.owner].faction})`,
      ],
      heading: flow.card,
      pill: {
        tone: done ? "done" : "live",
        label: done ? "Resolved" : "Your decision · Choose a planet",
      },
      trail: [
        { label: "Target", status: done ? "complete" : "active" },
        { label: "Result", status: done ? "complete" : "todo" },
      ],
      blocks: [
        {
          kind: "summary",
          eyebrow: "Action card",
          title: flow.card,
          text: "Gain trade goods equal to the resource value of 1 planet you control.",
        },
        done
          ? { kind: "note", tone: "success", strong: "Resolved.", text: flow.result }
          : { kind: "card", title: "Planet", aside: "Pick here or on the board", rows },
      ],
      footer: foot(
        done
          ? "Component action complete."
          : own && flow.target
            ? "This commits to the live game."
            : "Choose 1 planet you control.",
        done
          ? []
          : [
              button(
                { type: "flow", action: "play" },
                `Play ${flow.card}`,
                "primary",
                !flow.target,
                true,
              ),
            ],
      ),
    };
  }
  const primaryMine = flow.owner === "sol";
  const inOrder = flow.order.includes("sol");
  const myTurn = flow.stage === "secondary" && flow.order[flow.turn] === "sol";
  const title: [string, string] = [
    "Strategic action",
    `${flow.card} · ${SEATS[flow.owner].name} (${SEATS[flow.owner].faction})`,
  ];
  const text: BlockView = {
    kind: "summary",
    eyebrow: `${flow.card} · ${step ? "Secondary" : "Primary"}`,
    title: step ? "Buy command tokens" : "Gain 3 command tokens",
    text: step
      ? "Each other player may buy tokens for 3 influence each. No strategy token is spent."
      : "Then buy any number of tokens for 3 influence each.",
  };
  if (step === 0) {
    if (primaryMine && flow.stage === "primary") {
      const error: string = E.flowProblem(state);
      return {
        title,
        heading: "Primary",
        pill: { tone: "live", label: "Your decision" },
        trail: ["Gain tokens", "Buy", "Pay", "Place"].map((label) => ({ label, status: "active" })),
        blocks: [text, ...leadershipEditor(state)],
        footer: foot(
          error || "This commits to the live game.",
          [
            button(
              { type: "flow", action: "resolve" },
              "Resolve primary",
              "primary",
              !!error,
              true,
            ),
          ],
          !!error,
        ),
      };
    }
    const open = flow.stage === "primary";
    return {
      title,
      heading: "Primary",
      pill: {
        tone: open ? "quiet" : "done",
        label: open ? `Waiting for ${SEATS[flow.owner].name}` : "Resolved",
      },
      blocks: [
        text,
        open
          ? {
              kind: "note",
              tone: "quiet",
              strong: `${SEATS[flow.owner].name} is resolving the primary.`,
              text: "You can draft your secondary now. It stays private.",
            }
          : { kind: "note", tone: "success", strong: "Resolved.", text: flow.primaryResult },
      ],
      footer: foot(
        open
          ? `Waiting for ${SEATS[flow.owner].name} · ${flow.card} primary.`
          : "Viewing the primary.",
        open
          ? [...sim, button({ type: "selectStep", step: 1 }, "Draft my secondary", "primary")]
          : [button({ type: "selectStep", step: 1 }, "Go to secondaries", "quiet", false, true)],
      ),
    };
  }
  const order: RowView[] = flow.order.map((seat: string, index: number) => {
    const result = flow.results[seat];
    const current = flow.stage === "secondary" && flow.turn === index;
    const before = index ? SEATS[flow.order[index - 1]].name : SEATS[flow.owner].name;
    const pill: PillView = result
      ? { tone: "done", label: result }
      : current
        ? { tone: "live", label: seat === "sol" ? "Your decision" : "Deciding" }
        : seat === "sol" && flow.mine.ready
          ? { tone: "draft", label: `Draft ready · resolves after ${before}` }
          : seat === "sol"
            ? { tone: "draft", label: `Draft open · your seat is after ${before}` }
            : { tone: "quiet", label: `Waits for ${before}` };
    return {
      order: index + 1,
      title: [{ seat }, ` ${SEATS[seat].name}${seat === "sol" ? " (you)" : ""}`],
      subtitle: SEATS[seat].faction,
      control: { kind: "badge", pill },
    };
  });
  const list: BlockView = {
    kind: "card",
    title: "Secondaries",
    aside: `Resolved in seat order · ${flow.stage === "primary" ? `after ${SEATS[flow.owner].name}’s primary` : flow.stage === "done" ? "all resolved" : `${flow.turn} of ${flow.order.length} resolved`}`,
    rows: order,
  };
  const pill: PillView = {
    tone:
      flow.stage === "done"
        ? "done"
        : myTurn
          ? "live"
          : inOrder && !flow.mine.resolved
            ? "draft"
            : "quiet",
    label:
      flow.stage === "done"
        ? "Resolved"
        : myTurn
          ? "Your decision"
          : inOrder && !flow.mine.resolved
            ? flow.mine.ready
              ? "Draft ready"
              : "Private draft"
            : `Waiting for ${SEATS[wait.seat].name}`,
  };
  if (!inOrder || flow.mine.resolved || flow.stage === "done")
    return {
      title,
      heading: "Secondaries",
      pill,
      blocks: [
        text,
        list,
        ...(flow.mine.resolved && inOrder
          ? [
              {
                kind: "note" as const,
                tone: "success" as const,
                strong: "Your secondary resolved.",
                text: `${flow.results.sol}.`,
              },
            ]
          : []),
      ],
      footer: foot(
        flow.stage === "done"
          ? "Strategic action complete."
          : `Waiting for ${SEATS[wait.seat].name} · ${flow.card} secondary.`,
        sim,
      ),
    };
  const own = flow.mine;
  const error: string = E.flowProblem(state);
  const summary = own.buy
    ? `Follow: buy ${plural(own.buy, "token")} for ${own.buy * 3} influence (${PAY.filter(
        (source) => own.pay[source.id],
      )
        .map((source) => source.label.replace(/^Exhaust |^Spend /, ""))
        .join(", ")}).`
    : "Pass: buy no tokens.";
  const draft: BlockView = own.ready
    ? {
        kind: "draft",
        title: "Your secondary",
        pill: { tone: "draft", label: "Draft ready · not sent" },
        live: false,
        text: summary,
        hint: "It resolves by itself when your seat is reached. Other players cannot see it.",
        blocks: [],
      }
    : {
        kind: "draft",
        title: "Your secondary",
        pill: {
          tone: myTurn ? "live" : "draft",
          label: myTurn ? "Your decision · live" : "Private draft · not sent",
        },
        live: myTurn,
        blocks: leadershipEditor(state),
      };
  return {
    title,
    heading: "Secondaries",
    pill,
    blocks: [text, draft, list],
    footer: foot(
      own.ready
        ? "Your draft waits for your seat. You can still change it."
        : error ||
            (myTurn ? "This commits to the live game." : "Private until your seat is reached."),
      [
        ...(myTurn ? [] : sim),
        own.ready
          ? button({ type: "flow", action: "change" }, "Change draft")
          : myTurn
            ? button(
                { type: "flow", action: "resolve" },
                "Resolve secondary",
                "primary",
                !!error,
                true,
              )
            : button(
                { type: "flow", action: "ready" },
                own.buy ? "Mark draft ready" : "Mark draft ready · pass",
                "primary",
                !!error,
              ),
      ],
      !own.ready && !!error,
    ),
  };
}

function flowTabs(state: State): { tabs: StepTabView[]; current: number | null } {
  if (state.kind !== "strategic") return { tabs: [], current: null };
  const flow = state.flow;
  const wait = E.flowNeed(state);
  const draftable = flow.order.includes("sol") && !flow.mine.resolved;
  return {
    tabs: [
      {
        name: "Primary",
        status: flow.stage === "primary" ? "decision" : "done",
        caption:
          flow.stage === "primary"
            ? flow.owner === "sol"
              ? "Your decision"
              : `Waiting for ${SEATS[flow.owner].name}`
            : "Resolved",
      },
      {
        name: "Secondaries",
        status:
          flow.stage === "done"
            ? "done"
            : flow.stage === "secondary"
              ? "decision"
              : flow.owner === "sol"
                ? "future"
                : "draft",
        caption:
          flow.stage === "done"
            ? `${Object.values<string>(flow.results).filter((text) => text.startsWith("Followed")).length} followed`
            : flow.stage === "primary"
              ? flow.owner === "sol"
                ? ""
                : flow.mine.ready
                  ? "Draft ready"
                  : "Draft open"
              : wait.mine
                ? "Your decision"
                : `Waiting for ${SEATS[wait.seat].name}${draftable && flow.mine.ready ? " · draft ready" : ""}`,
      },
    ],
    current: flow.stage === "primary" ? 0 : flow.stage === "secondary" ? 1 : null,
  };
}

export function selectFlow(world: World, state: State): FlowActionView {
  const parts = flowParts(state);
  const done = !E.flowNeed(state);
  return {
    kind: "flow",
    title: parts.title[0],
    subtitle: parts.title[1],
    badge:
      state.kind === "picker"
        ? null
        : { tone: done ? "done" : "live", label: done ? "Complete" : "In progress" },
    wide: false,
    past: world.mode === "history" ? { label: state.past.label } : null,
    ...flowTabs(state),
    selected: state.selected,
    contentKey: `${state.kind}:${state.selected}`,
    heading: parts.heading,
    pill: parts.pill,
    trail: parts.trail ?? [],
    blocks: parts.blocks,
    footer: parts.footer,
  };
}
