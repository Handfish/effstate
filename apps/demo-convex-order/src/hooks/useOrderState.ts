/**
 * Combined EffState + Convex hooks for order management
 *
 * Uses the new useSyncedActor hook for simplified sync management.
 */

import { useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { Effect, Match, pipe } from "effect";
import { useSyncedActor, type SyncTimelineEvent } from "@effstate/react/v3";
import { api } from "../../convex/_generated/api";
import {
  createOrderMachine,
  generateOrderId,
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

// Re-export TimelineEvent type for components
export type TimelineEvent = SyncTimelineEvent;

// ============================================================================
// Latency Simulation
// ============================================================================

let simulatedLatency = 0;

export const setSimulatedLatency = (ms: number) => {
  simulatedLatency = ms;
};

export const getSimulatedLatency = () => simulatedLatency;

// ============================================================================
// Persistence Effect Builders
// ============================================================================

type UpdateStateFn = typeof api.functions.orders.updateOrderState;
type UpdateItemsFn = typeof api.functions.orders.updateOrderItems;

type Mutations = {
  updateState: ReturnType<typeof useMutation<UpdateStateFn>>;
  updateItems: ReturnType<typeof useMutation<UpdateItemsFn>>;
};

/** State transition events that persist state changes */
const StateEvents = ["ProceedToCheckout", "BackToCart", "PlaceOrder", "MarkShipped", "MarkDelivered", "CancelOrder"] as const;

/** Item modification events that persist context changes */
const ItemEvents = ["AddItem", "RemoveItem", "UpdateQuantity"] as const;

const isStateEvent = (tag: string): tag is (typeof StateEvents)[number] =>
  (StateEvents as readonly string[]).includes(tag);

const isItemEvent = (tag: string): tag is (typeof ItemEvents)[number] =>
  (ItemEvents as readonly string[]).includes(tag);

/** Persist state to Convex */
const persistState = (snapshot: OrderSnapshot, mutations: Mutations) =>
  Effect.promise(() =>
    mutations.updateState({
      orderId: snapshot.context.orderId,
      state: serializeState(snapshot.state),
    })
  );

/** Persist items to Convex */
const persistItems = (snapshot: OrderSnapshot, mutations: Mutations) =>
  Effect.promise(() =>
    mutations.updateItems({
      orderId: snapshot.context.orderId,
      items: [...snapshot.context.items],
      total: snapshot.context.total,
    })
  );

/**
 * Build a persistence effect from an event using Match.
 * Exhaustive pattern matching ensures all events are handled.
 */
const buildPersistEffect = (
  snapshot: OrderSnapshot,
  event: OrderEvent,
  mutations: Mutations
) =>
  pipe(
    Match.value(event._tag),
    Match.when(isStateEvent, () => persistState(snapshot, mutations)),
    Match.when(isItemEvent, () => persistItems(snapshot, mutations)),
    Match.exhaustive
  );

// ============================================================================
// useOrderState - Per-order EffState + Convex sync
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
  lastEventType: TimelineEvent["type"] | null;
}

export function useOrderState(convexOrder: ConvexOrder): UseOrderStateResult {
  const updateStateMutation = useMutation(api.functions.orders.updateOrderState);
  const updateItemsMutation = useMutation(api.functions.orders.updateOrderItems);

  const mutations = useMemo(
    () => ({
      updateState: updateStateMutation,
      updateItems: updateItemsMutation,
    }),
    [updateStateMutation, updateItemsMutation]
  );

  // Create machine for this order
  const machine = useMemo(
    () => createOrderMachine(convexOrderToSnapshot(convexOrder).context),
    [convexOrder.orderId]
  );

  // Initial snapshot from Convex
  const initialSnapshot = useMemo(
    () => convexOrderToSnapshot(convexOrder),
    // Only compute on first render for this orderId
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convexOrder.orderId]
  );

  // Use the new useSyncedActor hook
  const { snapshot, state, context, send, actor, syncStatus } = useSyncedActor({
    machine,
    initialSnapshot,
    externalSnapshot: convexOrder,
    deserializeExternal: convexOrderToSnapshot,
    externalEquals: (a, b) =>
      a.state._tag === b.state._tag &&
      JSON.stringify(a.items) === JSON.stringify(b.items),
    latency: simulatedLatency,
    persist: (newSnapshot, event) =>
      Effect.runPromise(
        pipe(
          buildPersistEffect(newSnapshot, event, mutations),
          Effect.asVoid
        )
      ),
  });

  return {
    snapshot,
    stateTag: state._tag,
    context,
    send,
    actor,
    // Visualization data from syncStatus
    events: syncStatus.timeline as TimelineEvent[],
    isSyncing: syncStatus.isSyncing,
    lastSyncTime: syncStatus.lastSyncTime,
    pendingMutations: syncStatus.pendingMutations,
    serverState: convexOrder.state,
    serverTotal: convexOrder.total,
    lastEventType: syncStatus.lastEventType,
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

const calculateTotal = (items: readonly OrderItem[]) =>
  items.reduce((sum, item) => sum + item.price * item.quantity, 0);

export function useOrderList(): UseOrderListResult {
  const orders = useQuery(api.functions.orders.listOrders, {});
  const createOrderMutation = useMutation(api.functions.orders.createOrder);

  const createOrder = useCallback(
    (customerName: string, items: OrderItem[]): Promise<string> => {
      const orderId = generateOrderId();

      const program = pipe(
        // Apply simulated latency if configured
        simulatedLatency > 0
          ? Effect.sleep(simulatedLatency)
          : Effect.void,
        // Then create the order
        Effect.flatMap(() =>
          Effect.promise(() =>
            createOrderMutation({
              orderId,
              customerName,
              items: items.map((item) => ({ ...item })),
              total: calculateTotal(items),
            })
          )
        ),
        // Return the orderId
        Effect.map(() => orderId)
      );

      return Effect.runPromise(program);
    },
    [createOrderMutation]
  );

  return {
    orders: orders as ConvexOrder[] | undefined,
    isLoading: orders === undefined,
    createOrder,
  };
}
