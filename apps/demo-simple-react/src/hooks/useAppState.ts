import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  STATE_ID,
  createInitialState,
  type AppState,
  type HamsterState,
  type GarageDoorState,
  type GarageDoorContext,
  type Weather,
} from "@/lib/db";

// Actions
type Action =
  | { type: "TOGGLE_HAMSTER" }
  | { type: "HAMSTER_TICK" }
  | { type: "STOP_COMPLETE" }
  | { type: "DOOR_CLICK"; door: "left" | "right" }
  | { type: "DOOR_TICK"; door: "left" | "right" }
  | { type: "DOOR_ANIMATION_COMPLETE"; door: "left" | "right" }
  | { type: "WEATHER_LOADING"; door: "left" | "right" }
  | { type: "WEATHER_LOADED"; door: "left" | "right"; weather: Weather }
  | { type: "WEATHER_ERROR"; door: "left" | "right"; error: string }
  | { type: "WAKE_HAMSTER" }
  | { type: "SYNC_STATE"; state: Omit<AppState, "id" | "updatedAt"> };

type State = Omit<AppState, "id" | "updatedAt">;

// Helper to get door key
const getDoorKey = (door: "left" | "right"): "leftDoor" | "rightDoor" =>
  door === "left" ? "leftDoor" : "rightDoor";

// Reducer
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "TOGGLE_HAMSTER": {
      const currentState = state.hamster.state;
      if (currentState === "idle" || currentState === "stopping") {
        return {
          ...state,
          hamster: {
            ...state.hamster,
            state: "running",
            electricityLevel: 100,
          },
        };
      } else if (currentState === "running") {
        return {
          ...state,
          hamster: {
            ...state.hamster,
            state: "stopping",
          },
        };
      }
      return state;
    }

    case "HAMSTER_TICK": {
      if (state.hamster.state !== "running") return state;
      return {
        ...state,
        hamster: {
          ...state.hamster,
          wheelRotation: (state.hamster.wheelRotation + 5) % 360,
        },
      };
    }

    case "STOP_COMPLETE": {
      if (state.hamster.state !== "stopping") return state;
      // When stopping completes, pause any animating doors
      const pauseDoor = (door: GarageDoorContext): GarageDoorContext => {
        if (door.state === "opening") {
          return { ...door, state: "pausedWhileOpening" };
        }
        if (door.state === "closing") {
          return { ...door, state: "pausedWhileClosing" };
        }
        return door;
      };
      return {
        ...state,
        hamster: {
          ...state.hamster,
          state: "idle",
          electricityLevel: 0,
        },
        leftDoor: pauseDoor(state.leftDoor),
        rightDoor: pauseDoor(state.rightDoor),
      };
    }

    case "WAKE_HAMSTER": {
      if (state.hamster.state === "idle") {
        // Resume any paused doors
        const resumeDoor = (door: GarageDoorContext): GarageDoorContext => {
          if (door.state === "pausedWhileOpening") {
            return { ...door, state: "opening" };
          }
          if (door.state === "pausedWhileClosing") {
            return { ...door, state: "closing" };
          }
          return door;
        };
        return {
          ...state,
          hamster: {
            ...state.hamster,
            state: "running",
            electricityLevel: 100,
          },
          leftDoor: resumeDoor(state.leftDoor),
          rightDoor: resumeDoor(state.rightDoor),
        };
      }
      return state;
    }

    case "DOOR_CLICK": {
      const doorKey = getDoorKey(action.door);
      const door = state[doorKey];
      const hasPower = state.hamster.electricityLevel > 0;
      if (!hasPower) return state;

      let newDoorState: GarageDoorState;
      switch (door.state) {
        case "closed":
          newDoorState = "opening";
          break;
        case "opening":
          newDoorState = "pausedWhileOpening";
          break;
        case "pausedWhileOpening":
          newDoorState = "closing";
          break;
        case "open":
          newDoorState = "closing";
          break;
        case "closing":
          newDoorState = "pausedWhileClosing";
          break;
        case "pausedWhileClosing":
          newDoorState = "opening";
          break;
        default:
          return state;
      }

      return {
        ...state,
        [doorKey]: {
          ...door,
          state: newDoorState,
        },
      };
    }

    case "DOOR_TICK": {
      const doorKey = getDoorKey(action.door);
      const door = state[doorKey];
      const hasPower = state.hamster.electricityLevel > 0;
      if (!hasPower) return state;

      if (door.state === "opening") {
        const newPosition = Math.min(door.position + 1, 100);
        return {
          ...state,
          [doorKey]: {
            ...door,
            position: newPosition,
          },
        };
      }
      if (door.state === "closing") {
        const newPosition = Math.max(door.position - 1, 0);
        return {
          ...state,
          [doorKey]: {
            ...door,
            position: newPosition,
          },
        };
      }
      return state;
    }

    case "DOOR_ANIMATION_COMPLETE": {
      const doorKey = getDoorKey(action.door);
      const door = state[doorKey];

      if (door.state === "opening" && door.position >= 100) {
        return {
          ...state,
          [doorKey]: {
            ...door,
            state: "open",
            position: 100,
          },
        };
      }
      if (door.state === "closing" && door.position <= 0) {
        return {
          ...state,
          [doorKey]: {
            ...door,
            state: "closed",
            position: 0,
            weather: { status: "idle" },
          },
        };
      }
      return state;
    }

    case "WEATHER_LOADING": {
      const doorKey = getDoorKey(action.door);
      return {
        ...state,
        [doorKey]: {
          ...state[doorKey],
          weather: { status: "loading" },
        },
      };
    }

    case "WEATHER_LOADED": {
      const doorKey = getDoorKey(action.door);
      return {
        ...state,
        [doorKey]: {
          ...state[doorKey],
          weather: { status: "loaded", data: action.weather },
        },
      };
    }

    case "WEATHER_ERROR": {
      const doorKey = getDoorKey(action.door);
      return {
        ...state,
        [doorKey]: {
          ...state[doorKey],
          weather: { status: "error", error: action.error },
        },
      };
    }

    case "SYNC_STATE":
      return action.state;

    default:
      return state;
  }
}

// Weather fetching
async function fetchWeather(): Promise<Weather> {
  const response = await fetch(
    "https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&current=temperature_2m,weather_code&temperature_unit=fahrenheit"
  );
  if (!response.ok) throw new Error("Failed to fetch weather");
  const data = await response.json();

  const weatherCode = data.current.weather_code;
  const { description, icon } = getWeatherInfo(weatherCode);

  return {
    temperature: Math.round(data.current.temperature_2m),
    description,
    icon,
  };
}

function getWeatherInfo(code: number): { description: string; icon: string } {
  if (code === 0) return { description: "Clear sky", icon: "☀️" };
  if (code <= 3) return { description: "Partly cloudy", icon: "⛅" };
  if (code <= 49) return { description: "Fog", icon: "🌫️" };
  if (code <= 59) return { description: "Drizzle", icon: "🌧️" };
  if (code <= 69) return { description: "Rain", icon: "🌧️" };
  if (code <= 79) return { description: "Snow", icon: "❄️" };
  if (code <= 99) return { description: "Thunderstorm", icon: "⛈️" };
  return { description: "Unknown", icon: "❓" };
}

// Leader election for cross-tab sync
function useLeaderElection() {
  const [isLeader, setIsLeader] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const storageKey = "simple-demo-leader";
    const tabId = Math.random().toString(36).slice(2);

    const claimLeadership = () => {
      localStorage.setItem(storageKey, tabId);
      setIsLeader(true);
    };

    const checkLeadership = () => {
      const currentLeader = localStorage.getItem(storageKey);
      if (!currentLeader || currentLeader === tabId) {
        claimLeadership();
      } else {
        setIsLeader(false);
      }
    };

    // Try to claim on focus
    const handleFocus = () => checkLeadership();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === storageKey) checkLeadership();
    };

    // Initial claim
    checkLeadership();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);

    // Release on unload
    const handleUnload = () => {
      if (localStorage.getItem(storageKey) === tabId) {
        localStorage.removeItem(storageKey);
      }
    };
    window.addEventListener("beforeunload", handleUnload);

    // BroadcastChannel for cross-tab communication
    try {
      channelRef.current = new BroadcastChannel("simple-demo-sync");
    } catch {
      // BroadcastChannel not supported
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("beforeunload", handleUnload);
      channelRef.current?.close();
    };
  }, []);

  return { isLeader, channel: channelRef.current };
}

// Main hook
export function useAppState() {
  const [state, dispatch] = useReducer(reducer, null, createInitialState);
  const [isLoading, setIsLoading] = useState(true);
  const { isLeader } = useLeaderElection();
  const stoppingSince = useRef<number | null>(null);
  const weatherFetchedRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false });

  // Load initial state from Dexie
  const savedState = useLiveQuery(() => db.appState.get(STATE_ID), []);

  // Sync from Dexie when not leader
  useEffect(() => {
    if (savedState && !isLeader) {
      dispatch({
        type: "SYNC_STATE",
        state: {
          hamster: savedState.hamster,
          leftDoor: savedState.leftDoor,
          rightDoor: savedState.rightDoor,
        },
      });
    }
    if (savedState !== undefined) {
      setIsLoading(false);
    }
  }, [savedState, isLeader]);

  // Load initial state on mount
  useEffect(() => {
    if (savedState && isLoading) {
      dispatch({
        type: "SYNC_STATE",
        state: {
          hamster: savedState.hamster,
          leftDoor: savedState.leftDoor,
          rightDoor: savedState.rightDoor,
        },
      });
      setIsLoading(false);
    }
  }, [savedState, isLoading]);

  // Save to Dexie when leader
  useEffect(() => {
    if (!isLeader || isLoading) return;

    const saveState = async () => {
      await db.appState.put({
        id: STATE_ID,
        ...state,
        updatedAt: new Date(),
      });
    };

    const timeout = setTimeout(saveState, 100);
    return () => clearTimeout(timeout);
  }, [state, isLeader, isLoading]);

  // Hamster animation tick
  useEffect(() => {
    if (state.hamster.state !== "running") return;

    const interval = setInterval(() => {
      dispatch({ type: "HAMSTER_TICK" });
    }, 16);

    return () => clearInterval(interval);
  }, [state.hamster.state]);

  // Stopping timer
  useEffect(() => {
    if (state.hamster.state === "stopping") {
      if (stoppingSince.current === null) {
        stoppingSince.current = Date.now();
      }

      const timeout = setTimeout(() => {
        dispatch({ type: "STOP_COMPLETE" });
        stoppingSince.current = null;
      }, 2000);

      return () => clearTimeout(timeout);
    } else {
      stoppingSince.current = null;
    }
  }, [state.hamster.state]);

  // Door animation ticks
  useEffect(() => {
    const hasPower = state.hamster.electricityLevel > 0;
    if (!hasPower) return;

    const leftAnimating = state.leftDoor.state === "opening" || state.leftDoor.state === "closing";
    const rightAnimating = state.rightDoor.state === "opening" || state.rightDoor.state === "closing";

    if (!leftAnimating && !rightAnimating) return;

    const interval = setInterval(() => {
      if (leftAnimating) {
        dispatch({ type: "DOOR_TICK", door: "left" });
        if (
          (state.leftDoor.state === "opening" && state.leftDoor.position >= 99) ||
          (state.leftDoor.state === "closing" && state.leftDoor.position <= 1)
        ) {
          dispatch({ type: "DOOR_ANIMATION_COMPLETE", door: "left" });
        }
      }
      if (rightAnimating) {
        dispatch({ type: "DOOR_TICK", door: "right" });
        if (
          (state.rightDoor.state === "opening" && state.rightDoor.position >= 99) ||
          (state.rightDoor.state === "closing" && state.rightDoor.position <= 1)
        ) {
          dispatch({ type: "DOOR_ANIMATION_COMPLETE", door: "right" });
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [
    state.hamster.electricityLevel,
    state.leftDoor.state,
    state.leftDoor.position,
    state.rightDoor.state,
    state.rightDoor.position,
  ]);

  // Weather fetching when door opens
  useEffect(() => {
    if (state.leftDoor.state === "open" && state.leftDoor.weather.status === "idle") {
      if (!weatherFetchedRef.current.left) {
        weatherFetchedRef.current.left = true;
        dispatch({ type: "WEATHER_LOADING", door: "left" });
        fetchWeather()
          .then((weather) => dispatch({ type: "WEATHER_LOADED", door: "left", weather }))
          .catch((err) => dispatch({ type: "WEATHER_ERROR", door: "left", error: err.message }));
      }
    } else if (state.leftDoor.state === "closed") {
      weatherFetchedRef.current.left = false;
    }
  }, [state.leftDoor.state, state.leftDoor.weather.status]);

  useEffect(() => {
    if (state.rightDoor.state === "open" && state.rightDoor.weather.status === "idle") {
      if (!weatherFetchedRef.current.right) {
        weatherFetchedRef.current.right = true;
        dispatch({ type: "WEATHER_LOADING", door: "right" });
        fetchWeather()
          .then((weather) => dispatch({ type: "WEATHER_LOADED", door: "right", weather }))
          .catch((err) => dispatch({ type: "WEATHER_ERROR", door: "right", error: err.message }));
      }
    } else if (state.rightDoor.state === "closed") {
      weatherFetchedRef.current.right = false;
    }
  }, [state.rightDoor.state, state.rightDoor.weather.status]);

  // Actions
  const toggleHamster = useCallback(() => dispatch({ type: "TOGGLE_HAMSTER" }), []);
  const wakeHamster = useCallback(() => dispatch({ type: "WAKE_HAMSTER" }), []);
  const clickDoor = useCallback(
    (door: "left" | "right") => dispatch({ type: "DOOR_CLICK", door }),
    []
  );

  return {
    state,
    isLoading,
    isLeader,
    toggleHamster,
    wakeHamster,
    clickDoor,
  };
}

// Helper functions for UI
export function getHamsterStateLabel(state: HamsterState): string {
  switch (state) {
    case "idle":
      return "Resting";
    case "running":
      return "Running!";
    case "stopping":
      return "Slowing down...";
  }
}

export function getHamsterButtonLabel(state: HamsterState): string {
  switch (state) {
    case "idle":
      return "Wake Up Hamster";
    case "running":
      return "Stop Hamster";
    case "stopping":
      return "Start Running Again";
  }
}

export function getDoorStateLabel(state: GarageDoorState): string {
  switch (state) {
    case "closed":
      return "Closed";
    case "opening":
      return "Opening...";
    case "pausedWhileOpening":
      return "Paused (Opening)";
    case "open":
      return "Open";
    case "closing":
      return "Closing...";
    case "pausedWhileClosing":
      return "Paused (Closing)";
  }
}

export function getDoorButtonLabel(state: GarageDoorState): string {
  switch (state) {
    case "closed":
      return "Open";
    case "opening":
      return "Pause";
    case "pausedWhileOpening":
      return "Close";
    case "open":
      return "Close";
    case "closing":
      return "Pause";
    case "pausedWhileClosing":
      return "Open";
  }
}
