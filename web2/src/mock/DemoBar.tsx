import { Button, Select } from "../ui";
import { examples } from "./data";
import { EXAMPLE_GROUPS, EXAMPLE_IDS } from "./exampleList";

export interface DemoControls {
  example: string;
  viewer: string;
  tip: string;
  loadExample: (example: string) => void;
  setViewer: (viewer: string) => void;
  reset: () => void;
}

/** Demo controls live at the bottom so they spend no product chrome. */
export function DemoBar({ demo }: { demo: DemoControls }) {
  const listed = EXAMPLE_IDS.includes(demo.example);
  return (
    <footer className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-line bg-[#080c12] px-4 py-1.5 text-xs text-faint">
      <span className="rounded-sm border border-dashed border-faint px-1.5 py-px font-bold tracking-[.06em] uppercase">
        Demo
      </span>
      <label htmlFor="example">Example</label>
      <Select
        id="example"
        value={demo.example}
        onChange={(event) => demo.loadExample(event.target.value)}
      >
        {EXAMPLE_GROUPS.map(([label, items]) => (
          <optgroup key={label} label={label}>
            {items.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </optgroup>
        ))}
        {!listed && (
          <option value={demo.example} hidden>
            {examples[demo.example] ? "History" : "Live · Applied draft"}
          </option>
        )}
      </Select>
      <label htmlFor="viewer">View as</label>
      <Select
        id="viewer"
        value={demo.viewer}
        onChange={(event) => demo.setViewer(event.target.value)}
      >
        <option value="sol">Jamie · Attacker</option>
        <option value="hacan">Alex · Defender</option>
        <option value="observer">Uninvolved player</option>
      </Select>
      <Button tone="quiet" size="sm" onClick={demo.reset}>
        Reset
      </Button>
      <span className="min-w-0 flex-[1_1_260px] text-muted">{demo.tip}</span>
      <span>Fictional data · Scripted dice</span>
    </footer>
  );
}
