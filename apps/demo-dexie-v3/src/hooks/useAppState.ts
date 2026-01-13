/**
 * App State Hook - v3 API with Dexie Persistence
 *
 * Uses the clean PersistenceAdapter pattern.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useActor, useActorWatch, usePersistence } from "@effstate/react/v3";
import type { MachineSnapshot } from "effstate/v3";
import {
  hamsterWheelMachine,
  garageDoorMachine,
  Toggle,
  Click,
  PowerOn,
  PowerOff,
  WeatherLoaded,
  WeatherError,
  getHamsterStateLabel,
  getHamsterButtonLabel,
  getDoorStateLabel,
  getDoorButtonLabel,
  type HamsterState,
  type HamsterContext,
  type DoorState,
  type DoorContext,
  type DoorEvent,
} from "@/machines";
import {
  serializeHamster,
  serializeDoor,
  deserializeHamsterState,
  deserializeHamsterContext,
  deserializeDoorState,
  deserializeDoorContext,
} from "@/lib/db";
import {
  createDexieAdapter,
  useDexieLiveQuery,
  isLeader,
  type SerializedAppState,
} from "@/lib/dexie-adapter";

// Re-export UI helpers
export { getHamsterStateLabel, getHamsterButtonLabel, getDoorStateLabel, getDoorButtonLabel };

// ============================================================================
// Weather Fetching
// ============================================================================

async function fetchWeather() {
  const res = await fetch(
    "https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&current=temperature_2m,weather_code&temperature_unit=fahrenheit"
  );
  if (!res.ok) throw new Error("Failed to fetch");
  const data = await res.json();
  const code = data.current.weather_code;
  const info = code === 0 ? { desc: "Clear", icon: "☀️" }
    : code <= 3 ? { desc: "Cloudy", icon: "⛅" }
    : code <= 69 ? { desc: "Rain", icon: "🌧️" }
    : { desc: "Unknown", icon: "❓" };
  return { temp: Math.round(data.current.temperature_2m), ...info };
}

// ============================================================================
// Adapter (module level)
// ============================================================================

const dexieAdapter = createDexieAdapter();

// ============================================================================
// Initial State Hook (loads once)
// ============================================================================

type InitialSnapshots = {
  hamster: MachineSnapshot<HamsterState, HamsterContext>;
  leftDoor: MachineSnapshot<DoorState, DoorContext>;
  rightDoor: MachineSnapshot<DoorState, DoorContext>;
} | null;

function useInitialLoad(): { loaded: boolean; snapshots: InitialSnapshots } {
  const [result, setResult] = useState<{ loaded: boolean; snapshots: InitialSnapshots }>({
    loaded: false,
    snapshots: null,
  });

  useEffect(() => {
    dexieAdapter.load().then((saved) => {
      if (saved) {
        setResult({
          loaded: true,
          snapshots: {
            hamster: {
              state: deserializeHamsterState(saved.hamster),
              context: deserializeHamsterContext(saved.hamster),
            },
            leftDoor: {
              state: deserializeDoorState(saved.leftDoor),
              context: deserializeDoorContext(saved.leftDoor),
            },
            rightDoor: {
              state: deserializeDoorState(saved.rightDoor),
              context: deserializeDoorContext(saved.rightDoor),
            },
          },
        });
      } else {
        setResult({ loaded: true, snapshots: null });
      }
    });
  }, []);

  return result;
}

// ============================================================================
// Return type
// ============================================================================

export type AppStateResult = {
  state: {
    hamster: { state: HamsterState; context: HamsterContext };
    leftDoor: { state: DoorState; context: DoorContext };
    rightDoor: { state: DoorState; context: DoorContext };
  } | null;
  isLoading: boolean;
  isLeader: boolean;
  toggleHamster: () => void;
  clickDoor: (door: "left" | "right") => void;
};

// ============================================================================
// Main Hook
// ============================================================================

export function useAppState(): AppStateResult {
  const { loaded, snapshots } = useInitialLoad();

  // Create actors with initial snapshots (or defaults)
  const hamster = useActor(hamsterWheelMachine, snapshots?.hamster ? {
    initialSnapshot: snapshots.hamster,
  } : undefined);

  const leftDoor = useActor(garageDoorMachine, snapshots?.leftDoor ? {
    initialSnapshot: snapshots.leftDoor,
  } : undefined);

  const rightDoor = useActor(garageDoorMachine, snapshots?.rightDoor ? {
    initialSnapshot: snapshots.rightDoor,
  } : undefined);

  // Track if we've synced initial state
  const didSyncRef = useRef(false);

  // After load, sync actors if we loaded saved state but actors were created with defaults
  useEffect(() => {
    if (!loaded || didSyncRef.current || !snapshots) return;
    didSyncRef.current = true;

    // Sync loaded state to actors
    hamster.actor._syncSnapshot(snapshots.hamster);
    leftDoor.actor._syncSnapshot(snapshots.leftDoor);
    rightDoor.actor._syncSnapshot(snapshots.rightDoor);
  }, [loaded, snapshots, hamster.actor, leftDoor.actor, rightDoor.actor]);

  // Serialize current state
  const serialize = useCallback((): SerializedAppState => ({
    hamster: serializeHamster(hamster.state, hamster.context),
    leftDoor: serializeDoor(leftDoor.state, leftDoor.context),
    rightDoor: serializeDoor(rightDoor.state, rightDoor.context),
  }), [hamster.state, hamster.context, leftDoor.state, leftDoor.context, rightDoor.state, rightDoor.context]);

  // Apply external state
  const applyExternal = useCallback((state: SerializedAppState) => {
    hamster.actor._syncSnapshot({
      state: deserializeHamsterState(state.hamster),
      context: deserializeHamsterContext(state.hamster),
    });
    leftDoor.actor._syncSnapshot({
      state: deserializeDoorState(state.leftDoor),
      context: deserializeDoorContext(state.leftDoor),
    });
    rightDoor.actor._syncSnapshot({
      state: deserializeDoorState(state.rightDoor),
      context: deserializeDoorContext(state.rightDoor),
    });
  }, [hamster.actor, leftDoor.actor, rightDoor.actor]);

  // Subscribe to actor changes
  const subscribeToActors = useCallback((callback: () => void) => {
    const unsubs = [
      hamster.actor.subscribe(callback),
      leftDoor.actor.subscribe(callback),
      rightDoor.actor.subscribe(callback),
    ];
    return () => unsubs.forEach((u) => u());
  }, [hamster.actor, leftDoor.actor, rightDoor.actor]);

  // Wire up persistence (only after loaded to avoid overwriting with defaults)
  usePersistence({
    adapter: loaded ? dexieAdapter : { save: () => {}, subscribe: () => () => {}, isLeader: () => false },
    serialize,
    applyExternal,
    subscribeToActors,
  });

  // Connect Dexie liveQuery for cross-tab sync
  useDexieLiveQuery(dexieAdapter, applyExternal);

  // Power sync: hamster → doors
  useActorWatch(
    hamster.actor,
    (snap) => snap.context.electricityLevel > 0,
    (isPowered) => {
      const event = isPowered ? new PowerOn() : new PowerOff();
      leftDoor.send(event);
      rightDoor.send(event);
    }
  );

  // Weather: fetch when doors open
  useWeatherOnOpen(leftDoor);
  useWeatherOnOpen(rightDoor);

  return {
    state: loaded ? {
      hamster: { state: hamster.state, context: hamster.context },
      leftDoor: { state: leftDoor.state, context: leftDoor.context },
      rightDoor: { state: rightDoor.state, context: rightDoor.context },
    } : null,
    isLoading: !loaded,
    isLeader: isLeader(),
    toggleHamster: useCallback(() => hamster.send(new Toggle()), [hamster]),
    clickDoor: useCallback(
      (door: "left" | "right") => (door === "left" ? leftDoor : rightDoor).send(new Click()),
      [leftDoor, rightDoor]
    ),
  };
}

// ============================================================================
// Weather Hook
// ============================================================================

function useWeatherOnOpen(door: {
  actor: ReturnType<typeof useActor<DoorState, DoorContext, DoorEvent, any>>["actor"];
  send: (event: DoorEvent) => void;
}) {
  useActorWatch(
    door.actor,
    (snap) => snap.state._tag === "Open" && snap.context.weather.status === "loading",
    (shouldFetch: boolean) => {
      if (shouldFetch) {
        fetchWeather()
          .then((w) => door.send(new WeatherLoaded(w)))
          .catch((e: Error) => door.send(new WeatherError({ message: e.message })));
      }
    }
  );
}
