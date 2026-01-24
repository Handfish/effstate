/**
 * Order State Hook - v4 Style
 *
 * Simple and direct - no serialization needed!
 * Works directly with v4 machines and Convex.
 */

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { Effect, pipe } from "effect";
import { api } from "../../convex/_generated/api";
import {
  createOrderMachine,
  generateOrderId,
  type OrderEvent,
  type OrderActor,
  type OrderSnapshot,
  type OrderContext,
  type OrderItem,
  type OrderState,
} from "@/machines/order";
import type { OrderDocument } from "../../convex/schema";

export type SyncTimelineEvent = {
  id: string;
  type: "optimistic" | "server_confirmed" | "server_correction" | "external_update";
  timestamp: Date;
  fromState: string;
  toState: string;
  eventTag?: string;
  details?: string;
};

export type TimelineEvent = SyncTimelineEvent;

// ============================================================================
// Latency Simulation
// ============================================================================

let simulatedLatency = 0;
export const setSimulatedLatency = (ms: number) => { simulatedLatency = ms; };
export const getSimulatedLatency = () => simulatedLatency;

const withSimulatedLatency = <A>(effect: Effect.Effect<A>): Effect.Effect<A> =>
  simulatedLatency > 0
    ? pipe(Effect.sleep(simulatedLatency), Effect.flatMap(() => effect))
    : effect;

// ============================================================================
// Document <-> Snapshot Conversion (SUPER SIMPLE in v4!)
// ============================================================================

/** Convert Convex document to snapshot - just extract fields! */
const documentToSnapshot = (doc: OrderDocument): OrderSnapshot => ({
  state: doc.state,
  context: {
    orderId: doc.orderId,
    customerName: doc.customerName,
    items: doc.items as OrderItem[],
    total: doc.total,
    createdAt: doc.createdAt,
  },
});

/** Compare snapshots for equality */
const snapshotsEqual = (
  a: { state: { _tag: string }; items: readonly OrderItem[] },
  b: { state: { _tag: string }; items: readonly OrderItem[] }
): boolean => {
  if (a.state._tag !== b.state._tag) return false;
  if (a.items.length !== b.items.length) return false;
  return a.items.every((item, i) => {
    const other = b.items[i];
    return item.id === other.id && item.quantity === other.quantity && item.price === other.price;
  });
};

// ============================================================================
// Persistence
// ============================================================================

type Mutations = {
  updateState: ReturnType<typeof useMutation<typeof api.functions.orders.updateOrderState>>;
  updateItems: ReturnType<typeof useMutation<typeof api.functions.orders.updateOrderItems>>;
};

const StateEvents = ["ProceedToCheckout", "BackToCart", "PlaceOrder", "MarkShipped", "MarkDelivered", "CancelOrder"] as const;
const ItemEvents = ["AddItem", "RemoveItem", "UpdateQuantity"] as const;

const isStateEvent = (tag: string): boolean => (StateEvents as readonly string[]).includes(tag);
const isItemEvent = (tag: string): boolean => (ItemEvents as readonly string[]).includes(tag);

const persistState = (snapshot: OrderSnapshot, mutations: Mutations) =>
  Effect.promise(() =>
    mutations.updateState({
      orderId: snapshot.context.orderId,
      state: snapshot.state, // Direct! No serialization!
    })
  );

const persistItems = (snapshot: OrderSnapshot, mutations: Mutations) =>
  Effect.promise(() =>
    mutations.updateItems({
      orderId: snapshot.context.orderId,
      items: [...snapshot.context.items],
      total: snapshot.context.total,
    })
  );

const buildPersistEffect = (snapshot: OrderSnapshot, event: OrderEvent, mutations: Mutations) => {
  if (isStateEvent(event._tag)) return persistState(snapshot, mutations);
  if (isItemEvent(event._tag)) return persistItems(snapshot, mutations);
  return Effect.void;
};

// ============================================================================
// useOrderState Hook
// ============================================================================

export interface UseOrderStateResult {
  snapshot: OrderSnapshot;
  stateTag: string;
  context: OrderContext;
  send: (event: OrderEvent) => void;
  actor: OrderActor;
  events: TimelineEvent[];
  isSyncing: boolean;
  lastSyncTime: Date | null;
  pendingMutations: number;
  serverState: OrderState | null;
  serverTotal: number | null;
  lastEventType: TimelineEvent["type"] | null;
}

export function useOrderState(convexOrder: OrderDocument): UseOrderStateResult {
  const updateStateMutation = useMutation(api.functions.orders.updateOrderState);
  const updateItemsMutation = useMutation(api.functions.orders.updateOrderItems);

  const mutations = useMemo(
    () => ({ updateState: updateStateMutation, updateItems: updateItemsMutation }),
    [updateStateMutation, updateItemsMutation]
  );

  // Create actor once per order
  const actorRef = useRef<OrderActor | null>(null);
  const [snapshot, setSnapshot] = useState<OrderSnapshot>(() => documentToSnapshot(convexOrder));
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [lastEventType, setLastEventType] = useState<TimelineEvent["type"] | null>(null);
  const eventIdRef = useRef(0);

  // Initialize actor
  useEffect(() => {
    const initialSnapshot = documentToSnapshot(convexOrder);
    const machine = createOrderMachine(initialSnapshot.context);

    const actor = Effect.runSync(machine.interpret({ snapshot: initialSnapshot }));
    actorRef.current = actor;
    setSnapshot(actor.getSnapshot());

    const unsubscribe = actor.subscribe((newSnapshot) => {
      setSnapshot(newSnapshot);
    });

    return () => {
      unsubscribe();
      actor.stop();
    };
  }, [convexOrder.orderId]);

  // Sync from Convex when external changes occur
  useEffect(() => {
    const actor = actorRef.current;
    if (!actor) return;

    const externalSnapshot = documentToSnapshot(convexOrder);
    const currentSnapshot = actor.getSnapshot();

    // Check if server has different state
    const serverDiffers = !snapshotsEqual(
      { state: externalSnapshot.state, items: externalSnapshot.context.items },
      { state: currentSnapshot.state, items: currentSnapshot.context.items }
    );

    if (serverDiffers) {
      const fromState = currentSnapshot.state._tag;
      const toState = externalSnapshot.state._tag;

      // Determine if this is a correction or external update
      const eventType: TimelineEvent["type"] =
        fromState !== toState ? "server_correction" : "external_update";

      // Sync the snapshot
      actor._syncSnapshot(externalSnapshot);

      // Record the event
      const event: TimelineEvent = {
        id: `event-${++eventIdRef.current}`,
        type: eventType,
        timestamp: new Date(),
        fromState,
        toState,
        details: eventType === "server_correction" ? "Server state differs from local" : "External update received",
      };
      setEvents(prev => [...prev.slice(-50), event]);
      setLastEventType(eventType);
      setLastSyncTime(new Date());
    }
  }, [convexOrder]);

  // Send event handler
  const send = useCallback((event: OrderEvent) => {
    const actor = actorRef.current;
    if (!actor) return;

    const beforeSnapshot = actor.getSnapshot();

    // Optimistic update
    actor.send(event);

    const afterSnapshot = actor.getSnapshot();

    // Record optimistic event
    const optimisticEvent: TimelineEvent = {
      id: `event-${++eventIdRef.current}`,
      type: "optimistic",
      timestamp: new Date(),
      fromState: beforeSnapshot.state._tag,
      toState: afterSnapshot.state._tag,
      eventTag: event._tag,
    };
    setEvents(prev => [...prev.slice(-50), optimisticEvent]);
    setLastEventType("optimistic");

    // Persist to Convex
    setIsSyncing(true);
    setPendingMutations(prev => prev + 1);

    const program = pipe(
      buildPersistEffect(afterSnapshot, event, mutations),
      withSimulatedLatency,
      Effect.tap(() => Effect.sync(() => {
        // Record confirmation
        const confirmEvent: TimelineEvent = {
          id: `event-${++eventIdRef.current}`,
          type: "server_confirmed",
          timestamp: new Date(),
          fromState: beforeSnapshot.state._tag,
          toState: afterSnapshot.state._tag,
          eventTag: event._tag,
        };
        setEvents(prev => [...prev.slice(-50), confirmEvent]);
        setLastEventType("server_confirmed");
        setLastSyncTime(new Date());
      })),
      Effect.ensuring(Effect.sync(() => {
        setIsSyncing(false);
        setPendingMutations(prev => Math.max(0, prev - 1));
      }))
    );

    Effect.runPromise(program).catch(console.error);
  }, [mutations]);

  return {
    snapshot,
    stateTag: snapshot.state._tag,
    context: snapshot.context,
    send,
    actor: actorRef.current!,
    events,
    isSyncing,
    lastSyncTime,
    pendingMutations,
    serverState: convexOrder.state,
    serverTotal: convexOrder.total,
    lastEventType,
  };
}

// ============================================================================
// useOrderList Hook
// ============================================================================

export interface UseOrderListResult {
  orders: OrderDocument[] | undefined;
  isLoading: boolean;
  createOrder: (customerName: string, items: OrderItem[]) => Promise<string>;
}

const calculateTotal = (items: readonly OrderItem[]) =>
  items.reduce((sum, item) => sum + item.price * item.quantity, 0);

export function useOrderList(): UseOrderListResult {
  const orders = useQuery(api.functions.orders.listOrders, {});
  const createOrderMutation = useMutation(api.functions.orders.createOrder);

  const createOrder = useCallback(
    (customerName: string, items: OrderItem[]): Promise<string> => {
      const orderId = generateOrderId();

      const program = pipe(
        Effect.promise(() =>
          createOrderMutation({
            orderId,
            customerName,
            items: items.map((item) => ({ ...item })),
            total: calculateTotal(items),
          })
        ),
        withSimulatedLatency,
        Effect.as(orderId)
      );

      return Effect.runPromise(program);
    },
    [createOrderMutation]
  );

  return {
    orders: orders as OrderDocument[] | undefined,
    isLoading: orders === undefined,
    createOrder,
  };
}
