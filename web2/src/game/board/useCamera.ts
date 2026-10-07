import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { TileView } from "../../model";
import { boardFrame, frame } from "./hex";

/**
 * Pan and zoom of the board. The camera lives outside React state: a drag updates the SVG view box
 * directly, so the tiles do not render again. The board moves by drag, and zooms with Ctrl + wheel.
 */
export function useCamera(
  svg: RefObject<SVGSVGElement | null>,
  galaxy: RefObject<HTMLDivElement | null>,
  tiles: TileView[],
) {
  const box = useMemo(() => boardFrame(tiles), [tiles.length]);
  const camera = useRef({ x: 0, y: 0, k: 1 });
  const dragged = useRef(false);

  const scale = useCallback(() => {
    const element = svg.current;
    if (!element?.clientWidth) return 1;
    const [, , w, h] = element.getAttribute("viewBox")!.split(" ").map(Number);
    return Math.max(w / element.clientWidth, h / element.clientHeight);
  }, [svg]);

  const apply = useCallback(() => {
    const { x, y, k } = camera.current;
    const w = box.w / k;
    const h = box.h / k;
    svg.current?.setAttribute(
      "viewBox",
      `${(box.cx + x - w / 2).toFixed(1)} ${(box.cy + y - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`,
    );
    // Small text is hidden when the board is far away. It comes back when the player goes nearer.
    if (svg.current?.clientWidth) galaxy.current?.classList.toggle("far", 1 / scale() < 1.05);
  }, [box, svg, galaxy, scale]);

  const zoom = useCallback(
    (factor: number) => {
      camera.current.k = Math.max(0.6, Math.min(5, camera.current.k * factor));
      apply();
    },
    [apply],
  );

  /** Frames the given systems, or the whole board. */
  const fit = useCallback(
    (ids?: string[]) => {
      const area = ids ? frame(tiles.filter((tile) => ids.includes(tile.id))) : box;
      camera.current = {
        x: area.cx - box.cx,
        y: area.cy - box.cy,
        k: Math.min(5, box.w / area.w, box.h / area.h),
      };
      apply();
    },
    [tiles, box, apply],
  );

  /** For a new task: the whole board if it fits at a readable size, else the systems of the task. */
  const fitFor = useCallback(
    (taskSystems: string[]) => {
      const rect = galaxy.current!.getBoundingClientRect();
      fit(Math.min(rect.width / box.w, rect.height / box.h) < 1 ? taskSystems : undefined);
    },
    [fit, box, galaxy],
  );

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    let drag: { x: number; y: number; cx: number; cy: number; scale: number } | null = null;
    const down = (event: PointerEvent) => {
      dragged.current = false;
      if (event.button === 0)
        drag = {
          x: event.clientX,
          y: event.clientY,
          cx: camera.current.x,
          cy: camera.current.y,
          scale: scale(),
        };
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!dragged.current && Math.hypot(dx, dy) < 5) return;
      dragged.current = true;
      camera.current.x = drag.cx - dx * drag.scale;
      camera.current.y = drag.cy - dy * drag.scale;
      apply();
      element.classList.add("dragging");
    };
    const up = () => {
      drag = null;
      element.classList.remove("dragging");
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    element.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("resize", apply);
    return () => {
      element.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", apply);
    };
  }, [svg, apply, scale, zoom]);

  /** A drag never selects: call this in the capture phase of a click. */
  const wasDrag = useCallback(() => {
    const result = dragged.current;
    dragged.current = false;
    return result;
  }, []);

  return { apply, zoom, fit, fitFor, wasDrag };
}
