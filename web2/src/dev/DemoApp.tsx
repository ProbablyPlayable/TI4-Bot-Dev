import { useEffect, useMemo } from "react";
import { GameShell } from "../game/shell/GameShell";
import { DemoBar } from "../mock/DemoBar";
import { createMockStore, useMockSession } from "../mock/store";

/** The game shell on the mock session. `?example=draft-movement&viewer=hacan` opens one state directly. */
export function DemoApp() {
  const store = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return createMockStore({
      example: params.get("example") ?? undefined,
      viewer: params.get("viewer") ?? undefined,
    });
  }, []);
  const { session, demo } = useMockSession(store);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    params.set("example", demo.example);
    if (demo.viewer === "sol") params.delete("viewer");
    else params.set("viewer", demo.viewer);
    history.replaceState(null, "", `?${params}`);
  }, [demo.example, demo.viewer]);
  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
      <GameShell session={session} />
      <DemoBar demo={demo} />
    </div>
  );
}
