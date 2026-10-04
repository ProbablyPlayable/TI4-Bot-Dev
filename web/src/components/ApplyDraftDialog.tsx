import React from "react";
import { Dialog } from "../primitives/index.ts";
import { humanizeId } from "../protocol/contentCatalog.ts";
import type { RecordedDecisionDto } from "../protocol/types.ts";

export function draftDecisionLabel(decision: RecordedDecisionDto): string {
  const { payload } = decision;
  switch (decision.context?.subtype) {
    case "action_menu":
      return "Take a tactical action";
    case "activate_system":
      return `Activate system ${decision.option_id}`;
    case "movement_step":
      return decision.option_id === "done_moving"
        ? "Finish movement"
        : `Move ${humanizeId(String(payload.unit))} from system ${payload.origin}`;
    case "load_cargo":
      return decision.option_id === "done_loading"
        ? "Finish loading cargo"
        : `Load ${humanizeId(String(payload.unit))}${payload.source ? ` from ${humanizeId(String(payload.source))}` : " from space"}`;
    default:
      return decision.prompt;
  }
}

export const ApplyDraftDialog: React.FC<{
  decisions: RecordedDecisionDto[];
  ready: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ decisions, ready, busy, error, onConfirm, onClose }) => (
  <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
    <Dialog.Content className="apply-draft-dialog" data-testid="apply-draft-dialog">
      <div className="apply-draft-dialog__panel">
        <Dialog.Title>Apply draft to the live game?</Dialog.Title>
        <Dialog.Description>
          Apply these {decisions.length} recorded activation, movement, and cargo choices. Other
          players make their normal live decisions. Execution pauses for their input and stops at
          the first changed or unplanned choice.
        </Dialog.Description>
        <ol className="apply-draft-dialog__choices">
          {decisions.map((decision, index) => (
            <li key={index}>{draftDecisionLabel(decision)}</li>
          ))}
        </ol>
        <p>
          Activation spends 1 tactic token. Further steps beyond this recorded prefix remain manual.
        </p>
        {!ready && !busy && (
          <p role="status">
            The draft or live decision changed. Close this summary and review the current draft.
          </p>
        )}
        {error && (
          <p className="draft-status__error" role="alert">
            {error}
          </p>
        )}
        <div className="apply-draft-dialog__actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="button" className="button" disabled={!ready || busy} onClick={onConfirm}>
            {busy ? "Applying…" : "Confirm and apply"}
          </button>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Root>
);
