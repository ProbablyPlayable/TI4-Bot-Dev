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
  intent: Intent;
}

export interface FooterView {
  note: string;
  error: boolean;
  actions: ActionButtonView[];
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
  | { kind: "note"; tone: "accent" | "success"; alert?: boolean; strong: string; text: string }
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
  projection: { note: string } | { odds: OddsView } | null;
  offers: BattleOfferView[];
  records: BattleRecordView[];
  /** A table that shows what will roll, where the draft stops. */
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
  /** Trade goods are not on the board, so they have a control in the panel. */
  goods: { id: string; label: string; checked: boolean } | null;
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
  /** Rule text, shown on hover or click. */
  hint?: string;
  link?: LinkToken[];
  control?: RowControlView;
}

export type BlockView =
  | { kind: "note"; tone: "accent" | "success" | "quiet"; strong?: string; text: string }
  | { kind: "card"; title: string; aside?: string; bad?: boolean; rows: RowView[] }
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
