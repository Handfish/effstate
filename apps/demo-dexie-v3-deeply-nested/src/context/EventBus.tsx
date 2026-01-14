/**
 * EventBus Context - Bi-directional event communication
 *
 * Allows deeply nested components to:
 * 1. Dispatch events UP to parent handlers
 * 2. Receive events DOWN from parent dispatches
 *
 * This decouples component hierarchy from event handling,
 * enabling 5+ level deep components to communicate without prop drilling.
 */

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

// ============================================================================
// Event Types
// ============================================================================

export type AppEvent =
  // Hamster events
  | { type: "TOGGLE_HAMSTER" }
  | { type: "HAMSTER_POWER_CHANGED"; isPowered: boolean }
  // Door events
  | { type: "CLICK_DOOR"; door: "left" | "right" }
  | { type: "WAKE_HAMSTER_FOR_DOOR"; door: "left" | "right" }
  // UI events from deep components
  | { type: "DEEP_COMPONENT_ACTION"; action: string; payload?: unknown }
  // Notification events (can bubble up or down)
  | { type: "NOTIFICATION"; message: string; level: "info" | "warning" | "error" };

export type EventHandler = (event: AppEvent) => void;

// ============================================================================
// Context Types
// ============================================================================

interface EventBusContextType {
  // Dispatch an event (goes to all handlers)
  dispatch: (event: AppEvent) => void;
  // Subscribe to events (returns unsubscribe)
  subscribe: (handler: EventHandler) => () => void;
  // For debugging: current subscriber count
  subscriberCount: () => number;
}

const EventBusContext = createContext<EventBusContextType | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function EventBusProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<Set<EventHandler>>(new Set());

  const dispatch = useCallback((event: AppEvent) => {
    handlersRef.current.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error("EventBus handler error:", error);
      }
    });
  }, []);

  const subscribe = useCallback((handler: EventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const subscriberCount = useCallback(() => handlersRef.current.size, []);

  const value = useMemo(
    () => ({ dispatch, subscribe, subscriberCount }),
    [dispatch, subscribe, subscriberCount]
  );

  return <EventBusContext.Provider value={value}>{children}</EventBusContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

export function useEventBus(): EventBusContextType {
  const context = useContext(EventBusContext);
  if (!context) {
    throw new Error("useEventBus must be used within EventBusProvider");
  }
  return context;
}

/**
 * Hook to subscribe to specific event types
 * Automatically cleans up on unmount
 */
export function useEventSubscription(handler: EventHandler) {
  const { subscribe } = useEventBus();
  const handlerRef = useRef(handler);

  // Keep handler ref up to date on every render
  handlerRef.current = handler;

  // Subscribe once on mount, unsubscribe on unmount
  useEffect(() => {
    const stableHandler = (event: AppEvent) => {
      handlerRef.current(event);
    };
    const unsubscribe = subscribe(stableHandler);
    return unsubscribe;
  }, [subscribe]);
}

/**
 * Hook that provides just the dispatch function
 * Use this in deeply nested components that only need to send events
 */
export function useDispatch(): (event: AppEvent) => void {
  const { dispatch } = useEventBus();
  return dispatch;
}
