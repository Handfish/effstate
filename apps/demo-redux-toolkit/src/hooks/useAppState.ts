import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  toggleHamster,
  hamsterTick,
  stopComplete,
  wakeHamster,
  doorClick,
  doorTick,
  doorAnimationComplete,
  weatherLoading,
  weatherLoaded,
  weatherError,
  syncState,
} from "@/store/appSlice";
import { db, STATE_ID, type Weather } from "@/lib/db";

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

  useEffect(() => {
    const storageKey = "redux-demo-leader";
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

    const handleFocus = () => checkLeadership();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === storageKey) checkLeadership();
    };

    checkLeadership();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);

    const handleUnload = () => {
      if (localStorage.getItem(storageKey) === tabId) {
        localStorage.removeItem(storageKey);
      }
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  return { isLeader };
}

// Main hook - connects Redux to side effects
export function useAppState() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.app);
  const [isLoading, setIsLoading] = useState(true);
  const { isLeader } = useLeaderElection();
  const stoppingSince = useRef<number | null>(null);
  const weatherFetchedRef = useRef<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  // Load initial state from Dexie
  const savedState = useLiveQuery(() => db.appState.get(STATE_ID), []);

  // Sync from Dexie when not leader
  useEffect(() => {
    if (savedState && !isLeader) {
      dispatch(
        syncState({
          hamster: savedState.hamster,
          leftDoor: savedState.leftDoor,
          rightDoor: savedState.rightDoor,
        })
      );
    }
    if (savedState !== undefined) {
      setIsLoading(false);
    }
  }, [savedState, isLeader, dispatch]);

  // Load initial state on mount
  useEffect(() => {
    if (savedState && isLoading) {
      dispatch(
        syncState({
          hamster: savedState.hamster,
          leftDoor: savedState.leftDoor,
          rightDoor: savedState.rightDoor,
        })
      );
      setIsLoading(false);
    }
  }, [savedState, isLoading, dispatch]);

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
      dispatch(hamsterTick());
    }, 16);

    return () => clearInterval(interval);
  }, [state.hamster.state, dispatch]);

  // Stopping timer
  useEffect(() => {
    if (state.hamster.state === "stopping") {
      if (stoppingSince.current === null) {
        stoppingSince.current = Date.now();
      }

      const timeout = setTimeout(() => {
        dispatch(stopComplete());
        stoppingSince.current = null;
      }, 2000);

      return () => clearTimeout(timeout);
    } else {
      stoppingSince.current = null;
    }
  }, [state.hamster.state, dispatch]);

  // Door animation ticks
  useEffect(() => {
    const hasPower = state.hamster.electricityLevel > 0;
    if (!hasPower) return;

    const leftAnimating =
      state.leftDoor.state === "opening" || state.leftDoor.state === "closing";
    const rightAnimating =
      state.rightDoor.state === "opening" || state.rightDoor.state === "closing";

    if (!leftAnimating && !rightAnimating) return;

    const interval = setInterval(() => {
      if (leftAnimating) {
        dispatch(doorTick("left"));
        if (
          (state.leftDoor.state === "opening" && state.leftDoor.position >= 99) ||
          (state.leftDoor.state === "closing" && state.leftDoor.position <= 1)
        ) {
          dispatch(doorAnimationComplete("left"));
        }
      }
      if (rightAnimating) {
        dispatch(doorTick("right"));
        if (
          (state.rightDoor.state === "opening" && state.rightDoor.position >= 99) ||
          (state.rightDoor.state === "closing" && state.rightDoor.position <= 1)
        ) {
          dispatch(doorAnimationComplete("right"));
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
    dispatch,
  ]);

  // Weather fetching when door opens
  useEffect(() => {
    if (state.leftDoor.state === "open" && state.leftDoor.weather.status === "idle") {
      if (!weatherFetchedRef.current.left) {
        weatherFetchedRef.current.left = true;
        dispatch(weatherLoading("left"));
        fetchWeather()
          .then((weather) => dispatch(weatherLoaded({ door: "left", weather })))
          .catch((err) => dispatch(weatherError({ door: "left", error: err.message })));
      }
    } else if (state.leftDoor.state === "closed") {
      weatherFetchedRef.current.left = false;
    }
  }, [state.leftDoor.state, state.leftDoor.weather.status, dispatch]);

  useEffect(() => {
    if (state.rightDoor.state === "open" && state.rightDoor.weather.status === "idle") {
      if (!weatherFetchedRef.current.right) {
        weatherFetchedRef.current.right = true;
        dispatch(weatherLoading("right"));
        fetchWeather()
          .then((weather) => dispatch(weatherLoaded({ door: "right", weather })))
          .catch((err) => dispatch(weatherError({ door: "right", error: err.message })));
      }
    } else if (state.rightDoor.state === "closed") {
      weatherFetchedRef.current.right = false;
    }
  }, [state.rightDoor.state, state.rightDoor.weather.status, dispatch]);

  // Actions
  const handleToggleHamster = useCallback(() => dispatch(toggleHamster()), [dispatch]);
  const handleWakeHamster = useCallback(() => dispatch(wakeHamster()), [dispatch]);
  const handleClickDoor = useCallback(
    (door: "left" | "right") => dispatch(doorClick(door)),
    [dispatch]
  );

  return {
    state,
    isLoading,
    isLeader,
    toggleHamster: handleToggleHamster,
    wakeHamster: handleWakeHamster,
    clickDoor: handleClickDoor,
  };
}

// Re-export label helpers from slice
export {
  getHamsterStateLabel,
  getHamsterButtonLabel,
  getDoorStateLabel,
  getDoorButtonLabel,
} from "@/store/appSlice";
