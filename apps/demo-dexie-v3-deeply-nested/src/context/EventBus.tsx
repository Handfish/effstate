/**
 * EventBus Context - Simple event dispatch using existing machine events
 *
 * Reuses the Data.TaggedClass events from machines (Toggle, Click, etc.)
 * for type-safe event dispatch across deeply nested components.
 */

import { createContext, useContext, useCallback, useEffect, useRef, type ReactNode } from "react";
import { Toggle, Click, type HamsterEvent, type DoorEvent } from "@/machines";

// ============================================================================
// Event Types - Reuse machine events + add routing info
// ============================================================================

export type AppEvent =
  | { target: "hamster"; event: HamsterEvent }
  | { target: "leftDoor"; event: DoorEvent }
  | { target: "rightDoor"; event: DoorEvent };

export type EventHandler = (event: AppEvent) => void;

// ============================================================================
// Context
// ============================================================================

interface EventBusContextType {
  dispatch: (event: AppEvent) => void;
  subscribe: (handler: EventHandler) => () => void;
}

const EventBusContext = createContext<EventBusContextType | null>(null);

export function EventBusProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<Set<EventHandler>>(new Set());

  const dispatch = useCallback((event: AppEvent) => {
    handlersRef.current.forEach((handler) => handler(event));
  }, []);

  const subscribe = useCallback((handler: EventHandler) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }, []);

  return (
    <EventBusContext.Provider value={{ dispatch, subscribe }}>
      {children}
    </EventBusContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

export function useEventBus() {
  const ctx = useContext(EventBusContext);
  if (!ctx) throw new Error("useEventBus requires EventBusProvider");
  return ctx;
}

export function useDispatch() {
  return useEventBus().dispatch;
}

export function useEventSubscription(handler: EventHandler) {
  const { subscribe } = useEventBus();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribe((event) => handlerRef.current(event));
  }, [subscribe]);
}

// ============================================================================
// Helper factories for common dispatches
// ============================================================================

export const AppEvents = {
  toggleHamster: (): AppEvent => ({ target: "hamster", event: new Toggle() }),
  clickLeftDoor: (): AppEvent => ({ target: "leftDoor", event: new Click() }),
  clickRightDoor: (): AppEvent => ({ target: "rightDoor", event: new Click() }),
};
