import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CargoLoadingTray } from "./CargoLoadingTray.tsx";
import { BoardView, PendingChoiceDto } from "../protocol/types.ts";
import { WorkspaceContext } from "./WorkspaceContext.tsx";

const board: BoardView = {
  systems: {
    "42": {
      system_id: "42",
      command_tokens: [],
      planets: {},
      units: [
        { owner: "p1", unit_type: "fighter", damaged: false },
        { owner: "p1", unit_type: "fighter", damaged: false },
        { owner: "p1", unit_type: "infantry", planet: "home", damaged: false },
      ],
    },
  },
};
const choice: PendingChoiceDto = {
  actor: "p1",
  nonce: "load-1",
  prompt: "load carrier (2 free)",
  context: { subtype: "load_cargo", target: { System: "42" } },
  options: [
    {
      id: "load|0",
      kind: "load",
      label: "load fighter from space",
      payload: {
        unit: "fighter",
        source: null,
        system: "42",
        capacity_remaining: 2,
        loaded_fighters: 1,
        loaded_ground: 0,
      },
    },
    {
      id: "load|2",
      kind: "load",
      label: "load infantry from home",
      payload: { unit: "infantry", source: "home", system: "42", capacity_remaining: 2 },
    },
    {
      id: "done_loading",
      kind: "decline",
      label: "carry nothing further",
      payload: { loaded_fighters: 1, loaded_ground: 0, ground_available: 1 },
    },
  ],
};

describe("CargoLoadingTray", () => {
  it("retains staging when the same draft offer is re-enabled, but clears it on a new offer", () => {
    const onSubmit = vi.fn();
    const renderDraft = (actionable: boolean, nonce = choice.nonce, refreshKey = "10:1") => (
      <WorkspaceContext.Provider
        value={{ active: true, actionable, draft: true, refreshKey, chrome: null }}
      >
        <CargoLoadingTray
          choice={{ ...choice, nonce }}
          board={board}
          onSubmit={onSubmit}
          isOpen
          onClose={vi.fn()}
        />
      </WorkspaceContext.Provider>
    );
    const { rerender } = render(renderDraft(true));
    fireEvent.click(screen.getByRole("button", { name: "Stage fighter from space" }));
    rerender(renderDraft(false));
    expect(screen.getByTestId("cargo-summary")).toHaveTextContent("Staged: 1");
    rerender(renderDraft(true));
    expect(screen.getByRole("button", { name: "Confirm 1 load" })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(renderDraft(false, "refreshed", "11:2"));
    rerender(renderDraft(true, "refreshed", "11:2"));
    expect(screen.getByTestId("cargo-summary")).toHaveTextContent("Staged: 1");
    rerender(renderDraft(true, "next", "11:2"));
    expect(screen.getByTestId("cargo-summary")).toHaveTextContent("Staged: 0");
  });
  it("shows owned and previously loaded counts, lets the player undo and reset staged loads", () => {
    const onSubmit = vi.fn();
    render(
      <CargoLoadingTray
        choice={choice}
        board={board}
        onSubmit={onSubmit}
        isOpen
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("cargo-summary")).toHaveTextContent("Fighters loaded: 1");
    expect(screen.getByText(/Have: 2 · Available: 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stage fighter from space" }));
    expect(screen.getByTestId("cargo-summary")).toHaveTextContent("Staged: 1");
    expect(screen.getByRole("button", { name: "Stage fighter from space" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove fighter from space" }));
    expect(screen.getByTestId("cargo-summary")).toHaveTextContent("Staged: 0");
    fireEvent.click(screen.getByRole("button", { name: "Stage infantry from home" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset selection" }));
    expect(screen.getByTestId("cargo-summary")).toHaveTextContent("Staged: 0");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits staged loads using the legal option, then waits for the next server nonce", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <CargoLoadingTray
        choice={choice}
        board={board}
        onSubmit={onSubmit}
        isOpen
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stage fighter from space" }));
    fireEvent.click(screen.getByRole("button", { name: "Stage infantry from home" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm 2 loads" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("load|0"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () =>
      rerender(
        <CargoLoadingTray
          choice={{
            ...choice,
            nonce: "load-2",
            options: choice.options.filter((o) => o.id !== "load|0"),
          }}
          board={board}
          onSubmit={onSubmit}
          isOpen
          onClose={vi.fn()}
        />,
      ),
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("load|2"));
    expect(onSubmit).toHaveBeenCalledTimes(2); // A full hold closes without a done option.
  });
});
