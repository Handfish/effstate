/**
 * Combined EffState + Convex hooks for order management
 * With event tracking and sync status for visualization
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useActor } from "@effstate/react/v3";
import { api } from "../../convex/_generated/api";
import {
  createOrderMachine,
  type OrderEvent,
  type OrderActor,
  type OrderSnapshot,
  type OrderContext,
  type OrderItem,
} from "@/machines/order";
import {
  convexOrderToSnapshot,
  serializeState,
  type ConvexOrder,
  type ConvexOrderState,
} from "@/lib/convex-adapter";
import { generateOrderId } from "@/lib/utils";
import type { TimelineEvent } from "@/components/EventTimeline";

// ============================================================================
// Latency Simulation Context
// ============================================================================

let simulatedLatency = 0;

export function setSimulatedLatency(ms: number) {
  simulatedLatency = ms;
}

export function getSimulatedLatency() {
  return simulatedLatency;
}

async function withLatency<T>(fn: () => Promise<T>): Promise<T> {
  if (simulatedLatency > 0) {
    await new Promise((resolve) => setTimeout(resolve, simulatedLatency));
  }
  return fn();
}

// ============================================================================
// useOrderState - Per-order EffState + Convex sync with tracking
// ============================================================================

export interface UseOrderStateResult {
  snapshot: OrderSnapshot;
  stateTag: string;
  context: OrderContext;
  send: (event: OrderEvent) => void;
  actor: OrderActor;
  // Visualization data
  events: TimelineEvent[];
  isSyncing: boolean;
  lastSyncTime: Date | null;
  pendingMutations: number;
  serverState: ConvexOrderState | null;
  serverTotal: number | null;
}

let eventIdCounter = 0;

export function useOrderState(convexOrder: ConvexOrder): UseOrderStateResult {
  const updateStateMutation = useMutation(api.functions.orders.updateOrderState);
  const updateItemsMutation = useMutation(api.functions.orders.updateOrderItems);

  // Tracking state
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [pendingMutations, setPendingMutations] = useState(0);

  // Create machine with initial snapshot from Convex
  const initialSnapshot = convexOrderToSnapshot(convexOrder);
  const machineRef = useRef(createOrderMachine(initialSnapshot.context));

  const { snapshot, state, context, send: baseSend, actor } = useActor(machineRef.current, {
    initialSnapshot,
  });

  // Track server state separately for comparison
  const serverStateRef = useRef<ConvexOrderState>(convexOrder.state);
  const serverTotalRef = useRef<number>(convexOrder.total);

  // Helper to add event to timeline
  const addEvent = useCallback((event: Omit<TimelineEvent, "id" | "timestamp">) => {
    setEvents((prev) => [
      ...prev.slice(-49), // Keep last 50 events
      { ...event, id: `evt-${++eventIdCounter}`, timestamp: new Date() },
    ]);
  }, []);

  // Sync from Convex when data changes
  const prevConvexOrderRef = useRef<ConvexOrder | null>(null);
  useEffect(() => {
    const prevOrder = prevConvexOrderRef.current;
    const stateChanged = prevOrder && prevOrder.state._tag !== convexOrder.state._tag;
    const itemsChanged =
      prevOrder && JSON.stringify(prevOrder.items) !== JSON.stringify(convexOrder.items);

    // Update server state refs
    serverStateRef.current = convexOrder.state;
    serverTotalRef.current = convexOrder.total;

    // Skip if same order
    if (
      prevOrder &&
      prevOrder.state._tag === convexOrder.state._tag &&
      JSON.stringify(prevOrder.items) === JSON.stringify(convexOrder.items)
    ) {
      return;
    }

    prevConvexOrderRef.current = convexOrder;
    const newSnapshot = convexOrderToSnapshot(convexOrder);

    // Check if this is a correction (server differs from local)
    const localState = actor.getSnapshot();
    const isCorrection = localState.state._tag !== convexOrder.state._tag;

    if (prevOrder) {
      if (isCorrection) {
        addEvent({
          type: "server_correction",
          eventName: "_syncSnapshot()",
          fromState: localState.state._tag,
          toState: convexOrder.state._tag,
          details: "Server state differs from local - correcting",
        });
      } else if (stateChanged || itemsChanged) {
        addEvent({
          type: "sync",
          eventName: "Convex Update",
          fromState: prevOrder.state._tag,
          toState: convexOrder.state._tag,
          details: "Real-time sync from server",
        });
      }
    }

    // Use _syncSnapshot to update local state from server
    actor._syncSnapshot(newSnapshot);
    setLastSyncTime(new Date());
  }, [convexOrder, actor, addEvent]);

  // Wrapped send that syncs to Convex with tracking
  const send = useCallback(
    async (event: OrderEvent) => {
      const prevState = actor.getSnapshot().state._tag;

      // Log the event
      addEvent({
        type: "event",
        eventName: event._tag,
        fromState: prevState,
        toState: prevState, // Will be updated after transition
        details: JSON.stringify(event, null, 0).slice(0, 100),
      });

      // Optimistic: update local state immediately
      baseSend(event);

      // Get the new state after local transition
      const newSnapshot = actor.getSnapshot();
      const newState = newSnapshot.state._tag;

      // Log optimistic update if state changed
      if (newState !== prevState) {
        addEvent({
          type: "optimistic",
          eventName: `Local → ${newState}`,
          fromState: prevState,
          toState: newState,
          details: "Instant UI update (optimistic)",
        });
      }

      // Sync to Convex based on event type
      const isStateEvent =
        event._tag === "ProceedToCheckout" ||
        event._tag === "BackToCart" ||
        event._tag === "PlaceOrder" ||
        event._tag === "MarkShipped" ||
        event._tag === "MarkDelivered" ||
        event._tag === "CancelOrder";

      const isItemEvent =
        event._tag === "AddItem" || event._tag === "RemoveItem" || event._tag === "UpdateQuantity";

      if (isStateEvent || isItemEvent) {
        setIsSyncing(true);
        setPendingMutations((p) => p + 1);

        try {
          if (isStateEvent) {
            await withLatency(() =>
              updateStateMutation({
                orderId: context.orderId,
                state: serializeState(newSnapshot.state),
              })
            );
          } else {
            await withLatency(() =>
              updateItemsMutation({
                orderId: context.orderId,
                items: [...newSnapshot.context.items],
                total: newSnapshot.context.total,
              })
            );
          }

          // Log server confirmation
          addEvent({
            type: "server_confirmed",
            eventName: "Convex Confirmed",
            fromState: prevState,
            toState: newState,
            details: `Mutation persisted after ${simulatedLatency}ms`,
          });
        } catch (error) {
          addEvent({
            type: "server_correction",
            eventName: "Mutation Failed",
            fromState: newState,
            toState: prevState,
            details: String(error),
          });
        } finally {
          setIsSyncing(false);
          setPendingMutations((p) => Math.max(0, p - 1));
          setLastSyncTime(new Date());
        }
      }
    },
    [baseSend, actor, context.orderId, updateStateMutation, updateItemsMutation, addEvent]
  );

  return {
    snapshot,
    stateTag: state._tag,
    context,
    send,
    actor,
    // Visualization data
    events,
    isSyncing,
    lastSyncTime,
    pendingMutations,
    serverState: serverStateRef.current,
    serverTotal: serverTotalRef.current,
  };
}

// ============================================================================
// useOrderList - List orders with create function
// ============================================================================

export interface UseOrderListResult {
  orders: ConvexOrder[] | undefined;
  isLoading: boolean;
  createOrder: (customerName: string, items: OrderItem[]) => Promise<string>;
}

export function useOrderList(): UseOrderListResult {
  const orders = useQuery(api.functions.orders.listOrders, {});
  const createOrderMutation = useMutation(api.functions.orders.createOrder);

  const createOrder = useCallback(
    async (customerName: string, items: OrderItem[]): Promise<string> => {
      const orderId = generateOrderId();
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

      await withLatency(() =>
        createOrderMutation({
          orderId,
          customerName,
          items: items.map((item) => ({ ...item })),
          total,
        })
      );

      return orderId;
    },
    [createOrderMutation]
  );

  return {
    orders: orders as ConvexOrder[] | undefined,
    isLoading: orders === undefined,
    createOrder,
  };
}
