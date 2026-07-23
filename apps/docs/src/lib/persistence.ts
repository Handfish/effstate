/**
 * Serialization helpers for the demo's cross-tab persistence.
 *
 * Each actor's snapshot ({ state, context }) is reduced to a small JSON-safe
 * object (the state tag plus the context values we care about) and rebuilt with
 * the schema-first `.make()` constructors on the way back in. Date fields are
 * re-stamped on restore since they don't affect the visible animation.
 */

import type { MachineSnapshot } from "@handfish/effstate-v4";
import {
  Idle,
  Running,
  Stopping,
  Closed,
  Opening,
  PausedOpening,
  Open,
  Closing,
  PausedClosing,
  type HamsterState,
  type HamsterContext,
  type DoorState,
  type DoorContext,
  type WeatherStatus,
} from "@/machines";

type HamsterSnapshot = MachineSnapshot<HamsterState, HamsterContext>;
type DoorSnapshot = MachineSnapshot<DoorState, DoorContext>;

// ============================================================================
// Serialized shapes (JSON-safe)
// ============================================================================

export interface SerializedHamster {
  stateTag: HamsterState["_tag"];
  wheelRotation: number;
  electricityLevel: number;
}

export interface SerializedDoor {
  stateTag: DoorState["_tag"];
  position: number;
  isPowered: boolean;
  weather: WeatherStatus;
}

// ============================================================================
// Hamster
// ============================================================================

export function serializeHamster(snapshot: HamsterSnapshot): SerializedHamster {
  return {
    stateTag: snapshot.state._tag,
    wheelRotation: snapshot.context.wheelRotation,
    electricityLevel: snapshot.context.electricityLevel,
  };
}

export function deserializeHamster(serialized: SerializedHamster): HamsterSnapshot {
  const now = new Date();
  const state: HamsterState =
    serialized.stateTag === "Running"
      ? Running.make({ startedAt: now })
      : serialized.stateTag === "Stopping"
        ? Stopping.make({ stoppingAt: now })
        : Idle.make();

  return {
    state,
    context: {
      wheelRotation: serialized.wheelRotation,
      electricityLevel: serialized.electricityLevel,
    },
  };
}

// ============================================================================
// Door
// ============================================================================

export function serializeDoor(snapshot: DoorSnapshot): SerializedDoor {
  return {
    stateTag: snapshot.state._tag,
    position: snapshot.context.position,
    isPowered: snapshot.context.isPowered,
    weather: snapshot.context.weather,
  };
}

export function deserializeDoor(serialized: SerializedDoor): DoorSnapshot {
  const now = new Date();
  const state: DoorState = (() => {
    switch (serialized.stateTag) {
      case "Opening": return Opening.make({ startedAt: now });
      case "PausedOpening": return PausedOpening.make({ pausedAt: now });
      case "Open": return Open.make({ openedAt: now });
      case "Closing": return Closing.make({ startedAt: now });
      case "PausedClosing": return PausedClosing.make({ pausedAt: now });
      default: return Closed.make();
    }
  })();

  return {
    state,
    context: {
      position: serialized.position,
      isPowered: serialized.isPowered,
      weather: serialized.weather,
    },
  };
}
