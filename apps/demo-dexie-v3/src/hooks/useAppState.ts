/**
 * App State Hook - v3 API with clean hooks
 *
 * Dramatically simplified using @effstate/react/v3 hooks.
 */

import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useActor, useActorWatch, useActorSync } from "@effstate/react/v3";
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
  type DoorState,
  type DoorContext,
  type DoorEvent,
} from "@/machines";
import {
  db,
  STATE_ID,
  serializeHamster,
  serializeDoor,
  deserializeHamsterState,
  deserializeHamsterContext,
  deserializeDoorState,
  deserializeDoorContext,
} from "@/lib/db";

// Re-export helpers for UI
export { getHamsterStateLabel, getHamsterButtonLabel, getDoorStateLabel, getDoorButtonLabel };

// ============================================================================
// Weather Fetching (app-specific, not library concern)
// ============================================================================

async function fetchWeather() {
  const response = await fetch(
    "https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&current=temperature_2m,weather_code&temperature_unit=fahrenheit"
  );
  if (!response.ok) throw new Error("Failed to fetch weather");
  const data = await response.json();

  const code = data.current.weather_code;
  const info = code === 0 ? { desc: "Clear", icon: "☀️" }
    : code <= 3 ? { desc: "Cloudy", icon: "⛅" }
    : code <= 69 ? { desc: "Rain", icon: "🌧️" }
    : { desc: "Unknown", icon: "❓" };

  return { temp: Math.round(data.current.temperature_2m), ...info };
}

// ============================================================================
// Leader Election (app-specific, not library concern)
// ============================================================================

function useLeaderElection() {
  const [isLeader, setIsLeader] = useState(false);

  useEffect(() => {
    const key = "effstate-v3-leader";
    const id = Math.random().toString(36).slice(2);

    const check = () => {
      const leader = localStorage.getItem(key);
      if (!leader || leader === id) {
        localStorage.setItem(key, id);
        setIsLeader(true);
      } else {
        setIsLeader(false);
      }
    };

    check();
    window.addEventListener("focus", check);
    window.addEventListener("storage", (e) => e.key === key && check());
    window.addEventListener("beforeunload", () => {
      if (localStorage.getItem(key) === id) localStorage.removeItem(key);
    });

    return () => window.removeEventListener("focus", check);
  }, []);

  return isLeader;
}

// ============================================================================
// Weather Hook (watches door state, fetches weather when open)
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

// ============================================================================
// Main Hook
// ============================================================================

export function useAppState() {
  const isLeader = useLeaderElection();

  // Create actors using the clean useActor hook
  const hamster = useActor(hamsterWheelMachine);
  const leftDoor = useActor(garageDoorMachine);
  const rightDoor = useActor(garageDoorMachine);

  // Power sync: when hamster power changes, notify doors
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

  // Persistence: sync with Dexie
  const savedState = useLiveQuery(() => db.appState.get(STATE_ID), []);

  useActorSync(hamster.actor, savedState?.hamster, {
    isLeader,
    serialize: (snap) => serializeHamster(snap.state, snap.context),
    deserialize: (s) => ({ state: deserializeHamsterState(s), context: deserializeHamsterContext(s) }),
    onSave: async (h) => {
      await db.appState.put({
        id: STATE_ID,
        hamster: h,
        leftDoor: serializeDoor(leftDoor.state, leftDoor.context),
        rightDoor: serializeDoor(rightDoor.state, rightDoor.context),
        updatedAt: new Date(),
      });
    },
  });

  useActorSync(leftDoor.actor, savedState?.leftDoor, {
    isLeader,
    serialize: (snap) => serializeDoor(snap.state, snap.context),
    deserialize: (s) => ({ state: deserializeDoorState(s), context: deserializeDoorContext(s) }),
    onSave: async (l) => {
      await db.appState.put({
        id: STATE_ID,
        hamster: serializeHamster(hamster.state, hamster.context),
        leftDoor: l,
        rightDoor: serializeDoor(rightDoor.state, rightDoor.context),
        updatedAt: new Date(),
      });
    },
  });

  useActorSync(rightDoor.actor, savedState?.rightDoor, {
    isLeader,
    serialize: (snap) => serializeDoor(snap.state, snap.context),
    deserialize: (s) => ({ state: deserializeDoorState(s), context: deserializeDoorContext(s) }),
    onSave: async (r) => {
      await db.appState.put({
        id: STATE_ID,
        hamster: serializeHamster(hamster.state, hamster.context),
        leftDoor: serializeDoor(leftDoor.state, leftDoor.context),
        rightDoor: r,
        updatedAt: new Date(),
      });
    },
  });

  return {
    state: {
      hamster: { state: hamster.state, context: hamster.context },
      leftDoor: { state: leftDoor.state, context: leftDoor.context },
      rightDoor: { state: rightDoor.state, context: rightDoor.context },
    },
    isLoading: false,
    isLeader,
    toggleHamster: useCallback(() => hamster.send(new Toggle()), [hamster]),
    clickDoor: useCallback(
      (door: "left" | "right") => (door === "left" ? leftDoor : rightDoor).send(new Click()),
      [leftDoor, rightDoor]
    ),
  };
}
