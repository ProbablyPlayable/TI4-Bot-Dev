import type {
  CounterView,
  Force,
  GaugeView,
  HelpView,
  LinkToken,
  PillView,
  PlanetId,
  Rich,
  SeatId,
  SystemId,
  Tone,
  UnitType,
} from "./core";
import type { TechColor } from "./board";
import type { Intent } from "./intents";

export type StepStatus =
  | "future"
  | "skipped"
  | "done"
  | "decision"
  | "needs-review"
  | "boundary"
  | "battle"
  | "draft";
export type TrailStatus = "complete" | "active" | "todo" | "skipped";

export interface StepTabView {
  name: string;
  status: StepStatus;
  caption: string;
}

/** A button that the data source offers. Compare `ChoiceOptionDto`. */
export interface ActionButtonView {
  label: string;
  tone?: "default" | "primary" | "quiet" | "demo";
  disabled?: boolean;
  pressed?: boolean;
  arrow?: boolean;
  /** Shortcut key: a letter, a digit, "Enter" or "Escape". The shell listens for it and the button shows it. */
  key?: string;
  intent: Intent;
}

export interface FooterView {
  note: string;
  error: boolean;
  actions: ActionButtonView[];
  /** The open payment, as one line: what pays and the total. Its controls are on the board. */
  payment?: PaymentView;
}

// ---- Dice ---------------------------------------------------------------------------------------

/** Compare `CombatDieRoll`. */
export interface DieView {
  roll: number;
  hit: boolean;
}

export interface BattleRowView {
  unit: UnitType;
  count: number;
  /** Shown as "7+". Null when the unit does not roll. */
  target: number | null;
  targetTitle: string;
  modified: boolean;
  /** Rolled dice, or the number of dice that will roll. */
  dice: DieView[] | number;
  /** "2 hits", or "≈1.4" before the roll. */
  hits: string;
  scored: boolean;
  pills: { tone: "damage" | "loss" | "staged"; label: string; title?: string }[];
  gone: boolean;
  /** Hit assignment offered on this row. */
  assign: { kind: "sustain" | "destroy" | "destroy-damaged"; label: string; disabled: boolean }[];
}

export interface BattleSideView {
  seat: SeatId;
  role: "Attacker" | "Defender";
  isViewer: boolean;
  hits: number | null;
  /** Limits and modifiers, on one line. */
  meta: { text: string; tone?: "bad" | "accent" }[];
  /** Action cards, on their own line. The viewer sees the names of their cards. */
  cards: string;
  rows: BattleRowView[];
}

/** One table for every dice step: space cannon, barrage, combat rounds, bombardment, ground combat. */
export interface BattleTableView {
  label: string;
  score: string;
  owed: { hits: number; seat: SeatId } | null;
  sides: BattleSideView[];
  notes: string[];
  /** A rule of this roll. It is behind "?". */
  hint?: string;
}

export interface OddsView {
  kind: "space" | "ground";
  attacker: SeatId;
  defender: SeatId;
  /** Percentages. */
  attackerWins: number;
  defenderWins: number;
  rollouts: number;
  rounds: string;
  attackerLeft: string;
  defenderLeft: string;
  caveat: string;
}

export interface OutcomeView {
  title: string;
  subtitle: string;
  sides: { seat: SeatId; lost: Force; kept: Force; keptLabel: string }[];
  note?: string;
}

export type BattleOfferView =
  | {
      kind: "note";
      tone: "accent" | "success";
      alert?: boolean;
      strong: string;
      text?: string;
      /** The rule behind the note. It is behind "?". */
      hint?: string;
    }
  | { kind: "offer"; eyebrow: string; title: string; text: string; actions: ActionButtonView[] };

export interface BattleRecordView {
  key: string;
  label: string;
  odds?: OddsView;
  table: BattleTableView;
}

// ---- Steps of a tactical action -----------------------------------------------------------------

export interface ActivationView {
  kind: "activation";
  editing: boolean;
  /** Editing: the system in the selection, if any. */
  chosen: {
    system: SystemId;
    label: string;
    facts: string;
    commandToken: boolean;
    shipsInRange: number;
    originsInRange: number;
  } | null;
  systems: { id: SystemId; label: string }[];
  /** Recorded: the active system. */
  active: { system: SystemId; name: string } | null;
  /** The tactic pool of the acting player, before and after the token of this activation. */
  tacticPool: [now: number, after: number];
  draft: boolean;
}

export interface MoveRowView {
  key: string;
  unit: UnitType;
  name: string;
  subtitle: Rich;
  invalid: boolean;
  link: LinkToken[];
  counter: CounterView | null;
  /** Read-only count. */
  quantity: number | null;
  removable: boolean;
  route: {
    line: string;
    text: string;
    options: { index: number; label: string }[];
    selected: number;
    riftRoll: boolean;
  } | null;
}

export interface OriginView {
  system: SystemId;
  label: string;
  /** A collapsed origin is one line. */
  collapsed: { away: number; names: string } | null;
  away: number | null;
  cargo: number;
  capacity: number;
  carriers: string[];
  rows: MoveRowView[];
  pickups: { system: SystemId; label: string; commandToken: boolean; rows: MoveRowView[] }[];
  stays: string[];
}

export interface RiftRowView {
  unit: UnitType;
  name: string;
  text: string;
  /** Null before the roll. */
  roll: { face: number; lost: boolean } | null;
}

export interface MovementView {
  kind: "movement";
  editing: boolean;
  origins: OriginView[];
  unreachable: {
    target: SystemId;
    rows: { unit: UnitType; name: string; text: string; system: SystemId }[];
  } | null;
  gauges: GaugeView[];
  excessShips: number;
  riftRolls: number;
  rift: RiftRowView[] | null;
  removed: UnitType[];
  cannon: BattleTableView | null;
  cannonSkipped: boolean;
}

export interface CombatView {
  kind: "combat";
  skipped: string | null;
  outcome: OutcomeView | null;
  offers: BattleOfferView[];
  records: BattleRecordView[];
  /** Changes when the battle moves on; the view then shows the latest record again. */
  revision: string;
}

export interface InvasionPlanetView {
  id: PlanetId;
  name: string;
  heading: string;
  counters: { unit: UnitType; left: number; counter: CounterView }[];
  owner: SeatId | null;
  facts: { label?: string; strong?: string; text?: string }[];
  result: { text: string; failed: boolean } | null;
  outcome: OutcomeView | null;
  /** What ground combat will roll with the staged forces, with the simulated odds in its headers. */
  projection: { note: string } | { table: BattleTableView; odds: OddsView } | null;
  offers: BattleOfferView[];
  records: BattleRecordView[];
  /** A table that shows what will roll before ground combat, where the draft stops. */
  preview: BattleTableView | null;
}

export interface InvasionView {
  kind: "invasion";
  skipped: string | null;
  planets: InvasionPlanetView[];
  gauges: GaugeView[];
  plannedNote: boolean;
  revision: string;
}

/** The total of a payment. The player chooses the planets on the board, not in the panel. */
export interface PaymentView {
  title: string;
  cost: number;
  paid: number;
  unit: string;
  /** False when the payment is recorded and read-only. */
  editable: boolean;
  /** What pays now, for example "Jord 4 + Lodor 1". Empty when nothing is chosen. */
  summary: string;
  /**
   * Trade goods are not on the board, so they have a counter in the panel. `rest` is the count
   * that pays exactly what the planets leave; null when the trade goods cannot do that.
   */
  goods: { id: string; value: number; max: number; rest: number | null } | null;
  /** Auto-pay and "Clear payment". They change the staged payment on the map; nothing is sent. */
  actions: ActionButtonView[];
}

export interface ProductionView {
  kind: "production";
  skipped: string | null;
  title: string;
  subtitle: string;
  rows: {
    unit: UnitType;
    name: string;
    subtitle: string;
    counter: CounterView | null;
    quantity: number | null;
    placement: { options: { id: string; label: string }[]; selected: string } | null;
  }[];
  gauges: GaugeView[];
  payment: PaymentView;
  done: { strong: string; text: string } | null;
}

export type StepContentView =
  | ActivationView
  | MovementView
  | CombatView
  | InvasionView
  | ProductionView;

export interface TaskView {
  step: number;
  title: string;
  pill: PillView;
  trail: { label: string; status: TrailStatus; reason?: string }[];
  edit: { label: string; step: number; disabled: boolean; hint?: string } | null;
  /** Rules and explanations of this step. */
  help: HelpView[];
  content: StepContentView;
  footer: FooterView;
}

// ---- Blocks for actions without a dedicated view: strategy cards, component actions ------------

export type RowControlView =
  | { kind: "button"; button: ActionButtonView }
  | { kind: "counter"; counter: CounterView }
  | { kind: "badge"; pill: PillView };

export interface RowView {
  icon?: "planet" | "card" | "token" | "minus";
  order?: number;
  title: Rich;
  subtitle?: string;
  /** A pool of command tokens: how many it has now, and how many after the staged change. */
  tokens?: { now: number; after: number; /** The fleet pool: its tokens point up. */ up?: boolean };
  /** Rule text, shown on hover or click. */
  hint?: string;
  link?: LinkToken[];
  control?: RowControlView;
}

/** One choice of a menu. The whole row is the control. */
export interface MenuRowView {
  /** Shown on the first row of a group only. */
  group?: string;
  /** Shortcut key: a letter or a digit. */
  key: string;
  title: string;
  /** Game state of this choice: a count, or the reason why it is not allowed. */
  state?: string;
  /** Rule text, shown on hover or click. */
  hint?: string;
  /** The printed text of a card, shown under the title. For a list that has the room for it. */
  text?: string;
  /** The staged choice of a list where the player chooses one row. */
  selected?: boolean;
  disabled: boolean;
  intent: Intent;
}

/** One seat of a strategy card. Only the row of the viewer can be open. */
export interface SeatRowView {
  /** "P" for the primary, then the place in the seat order. */
  order: string;
  seat: SeatId;
  name: string;
  you: boolean;
  status: { tone: PillView["tone"]; sign: string; label: string };
  /** What the seat did, or what its draft will do. */
  text?: string;
  /** The editor of the viewer, in place under the row. */
  open?: BlockView[];
}

/** One technology of the tree. The cell is the control. */
export interface TechCellView {
  id: string;
  name: string;
  /** The prerequisites, one for each symbol. `missing` is the reason why it cannot be researched. */
  needs: { color: TechColor; missing: boolean }[];
  /** The colour of the technology, for a cell that is not in a colour column. */
  color?: TechColor;
  state: "owned" | "open" | "closed";
  selected: boolean;
  /** The printed text, shown on hover. */
  text: string;
  intent: Intent;
}

export interface TechColumnView {
  color: TechColor;
  /** What the viewer has of this colour: "Blue 2 · +1 Arnor". */
  label: string;
  cells: TechCellView[];
}

export type BlockView =
  | { kind: "note"; tone: "accent" | "success" | "quiet"; strong?: string; text: string }
  | { kind: "menu"; title?: string; rows: MenuRowView[] }
  /** The card or ability that asks for the decision, as printed. It is on top of the decision. */
  | { kind: "source"; name: string; type: string; text: string }
  | { kind: "gauges"; gauges: GaugeView[] }
  /** The technology tree: one column for each colour, and a band for the unit upgrades. */
  | {
      kind: "techs";
      title: string;
      /** The chosen technologies with their price. Empty when nothing is chosen. */
      chosen: string[];
      aside?: string;
      columns: TechColumnView[];
      /** Rows under the columns: the unit upgrades, and the faction technologies if there are any. */
      bands: { label: string; cells: TechCellView[] }[];
    }
  /** The seat order of a strategy card: the primary, then the secondaries, with what each did. */
  | { kind: "seats"; rows: SeatRowView[] }
  | {
      kind: "card";
      title: string;
      aside?: string;
      bad?: boolean;
      rows: RowView[];
    }
  | { kind: "payment"; payment: PaymentView }
  | {
      kind: "draft";
      title: string;
      pill: PillView;
      live: boolean;
      text?: string;
      hint?: string;
      blocks: BlockView[];
    };

/**
 * A reaction window: the viewer may play a card now, or pass. It sits on top of the open action,
 * which shows what happened. The main button of the footer is Pass, or Play for a staged card.
 */
export interface InterruptView {
  /** The trigger, in game values: "Reaction · After Blair plays Mining Initiative". */
  eyebrow: string;
  link: LinkToken[];
  blocks: BlockView[];
  actions: ActionButtonView[];
}

// ---- The panel ----------------------------------------------------------------------------------

interface PanelFrame {
  title: string;
  subtitle: string;
  badge: PillView | null;
  /** Set when the panel shows a past action, read-only. */
  past: { label: string } | null;
  tabs: StepTabView[];
  selected: number;
  current: number | null;
  /** Key of the content, to keep scroll position while the same content is open. */
  contentKey: string;
  /** A reaction window of the viewer, on top of the content. Null in any other state. */
  interrupt: InterruptView | null;
  /** What the viewer can still do after their action, before they end the turn. Empty in any other state. */
  closing: BlockView[];
}

export interface TacticalActionView extends PanelFrame {
  kind: "tactical";
  /** A step with staged changes that is not in view. */
  uncommitted: { step: number; name: string } | null;
  task: TaskView;
}

export interface FlowActionView extends PanelFrame {
  kind: "flow";
  heading: string;
  pill: PillView | null;
  trail: { label: string; status: TrailStatus }[];
  /** Rules and explanations of this action. */
  help: HelpView[];
  blocks: BlockView[];
  footer: FooterView;
}

export type ActionView = TacticalActionView | FlowActionView;

export type { Tone };
