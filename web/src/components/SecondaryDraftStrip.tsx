import React from "react";
import type { SecondaryDraftView } from "../presentation/secondaryDraft.ts";
import { usePlayerIdentity } from "../presentation/PlayerIdentity.tsx";

/** A follower's secondary draft: which card, where the live window is, and the ready switch. */
export const SecondaryDraftStrip: React.FC<{
  view: SecondaryDraftView;
  assumptions: string[];
  error: string | null;
  onReady: (ready: boolean) => void;
  onReset: () => void;
  /** Shown while the live game waits for this seat. */
  onLive?: () => void;
}> = ({ view, assumptions, error, onReady, onReset, onLive }) => {
  const display = usePlayerIdentity();
  return (
    <section
      className="draft-status"
      aria-label="Secondary draft status"
      data-testid="secondary-draft-status"
    >
      <div className="draft-status__summary">
        <div className="draft-status__heading">
          <strong className="draft-status__badge">Hypothetical</strong>
          <span className="draft-status__state" data-testid="secondary-draft-card">
            {view.initiative ? `${view.initiative}. ` : ""}
            {view.cardName} secondary · played by {display(view.playedBy).label}
          </span>
          <span className="draft-status__state" role="status" data-testid="secondary-draft-state">
            {view.state}
          </span>
          {view.ready && (
            <strong className="draft-status__ready" data-testid="secondary-draft-ready">
              Ready
            </strong>
          )}
        </div>
        <p className="draft-status__description" data-testid="secondary-draft-stage">
          {view.stage}
        </p>
        <p className="draft-status__description">{view.hint}</p>
        {assumptions.length > 0 && (
          <p className="draft-status__description">{assumptions.join(" ")}</p>
        )}
      </div>
      <div className="draft-status__actions">
        {!view.submitting &&
          (view.ready ? (
            <button
              type="button"
              className="button button--secondary"
              data-testid="secondary-draft-unready"
              onClick={() => onReady(false)}
            >
              Not ready
            </button>
          ) : (
            <button
              type="button"
              className="button button--primary"
              data-testid="secondary-draft-ready-btn"
              disabled={!view.canReady}
              onClick={() => onReady(true)}
            >
              Ready · submit on my turn
            </button>
          ))}
        {!view.submitting && (
          <button
            type="button"
            className="button button--secondary"
            data-testid="secondary-draft-reset"
            disabled={!view.canReset}
            onClick={onReset}
          >
            Reset draft
          </button>
        )}
        {onLive && (
          <button type="button" className="button workspace-attention" onClick={onLive}>
            The live game is waiting for you · Switch to Live
          </button>
        )}
      </div>
      {error && (
        <span className="draft-status__error" role="alert">
          {error}
        </span>
      )}
    </section>
  );
};
