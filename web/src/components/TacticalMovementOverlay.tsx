import React, { useState, useEffect, useMemo, useRef } from "react";
import { PendingChoiceDto, PlayerView, BoardView } from "../protocol/types.ts";
import { getMovementPayload, ChoiceRendererModel } from "../presentation/choiceModel.ts";
import { DecisionHeader } from "./DecisionHeader.tsx";
import { UnitIcon, getUnitDisplayName, getUnitBaseType } from "./UnitIcon.tsx";
import type { MovementStep } from "../protocol/client.ts";
import { PlanningRefreshError } from "../protocol/planning.ts";
import { useWorkspace } from "./WorkspaceContext.tsx";
import {
  movementShipKey,
  movementCargoKey,
  recordedMovementStaging,
} from "../protocol/movementDraft.ts";

export interface TacticalMovementOverlayProps {
  choice: PendingChoiceDto | null;
  model?: ChoiceRendererModel | null;
  board?: BoardView;
  viewerSeat?: string | null;
  activeSystemId?: string | null;
  player?: PlayerView | null;
  onSubmit: (optionId: string) => Promise<void>;
  onSubmitBatch?: (destination: string, steps: MovementStep[]) => Promise<void>;
  isOpen: boolean;
  onClose: () => void;
  lastError?: string | null;
  executionPlan?: React.RefObject<ExecutionPlan>;
  executionStep?: number;
  onExecutionStep?: () => void;
}

interface OriginShipGroup {
  originSystemId: string;
  unitType: string;
  damaged: boolean;
  gravityDrive: boolean;
  ionian: boolean;
  totalAvailable: number;
  capacityPerUnit: number;
  isFighter: boolean;
  isGroundForce: boolean;
  options: { id: string; gravityDrive?: boolean }[];
}

interface OriginCargoGroup {
  originSystemId: string;
  carrierOrigin?: string;
  unitType: string;
  source: string | null;
  damaged: boolean;
  galvanized?: boolean;
  totalAvailable: number;
}

export interface ExecutionPlan {
  destination?: string | null;
  active: boolean;
  actor: string | null;
  remainingShips: {
    origin: string;
    unitType: string;
    capacity: number;
    damaged: boolean;
    gravityDrive?: boolean;
    ionian?: boolean;
  }[];
  remainingCargo: {
    origin: string;
    pickupSystem?: string;
    unitType: string;
    source: string | null;
    damaged: boolean;
    galvanized?: boolean;
  }[];
  currentShipOrigin: string | null;
  currentShipCapacity: number;
  currentShipLoadedCount: number;
  submitting: boolean;
  lastSubmittedNonce: string | null;
}

export function emptyMovementPlan(): ExecutionPlan {
  return {
    active: false,
    actor: null,
    remainingShips: [],
    remainingCargo: [],
    currentShipOrigin: null,
    currentShipCapacity: 0,
    currentShipLoadedCount: 0,
    submitting: false,
    lastSubmittedNonce: null,
  };
}

export const TacticalMovementOverlay: React.FC<TacticalMovementOverlayProps> = ({
  choice,
  model,
  board,
  activeSystemId,
  player,
  onSubmit,
  onSubmitBatch,
  isOpen,
  onClose,
  lastError,
  executionPlan,
  executionStep: parentExecutionStep,
  onExecutionStep,
}) => {
  const workspace = useWorkspace();
  const stagingBinding = useRef({ nonce: choice?.nonce, refresh: workspace.refreshKey });
  // Map of key -> count to move
  const [stagedMoves, setStagedMoves] = useState<Record<string, number>>({});
  const restoredEdit = useRef<number | null>(null);
  const [isDirectSubmitting, setIsDirectSubmitting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(() => executionPlan?.current.active ?? false);
  const [executionStep, setExecutionStep] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const localPlanRef = useRef<ExecutionPlan>(emptyMovementPlan());
  const planRef = executionPlan ?? localPlanRef;
  const advance = () => {
    setExecutionStep((s) => s + 1);
    onExecutionStep?.();
  };

  const isCargoStep = choice?.context?.subtype === "load_cargo";

  const doneMovingOption = useMemo(() => {
    return (
      model?.declineOption ??
      choice?.options.find(
        (o) => o.id === "done_moving" || o.id === "done_loading" || o.kind === "decline",
      ) ??
      null
    );
  }, [choice, model]);

  // Extract and group move options for movement_step
  const shipGroups = useMemo(() => {
    if (!choice || isCargoStep) return [] as OriginShipGroup[];

    const groupMap = new Map<string, OriginShipGroup>();

    const options = [...choice.options];
    // A later Ionian move can be hidden by the engine's cheaper Gravity Drive
    // offer until the earlier recorded move consumes that boost. Retain only
    // that known dependency; an absent ordinary move remains unavailable.
    let earlierGravity = false;
    for (const decision of workspace.movementEdit?.decisions ?? []) {
      const p = decision.payload;
      if (decision.kind !== "move" || decision.context?.subtype !== "movement_step") continue;
      if (earlierGravity && p.ionian === true && p.gravity_drive !== true) {
        const equivalent = choice.options.find(
          (option) =>
            option.kind === "move" &&
            option.payload?.origin === p.origin &&
            option.payload?.unit === p.unit &&
            Boolean(option.payload?.damaged) === (p.damaged === true) &&
            option.payload?.gravity_drive === true &&
            option.payload?.ionian !== true,
        );
        if (equivalent)
          options.push({
            ...equivalent,
            payload: { ...equivalent.payload, gravity_drive: false, ionian: true },
          });
      }
      earlierGravity ||=
        p.gravity_drive === true &&
        typeof p.origin === "string" &&
        typeof p.unit === "string" &&
        (stagedMoves[
          movementShipKey(p.origin, p.unit, p.damaged === true, true, p.ionian === true)
        ] ?? 0) > 0;
    }
    for (const opt of options) {
      if (opt.id === "done_moving" || opt.kind === "decline") continue;

      const p = getMovementPayload(opt);
      const origin = p.origin ?? "unknown";
      const unit = p.unit ?? opt.label.toLowerCase();
      const damaged = Boolean(p.damaged);
      const gravityDrive = workspace.draft && opt.payload?.gravity_drive === true;
      const ionian = workspace.draft && opt.payload?.ionian === true;
      const key = movementShipKey(origin, unit, damaged, gravityDrive, ionian);

      const baseType = getUnitBaseType(unit);
      const isFighter = baseType === "fighter";
      const isGroundForce = baseType === "infantry" || baseType === "mech";
      const capacityPerUnit = p.capacity ?? 0;

      // Determine accurate available count from boardView if present
      let availableCount = 1;
      if (board?.systems?.[origin]?.units) {
        const matchingUnits = board.systems[origin].units.filter((u) => {
          if (u.owner !== choice.actor) return false;
          if (u.planet) return false; // ships are in space
          if (Boolean(u.damaged) !== damaged) return false;
          return (
            u.unit_type.toLowerCase() === unit.toLowerCase() ||
            getUnitBaseType(u.unit_type) === baseType
          );
        });
        availableCount = matchingUnits.length;
      }

      const existing = groupMap.get(key);
      if (existing) {
        if (!board?.systems?.[origin]?.units) {
          existing.totalAvailable += 1;
        }
        existing.options.push({ id: opt.id, gravityDrive: p.gravity_drive });
      } else {
        groupMap.set(key, {
          originSystemId: origin,
          unitType: unit,
          damaged,
          gravityDrive,
          ionian,
          totalAvailable: availableCount,
          capacityPerUnit,
          isFighter,
          isGroundForce,
          options: [{ id: opt.id, gravityDrive: p.gravity_drive }],
        });
      }
    }

    return Array.from(groupMap.values());
  }, [choice, board, isCargoStep, workspace.draft, workspace.movementEdit, stagedMoves]);

  // Discover cargo (ground forces + fighters) in origin systems where ships can move from
  const originCargoGroups = useMemo(() => {
    if (!choice || isCargoStep || !board?.systems) return [] as OriginCargoGroup[];

    const originsWithMovable = new Set<string>();
    for (const g of shipGroups) {
      if (!g.isFighter && !g.isGroundForce) {
        originsWithMovable.add(g.originSystemId);
      }
    }

    const cargoMap = new Map<string, OriginCargoGroup>();

    const carriersByPickup = new Map<string, string>();
    for (const decision of workspace.movementEdit?.decisions ?? []) {
      const p = decision.payload;
      if (
        decision.kind === "load" &&
        typeof p.pickup_system === "string" &&
        typeof p.system === "string"
      ) {
        originsWithMovable.add(p.pickup_system);
        carriersByPickup.set(p.pickup_system, p.system);
      }
    }

    for (const origin of originsWithMovable) {
      const units = board.systems[origin]?.units ?? [];
      for (const u of units) {
        if (u.owner !== choice.actor) continue;
        const base = getUnitBaseType(u.unit_type);
        const isGround = base === "infantry" || base === "mech";
        const isFighter = base === "fighter";

        if (!isGround && !isFighter) continue;

        const source = u.planet ?? null;
        const damaged = Boolean(u.damaged);
        const key = movementCargoKey(origin, u.unit_type, source, damaged, u.galvanized);

        const existing = cargoMap.get(key);
        if (existing) {
          existing.totalAvailable += 1;
        } else {
          cargoMap.set(key, {
            originSystemId: origin,
            carrierOrigin: carriersByPickup.get(origin),
            unitType: u.unit_type,
            source,
            damaged,
            galvanized: u.galvanized,
            totalAvailable: 1,
          });
        }
      }
    }

    return Array.from(cargoMap.values());
  }, [choice, board, shipGroups, isCargoStep, workspace.movementEdit]);

  // Reset staging on choice nonce change only when NOT actively executing
  useEffect(() => {
    if (!workspace.actionable) return;
    if (
      workspace.movementEdit &&
      choice?.context?.subtype === "movement_step" &&
      restoredEdit.current !== workspace.movementEdit.revision
    ) {
      restoredEdit.current = workspace.movementEdit.revision;
      setStagedMoves(recordedMovementStaging(workspace.movementEdit.decisions));
      setLocalError(null);
      stagingBinding.current = { nonce: choice.nonce, refresh: workspace.refreshKey };
      return;
    }
    const previous = stagingBinding.current;
    const refreshed = previous.refresh !== workspace.refreshKey;
    stagingBinding.current = { nonce: choice?.nonce, refresh: workspace.refreshKey };
    // Re-enabling the same offer after a socket replacement is not a choice transition.
    if (!refreshed && previous.nonce === choice?.nonce) return;
    if (workspace.draft && refreshed) return;
    if (!planRef.current.active) {
      setStagedMoves({});
      setIsDirectSubmitting(false);
      setLocalError(null);
    }
  }, [choice?.nonce, workspace.refreshKey, workspace.actionable, workspace.movementEdit]);

  const fleetTokens = player?.fleet_tokens;
  const availableStaging = new Map<string, number>();
  for (const group of shipGroups)
    availableStaging.set(
      movementShipKey(
        group.originSystemId,
        group.unitType,
        group.damaged,
        group.gravityDrive,
        group.ionian,
      ),
      group.totalAvailable,
    );
  for (const group of originCargoGroups)
    availableStaging.set(
      movementCargoKey(
        group.originSystemId,
        group.unitType,
        group.source,
        group.damaged,
        group.galvanized,
      ),
      group.totalAvailable,
    );
  // Move variants and cargo rows draw from the same physical inventory.
  const inventory = new Map<string, { available: number; selected: number; keys: string[] }>();
  const reserve = (identity: string, key: string, available: number) => {
    const entry = inventory.get(identity) ?? { available, selected: 0, keys: [] };
    entry.selected += stagedMoves[key] ?? 0;
    entry.keys.push(key);
    inventory.set(identity, entry);
  };
  for (const g of shipGroups)
    reserve(
      movementCargoKey(g.originSystemId, g.unitType, null, g.damaged),
      movementShipKey(g.originSystemId, g.unitType, g.damaged, g.gravityDrive, g.ionian),
      g.totalAvailable,
    );
  for (const g of originCargoGroups)
    reserve(
      movementCargoKey(g.originSystemId, g.unitType, g.source, g.damaged),
      movementCargoKey(g.originSystemId, g.unitType, g.source, g.damaged, g.galvanized),
      (board?.systems?.[g.originSystemId]?.units ?? []).filter(
        (u) =>
          u.owner === choice?.actor &&
          u.unit_type === g.unitType &&
          (u.planet ?? null) === g.source &&
          Boolean(u.damaged) === g.damaged,
      ).length,
    );
  const overbooked = new Set(
    [...inventory.values()]
      .filter((entry) => entry.selected > entry.available)
      .flatMap((entry) => entry.keys),
  );
  const unavailableSelections = Object.entries(stagedMoves).filter(
    ([key, count]) =>
      count > (availableStaging.get(key) ?? 0) || (count > 0 && overbooked.has(key)),
  );
  const unavailableStaging = !planRef.current.active && unavailableSelections.length > 0;

  const destinationSystemId =
    activeSystemId ??
    board?.active_system ??
    (model?.selectionMode.mode === "tactical_move" ? model.selectionMode.activeSystem : null) ??
    (choice?.context?.target && "System" in choice.context.target
      ? choice.context.target.System
      : null);

  // Existing non-fighter ships already in active destination system
  const existingNonFightersInDestination = useMemo(() => {
    if (!destinationSystemId || !board?.systems?.[destinationSystemId]?.units || !choice) {
      return 0;
    }
    return board.systems[destinationSystemId].units.filter((u) => {
      if (u.owner !== choice.actor || u.planet) return false;
      const base = getUnitBaseType(u.unit_type);
      return (
        base !== "fighter" &&
        base !== "infantry" &&
        base !== "mech" &&
        base !== "pds" &&
        base !== "spacedock"
      );
    }).length;
  }, [board, destinationSystemId, choice]);

  // Capacity & Fleet calculations
  const { totalNonFightersMoving, capacityByOrigin, cargoByOrigin } = useMemo(() => {
    let nonFighters = 0;
    let capacity = 0;
    let cargo = 0;
    const capByOrig: Record<string, number> = {};
    const cargoByOrig: Record<string, number> = {};

    // 1. Moving ships
    for (const g of shipGroups) {
      const key = movementShipKey(
        g.originSystemId,
        g.unitType,
        g.damaged,
        g.gravityDrive,
        g.ionian,
      );
      const count = stagedMoves[key] ?? 0;
      if (count === 0) continue;

      if (!g.isFighter && !g.isGroundForce) {
        nonFighters += count;
        const shipCap = count * g.capacityPerUnit;
        capacity += shipCap;
        capByOrig[g.originSystemId] = (capByOrig[g.originSystemId] ?? 0) + shipCap;
      } else if (!workspace.draft) {
        cargo += count;
        cargoByOrig[g.originSystemId] = (cargoByOrig[g.originSystemId] ?? 0) + count;
      }
    }

    // 2. Staged pooled cargo from origin
    for (const c of originCargoGroups) {
      const key = movementCargoKey(c.originSystemId, c.unitType, c.source, c.damaged, c.galvanized);
      const count = stagedMoves[key] ?? 0;
      if (count === 0) continue;
      cargo += count;
      const carrierOrigin = c.carrierOrigin ?? c.originSystemId;
      cargoByOrig[carrierOrigin] = (cargoByOrig[carrierOrigin] ?? 0) + count;
    }

    return {
      totalNonFightersMoving: nonFighters,
      totalCapacityProvided: capacity,
      totalCargoMoving: cargo,
      capacityByOrigin: capByOrig,
      cargoByOrigin: cargoByOrig,
    };
  }, [shipGroups, originCargoGroups, stagedMoves, workspace.draft]);

  const originSystemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of shipGroups) {
      ids.add(g.originSystemId);
    }
    for (const c of originCargoGroups) {
      ids.add(c.originSystemId);
    }
    return Array.from(ids).sort();
  }, [shipGroups, originCargoGroups]);

  const hasAnyOriginOverCapacity = useMemo(() => {
    return originSystemIds.some((orig) => {
      const cap = capacityByOrigin[orig] ?? 0;
      const cargo = cargoByOrigin[orig] ?? 0;
      return cargo > cap;
    });
  }, [originSystemIds, capacityByOrigin, cargoByOrigin]);

  const totalProjectedFleet = existingNonFightersInDestination + totalNonFightersMoving;
  const isOverFleetSupply = fleetTokens !== undefined && totalProjectedFleet > fleetTokens;

  const totalUnitsStaged = Object.values(stagedMoves).reduce((a, b) => a + b, 0);

  const handleUpdateCount = (key: string, delta: number, max: number) => {
    setStagedMoves((prev) => {
      const current = prev[key] ?? 0;
      const next = Math.max(0, Math.min(max, current + delta));
      return { ...prev, [key]: next };
    });
  };

  const submitFinish = async () => {
    setLocalError(null);
    if (!doneMovingOption) {
      setLocalError("Cannot finish movement: no finish option was offered.");
      return;
    }
    setIsDirectSubmitting(true);
    try {
      await onSubmit(doneMovingOption.id);
    } catch (error) {
      setLocalError(`Could not finish movement: ${String(error)}`);
    } finally {
      setIsDirectSubmitting(false);
    }
  };

  // State machine step execution
  const stepExecution = async (currentChoice: PendingChoiceDto) => {
    if (!planRef.current.active || planRef.current.submitting) return;
    if (currentChoice.nonce === planRef.current.lastSubmittedNonce) return;

    const execution = planRef.current;
    const subtype = currentChoice.context?.subtype;
    if (
      currentChoice.actor !== planRef.current.actor ||
      (subtype !== "movement_step" && subtype !== "load_cargo")
    ) {
      planRef.current.active = false;
      setIsExecuting(false);
      return;
    }

    if (subtype === "movement_step") {
      if (
        workspace.draft &&
        planRef.current.destination &&
        destinationSystemId &&
        destinationSystemId !== planRef.current.destination
      ) {
        planRef.current.active = false;
        setIsExecuting(false);
        setLocalError("The movement destination changed. Remaining instructions were paused.");
        return;
      }
      // Find the first staged ship that matches any offered move option
      if (
        workspace.draft &&
        planRef.current.remainingShips.some((ship, index, ships) => {
          const deferredIonian =
            ship.ionian &&
            !ship.gravityDrive &&
            ships.slice(0, index).some((earlier) => earlier.gravityDrive);
          return !currentChoice.options.some((option) => {
            const p = getMovementPayload(option);
            const sameHull =
              option.kind === "move" &&
              p.origin === ship.origin &&
              p.unit?.toLowerCase() === ship.unitType.toLowerCase() &&
              Boolean(p.damaged) === ship.damaged;
            const exactBoost =
              (option.payload?.gravity_drive === true) === !!ship.gravityDrive &&
              (option.payload?.ionian === true) === !!ship.ionian;
            return (
              sameHull &&
              (exactBoost ||
                (deferredIonian &&
                  option.payload?.gravity_drive === true &&
                  option.payload?.ionian !== true))
            );
          });
        })
      ) {
        planRef.current.active = false;
        setIsExecuting(false);
        setLocalError(
          "A selected ship is no longer offered. Remaining movement instructions were paused.",
        );
        return;
      }
      let matchedShipIdx = -1;
      let matchedShipOpt: (typeof currentChoice.options)[0] | null = null;

      for (let i = 0; i < planRef.current.remainingShips.length; i++) {
        // Recorded editor instructions are ordered: later boost offers may
        // only become legal after this instruction has executed.
        if (workspace.draft && i > 0) break;
        const ship = planRef.current.remainingShips[i];
        const matches = currentChoice.options.filter((o) => {
          if (o.kind !== "move") return false;
          const p = getMovementPayload(o);
          return (
            p.origin === ship.origin &&
            Boolean(p.damaged) === ship.damaged &&
            (!workspace.draft ||
              ((o.payload?.gravity_drive === true) === !!ship.gravityDrive &&
                (o.payload?.ionian === true) === !!ship.ionian)) &&
            (p.unit?.toLowerCase() === ship.unitType.toLowerCase() ||
              (!workspace.draft &&
                getUnitBaseType(p.unit ?? "") === getUnitBaseType(ship.unitType)))
          );
        });

        if (workspace.draft && matches.length > 1) {
          planRef.current.active = false;
          setIsExecuting(false);
          setLocalError(
            "Selected ship has an ambiguous option. Remaining movement instructions were paused.",
          );
          return;
        }
        const opt = matches[0];

        if (opt) {
          matchedShipIdx = i;
          matchedShipOpt = opt;
          break;
        }
      }

      if (matchedShipOpt && matchedShipIdx !== -1) {
        const ship = planRef.current.remainingShips[matchedShipIdx];
        planRef.current.submitting = true;
        planRef.current.lastSubmittedNonce = currentChoice.nonce;
        try {
          await onSubmit(matchedShipOpt.id);
          if (planRef.current !== execution) return;
          planRef.current.remainingShips.splice(matchedShipIdx, 1);
          planRef.current.currentShipOrigin = ship.origin;
          planRef.current.currentShipCapacity = ship.capacity;
          planRef.current.currentShipLoadedCount = 0;
        } catch (err) {
          if (planRef.current !== execution) return;
          if (err instanceof PlanningRefreshError) {
            planRef.current.lastSubmittedNonce = null;
            return;
          }
          planRef.current.active = false;
          setIsExecuting(false);
          setLocalError(err instanceof Error ? err.message : String(err));
        } finally {
          if (planRef.current === execution) {
            planRef.current.submitting = false;
            advance();
          }
        }
        return;
      }

      if (planRef.current.remainingShips.length > 0) {
        planRef.current.active = false;
        setIsExecuting(false);
        setLocalError(
          "A selected ship is no longer offered. Remaining movement instructions were paused.",
        );
        return;
      }
      // No ships left to move: conclude movement
      if (planRef.current.remainingCargo.length > 0) {
        planRef.current.active = false;
        setIsExecuting(false);
        setLocalError(
          "Some selected cargo could not be loaded. Review the remaining movement options.",
        );
        return;
      }
      const doneOpt = currentChoice.options.find(
        (o) => o.id === "done_moving" || o.kind === "decline",
      );
      if (doneOpt) {
        planRef.current.submitting = true;
        planRef.current.lastSubmittedNonce = currentChoice.nonce;
        try {
          await onSubmit(doneOpt.id);
          if (planRef.current !== execution) return;
          planRef.current.active = false;
          setIsExecuting(false);
        } catch (err) {
          if (planRef.current !== execution) return;
          if (err instanceof PlanningRefreshError) {
            planRef.current.lastSubmittedNonce = null;
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          planRef.current.active = false;
          setIsExecuting(false);
          setLocalError(msg);
        } finally {
          if (planRef.current === execution) {
            planRef.current.submitting = false;
            advance();
          }
        }
      } else {
        planRef.current.active = false;
        setIsExecuting(false);
        setLocalError("Movement ended before a finish option was offered.");
      }
      return;
    }

    if (subtype === "load_cargo") {
      const origin = planRef.current.currentShipOrigin;
      const capacity = planRef.current.currentShipCapacity;
      const loaded = planRef.current.currentShipLoadedCount;

      if (loaded < capacity && origin) {
        let matchedCargoIdx = -1;
        let matchedCargoOpt: (typeof currentChoice.options)[0] | null = null;

        for (let i = 0; i < planRef.current.remainingCargo.length; i++) {
          const item = planRef.current.remainingCargo[i];
          if (item.origin !== origin) continue;

          const matches = currentChoice.options.filter((o) => {
            if (o.kind !== "load") return false;
            const pUnit = String(o.payload?.unit ?? o.label);
            const pSource = typeof o.payload?.source === "string" ? o.payload.source : null;
            const matchesUnit =
              pUnit.toLowerCase() === item.unitType.toLowerCase() ||
              (!workspace.draft && getUnitBaseType(pUnit) === getUnitBaseType(item.unitType));
            const matchesSource = pSource === item.source;
            const matchesGalvanized =
              item.galvanized === undefined || (o.payload?.galvanized === true) === item.galvanized;
            return (
              matchesUnit &&
              (typeof o.payload?.pickup_system !== "string" ||
                o.payload.pickup_system === (item.pickupSystem ?? item.origin)) &&
              matchesSource &&
              matchesGalvanized &&
              (o.payload?.damaged === true) === item.damaged
            );
          });

          if (matches.length > 1) {
            planRef.current.active = false;
            setIsExecuting(false);
            setLocalError(
              "Selected cargo has an ambiguous option. Remaining movement instructions were paused.",
            );
            return;
          }
          const opt = matches[0];
          if (opt) {
            matchedCargoIdx = i;
            matchedCargoOpt = opt;
            break;
          }
        }

        if (matchedCargoOpt && matchedCargoIdx !== -1) {
          planRef.current.submitting = true;
          planRef.current.lastSubmittedNonce = currentChoice.nonce;
          try {
            await onSubmit(matchedCargoOpt.id);
            if (planRef.current !== execution) return;
            planRef.current.remainingCargo.splice(matchedCargoIdx, 1);
            planRef.current.currentShipLoadedCount += 1;
          } catch (err) {
            if (planRef.current !== execution) return;
            if (err instanceof PlanningRefreshError) {
              planRef.current.lastSubmittedNonce = null;
              return;
            }
            planRef.current.active = false;
            setIsExecuting(false);
            setLocalError(err instanceof Error ? err.message : String(err));
          } finally {
            if (planRef.current === execution) {
              planRef.current.submitting = false;
              advance();
            }
          }
          return;
        }
        if (planRef.current.remainingCargo.some((item) => item.origin === origin)) {
          planRef.current.active = false;
          setIsExecuting(false);
          setLocalError("Selected cargo is no longer offered for this ship.");
          return;
        }
      }

      // Done loading this hold
      const doneOpt = currentChoice.options.find(
        (o) => o.id === "done_loading" || o.kind === "decline",
      );
      if (doneOpt) {
        planRef.current.submitting = true;
        planRef.current.lastSubmittedNonce = currentChoice.nonce;
        try {
          await onSubmit(doneOpt.id);
          if (planRef.current !== execution) return;
        } catch (err) {
          if (planRef.current !== execution) return;
          if (err instanceof PlanningRefreshError) {
            planRef.current.lastSubmittedNonce = null;
            return;
          }
          planRef.current.active = false;
          setIsExecuting(false);
          setLocalError(err instanceof Error ? err.message : String(err));
        } finally {
          if (planRef.current === execution) {
            planRef.current.submitting = false;
            advance();
          }
        }
      } else {
        planRef.current.active = false;
        setIsExecuting(false);
        setLocalError("Cargo loading ended before a finish option was offered.");
      }
      return;
    }
  };

  useEffect(() => {
    if (
      workspace.actionable &&
      !onSubmitBatch &&
      choice &&
      planRef.current.active &&
      !planRef.current.submitting
    ) {
      void stepExecution(choice);
    }
  }, [choice?.nonce, isExecuting, executionStep, parentExecutionStep, workspace.actionable]);

  const handleCommitMoves = async () => {
    if (!workspace.actionable) return;
    if (unavailableStaging) {
      setLocalError(
        "A staged ship or cargo is no longer available. Review your selections before moving.",
      );
      return;
    }
    if (totalUnitsStaged === 0) {
      await submitFinish();
      return;
    }
    setLocalError(null);

    if (hasAnyOriginOverCapacity) {
      setLocalError("Cargo exceeds transport capacity in one or more origin systems.");
      return;
    }

    // Collect capital ships to move
    const ships: ExecutionPlan["remainingShips"] = [];
    for (const g of shipGroups) {
      if (!workspace.draft && (g.isFighter || g.isGroundForce)) continue;
      const key = movementShipKey(
        g.originSystemId,
        g.unitType,
        g.damaged,
        g.gravityDrive,
        g.ionian,
      );
      const count = stagedMoves[key] ?? 0;
      for (let i = 0; i < count; i++) {
        ships.push({
          origin: g.originSystemId,
          unitType: g.unitType,
          capacity: g.capacityPerUnit,
          damaged: g.damaged,
          gravityDrive: g.gravityDrive,
          ionian: g.ionian,
        });
      }
    }

    const recordedOrder = (ship: ExecutionPlan["remainingShips"][number]) =>
      workspace.movementEdit?.decisions.findIndex(
        (d) =>
          d.kind === "move" &&
          d.payload.origin === ship.origin &&
          d.payload.unit === ship.unitType &&
          (d.payload.damaged === true) === ship.damaged &&
          (d.payload.gravity_drive === true) === !!ship.gravityDrive &&
          (d.payload.ionian === true) === !!ship.ionian,
      ) ?? -1;
    if (workspace.movementEdit)
      ships.sort((a, b) => {
        const ai = recordedOrder(a),
          bi = recordedOrder(b);
        return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
      });

    // Collect cargo to load
    const cargo: ExecutionPlan["remainingCargo"] = [];
    for (const c of originCargoGroups) {
      const key = movementCargoKey(c.originSystemId, c.unitType, c.source, c.damaged, c.galvanized);
      const count = stagedMoves[key] ?? 0;
      for (let i = 0; i < count; i++) {
        cargo.push({
          origin: c.carrierOrigin ?? c.originSystemId,
          pickupSystem: c.originSystemId,
          unitType: c.unitType,
          source: c.source,
          damaged: c.damaged,
          galvanized: c.galvanized,
        });
      }
    }
    for (const g of shipGroups) {
      if (workspace.draft || (!g.isFighter && !g.isGroundForce)) continue;
      const key = movementShipKey(
        g.originSystemId,
        g.unitType,
        g.damaged,
        g.gravityDrive,
        g.ionian,
      );
      const count = stagedMoves[key] ?? 0;
      for (let i = 0; i < count; i++) {
        cargo.push({
          origin: g.originSystemId,
          unitType: g.unitType,
          source: null,
          damaged: g.damaged,
        });
      }
    }

    planRef.current = {
      active: true,
      destination: destinationSystemId,
      actor: choice?.actor ?? null,
      remainingShips: ships,
      remainingCargo: cargo,
      currentShipOrigin: null,
      currentShipCapacity: 0,
      currentShipLoadedCount: 0,
      submitting: false,
      lastSubmittedNonce: null,
    };
    if (ships.length === 0 && cargo.length > 0) {
      planRef.current.active = false;
      setLocalError("Select a ship to carry the staged cargo.");
      return;
    }
    if (onSubmitBatch && destinationSystemId) {
      const steps: MovementStep[] = [];
      const remaining = [...cargo];
      const remainingCandidatesByOrigin: Record<string, number> = {};
      for (const ship of ships) {
        if (remainingCandidatesByOrigin[ship.origin] === undefined) {
          let count = 0;
          const units = board?.systems?.[ship.origin]?.units ?? [];
          for (const u of units) {
            if (u.owner !== choice?.actor) continue;
            const base = getUnitBaseType(u.unit_type);
            if (base === "infantry" || base === "mech" || base === "fighter") {
              count++;
            }
          }
          if (count === 0) {
            for (const c of originCargoGroups) {
              if (c.originSystemId === ship.origin) {
                count += c.totalAvailable;
              }
            }
          }
          remainingCandidatesByOrigin[ship.origin] = count;
        }
      }

      for (const ship of ships) {
        steps.push({
          kind: "move",
          origin: ship.origin,
          unit: ship.unitType,
          damaged: ship.damaged,
        });
        const candidatesBefore = remainingCandidatesByOrigin[ship.origin] ?? 0;
        let loaded = 0;
        while (loaded < ship.capacity) {
          const index = remaining.findIndex((item) => item.origin === ship.origin);
          if (index < 0) break;
          const item = remaining.splice(index, 1)[0];
          steps.push({
            kind: "load",
            origin: item.origin,
            unit: item.unitType,
            source: item.source,
            damaged: item.damaged,
            ...(item.galvanized === undefined ? {} : { galvanized: item.galvanized }),
          });
          loaded++;
        }
        remainingCandidatesByOrigin[ship.origin] = Math.max(0, candidatesBefore - loaded);

        if (
          ship.capacity > 0 &&
          candidatesBefore > 0 &&
          loaded < ship.capacity &&
          loaded < candidatesBefore
        ) {
          steps.push({ kind: "done_loading" });
        }
      }
      if (remaining.length) {
        planRef.current.active = false;
        setLocalError("Some selected cargo could not fit on the staged ships.");
        return;
      }
      steps.push({ kind: "done_moving" });
      setIsExecuting(true);
      try {
        await onSubmitBatch(destinationSystemId, steps);
        setStagedMoves({});
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : String(error));
      } finally {
        planRef.current.active = false;
        setIsExecuting(false);
      }
      return;
    }
    setIsExecuting(true);
    if (choice) {
      stepExecution(choice);
    }
  };

  if (!isOpen || !choice) return null;

  return (
    <aside
      role="region"
      aria-label="Tactical Fleet Rally Tray"
      data-testid="tactical-movement-tray"
      className="fleet-rally-tray panel"
    >
      {workspace.actionable && unavailableStaging && (
        <div role="alert">
          A staged ship or cargo is no longer available. Review your selections before moving.
          <ul>
            {unavailableSelections.map(([key, count]) => (
              <li key={key}>
                {key.replaceAll(":", " · ")} · Selected: {count}
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    setStagedMoves((current) => ({
                      ...current,
                      [key]: availableStaging.get(key) ?? 0,
                    }))
                  }
                >
                  Remove unavailable selection
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button"
            onClick={() => {
              setStagedMoves({});
              setLocalError(null);
            }}
          >
            Clear staging
          </button>
        </div>
      )}
      <DecisionHeader
        actor={choice.actor}
        title="Move Units"
        instruction={
          planRef.current.active
            ? "Moving selected fleet and loading cargo…"
            : choice.prompt && choice.prompt !== "movement"
              ? choice.prompt
              : "Select ships and cargo to rally into the active system"
        }
        progress={
          destinationSystemId && !isCargoStep
            ? `Destination: system ${destinationSystemId}`
            : undefined
        }
        onMinimize={onClose}
        minimizeTestId="close-movement-tray"
      />

      {/* Gauges */}
      <div className="fleet-rally-tray__gauges">
        {!isCargoStep && (
          <div
            data-testid="fleet-supply-gauge"
            className="workflow-card"
            data-warning={isOverFleetSupply ? "true" : undefined}
          >
            <div className="workflow-card--row">
              <span className="text-muted">Fleet Supply:</span>
              <span
                className="fleet-rally-tray__status"
                data-warning={isOverFleetSupply}
                data-alert={false}
              >
                {totalProjectedFleet} / {fleetTokens ?? "unknown"} Ships
              </span>
            </div>
            {isOverFleetSupply && (
              <div className="fleet-rally-tray__advisory">
                Exceeds fleet limit ({totalProjectedFleet}/{fleetTokens}) — excess ships must be
                lost in combat or destroyed after movement.
              </div>
            )}
          </div>
        )}
      </div>

      {planRef.current.active ? (
        <div className="workflow-card" data-testid="movement-progress">
          Moving selected fleet and loading cargo…
        </div>
      ) : (
        /* Movement & Cargo grouped by Origin System */
        <div className="fleet-rally-tray__list">
          {originSystemIds.length === 0 ? (
            <div className="text-muted">No ships eligible to move into the active system.</div>
          ) : (
            originSystemIds.map((originId) => {
              const shipsForOrigin = shipGroups.filter(
                (g) =>
                  g.originSystemId === originId &&
                  (workspace.draft ||
                    !g.isFighter ||
                    !originCargoGroups.some(
                      (cargo) =>
                        cargo.originSystemId === g.originSystemId &&
                        cargo.unitType === g.unitType &&
                        cargo.damaged === g.damaged &&
                        cargo.source === null,
                    )),
              );
              const cargoForOrigin = originCargoGroups.filter((c) => c.originSystemId === originId);
              const originCap = capacityByOrigin[originId] ?? 0;
              const originCargo = cargoByOrigin[originId] ?? 0;
              const isOriginOverCapacity = originCargo > originCap;

              return (
                <div
                  key={originId}
                  data-testid={`origin-group-${originId}`}
                  className="origin-system-group"
                  data-alert={isOriginOverCapacity ? "true" : undefined}
                >
                  <div className="origin-system-group__header">
                    <span className="origin-system-group__title">Origin: System #{originId}</span>
                    <span
                      data-testid={`cargo-capacity-gauge-${originId}`}
                      className="fleet-rally-tray__status"
                      data-alert={isOriginOverCapacity}
                      data-warning={false}
                    >
                      Cargo Capacity: {originCargo} / {originCap} Loaded
                    </span>
                  </div>

                  {isOriginOverCapacity && (
                    <div
                      className="fleet-rally-tray__advisory"
                      style={{ color: "var(--color-danger)" }}
                    >
                      Exceeds origin cargo capacity ({originCargo}/{originCap}) — remove excess
                      cargo or stage more transport capacity.
                    </div>
                  )}

                  {shipsForOrigin.length > 0 && (
                    <>
                      <div className="origin-system-group__section-title">Ships</div>
                      {shipsForOrigin.map((g) => {
                        const key = movementShipKey(
                          g.originSystemId,
                          g.unitType,
                          g.damaged,
                          g.gravityDrive,
                          g.ionian,
                        );
                        const variant = `${g.damaged ? "-damaged" : ""}${g.gravityDrive ? "-gravity-drive" : ""}${g.ionian ? "-ionian" : ""}`;
                        const count = stagedMoves[key] ?? 0;

                        return (
                          <div
                            key={key}
                            data-testid={`rally-row-${g.originSystemId}-${g.unitType}${variant}`}
                            className="workflow-card workflow-card--row"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                              <UnitIcon type={g.unitType} size={22} />
                              <div>
                                <div className="workflow-unit-name">
                                  {getUnitDisplayName(g.unitType)}
                                  {g.damaged ? " (Damaged)" : ""}
                                  {workspace.draft && (g.isFighter || g.isGroundForce)
                                    ? " (Independent move)"
                                    : ""}
                                  {g.gravityDrive ? " · Gravity Drive" : ""}
                                  {g.ionian ? " · Ionian Fuel Refinery" : ""}
                                </div>
                                <div className="text-muted">
                                  Origin: #{g.originSystemId} • Available: {g.totalAvailable}
                                  {g.capacityPerUnit > 0 && ` • Capacity: ${g.capacityPerUnit}`}
                                </div>
                              </div>
                            </div>

                            <div className="workflow-row">
                              <button
                                type="button"
                                data-testid={`rally-dec-${g.originSystemId}-${g.unitType}${variant}`}
                                onClick={() => handleUpdateCount(key, -1, g.totalAvailable)}
                                disabled={count <= 0 || isExecuting || isDirectSubmitting}
                                className="button button--secondary button--icon workflow-button--stepper"
                              >
                                -
                              </button>
                              <span
                                data-testid={`rally-count-${g.originSystemId}-${g.unitType}${variant}`}
                                className="workflow-count"
                              >
                                {count}
                              </span>
                              <button
                                type="button"
                                data-testid={`rally-inc-${g.originSystemId}-${g.unitType}${variant}`}
                                onClick={() => handleUpdateCount(key, 1, g.totalAvailable)}
                                disabled={
                                  count >= g.totalAvailable || isExecuting || isDirectSubmitting
                                }
                                className="button button--secondary button--icon workflow-button--stepper"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {cargoForOrigin.length > 0 && (
                    <>
                      <div className="origin-system-group__section-title">Carryable Cargo</div>
                      {cargoForOrigin.map((c) => {
                        const key = movementCargoKey(
                          c.originSystemId,
                          c.unitType,
                          c.source,
                          c.damaged,
                          c.galvanized,
                        );
                        const count = stagedMoves[key] ?? 0;

                        return (
                          <div
                            key={key}
                            data-testid={`rally-row-cargo-${c.originSystemId}-${c.unitType}-${c.source ?? "space"}${c.galvanized ? "-galvanized" : ""}`}
                            className="workflow-card workflow-card--row"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                              <UnitIcon type={c.unitType} size={18} />
                              <div>
                                <div className="workflow-unit-name">
                                  {getUnitDisplayName(c.unitType)}
                                  {c.damaged ? " (Damaged)" : ""}
                                  {c.galvanized ? " (Galvanized)" : ""}
                                </div>
                                <div className="text-muted">
                                  Origin: #{c.originSystemId} ({c.source ?? "Space"}) • Available:{" "}
                                  {c.totalAvailable}
                                </div>
                              </div>
                            </div>

                            <div className="workflow-row">
                              <button
                                type="button"
                                data-testid={`rally-dec-cargo-${c.originSystemId}-${c.unitType}-${c.source ?? "space"}${c.galvanized ? "-galvanized" : ""}`}
                                onClick={() => handleUpdateCount(key, -1, c.totalAvailable)}
                                disabled={count <= 0 || isExecuting || isDirectSubmitting}
                                className="button button--secondary button--icon workflow-button--stepper"
                              >
                                -
                              </button>
                              <span
                                data-testid={`rally-count-cargo-${c.originSystemId}-${c.unitType}-${c.source ?? "space"}${c.galvanized ? "-galvanized" : ""}`}
                                className="workflow-count"
                              >
                                {count}
                              </span>
                              <button
                                type="button"
                                data-testid={`rally-inc-cargo-${c.originSystemId}-${c.unitType}-${c.source ?? "space"}${c.galvanized ? "-galvanized" : ""}`}
                                onClick={() => handleUpdateCount(key, 1, c.totalAvailable)}
                                disabled={
                                  count >= c.totalAvailable || isExecuting || isDirectSubmitting
                                }
                                className="button button--secondary button--icon workflow-button--stepper"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {(localError || lastError) && (
        <div data-testid="movement-error-banner" role="alert" className="workflow-error">
          {localError || lastError}
        </div>
      )}

      {/* Action Footer */}
      <div className="workflow-actions">
        {hasAnyOriginOverCapacity && (
          <div className="fleet-rally-tray__advisory" style={{ color: "var(--color-danger)" }}>
            Cannot commit moves: cargo exceeds transport capacity in one or more origin systems.
          </div>
        )}
        {totalUnitsStaged > 0 && !isExecuting && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setStagedMoves({})}
          >
            Reset selection
          </button>
        )}
        {totalUnitsStaged > 1 && !onSubmitBatch && (
          <p>Moves and cargo loading are committed sequentially.</p>
        )}
        {doneMovingOption && (
          <button
            type="button"
            data-testid="finish-movement-btn"
            onClick={submitFinish}
            disabled={isExecuting || isDirectSubmitting}
            className="button button--secondary workflow-button--wide"
          >
            {doneMovingOption.label || (isCargoStep ? "Done Loading" : "Finish Movement")}
          </button>
        )}

        <button
          type="button"
          data-testid="commit-moves-btn"
          onClick={handleCommitMoves}
          disabled={
            isExecuting ||
            isDirectSubmitting ||
            unavailableStaging ||
            (totalUnitsStaged > 0 && hasAnyOriginOverCapacity)
          }
          className="button button--primary workflow-button--wide"
        >
          {isExecuting || isDirectSubmitting
            ? "Moving Fleet..."
            : totalUnitsStaged > 0
              ? `Commit Moves (${totalUnitsStaged})`
              : "Done Moving"}
        </button>
      </div>
    </aside>
  );
};
