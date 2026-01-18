/**
 * Combined EffState + Convex hooks for order management
 *
 * Uses the new useSyncedActor hook for simplified sync management.
 */

import { useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSyncedActor, type SyncTimelineEvent } from "@effstate/react/v3";
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

// Re-export TimelineEvent type for components
export type TimelineEvent = SyncTimelineEvent;

// ============================================================================
// Latency Simulation
// ============================================================================

let simulatedLatency = 0;

export function setSimulatedLatency(ms: number) {
  simulatedLatency = ms;
}

export function getSimulatedLatency() {
  return simulatedLatency;
}

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
  const { snapshot, state, context, send: baseSend, actor, syncStatus } = useSyncedActor({
    machine,
    initialSnapshot,
    externalSnapshot: convexOrder,
    deserializeExternal: convexOrderToSnapshot,
    externalEquals: (a, b) =>
      a.state._tag === b.state._tag &&
      JSON.stringify(a.items) === JSON.stringify(b.items),
    latency: simulatedLatency,
    persist: async (newSnapshot, event) => {
      // Determine if this is a state event or item event
      const isStateEvent =
        event._tag === "ProceedToCheckout" ||
        event._tag === "BackToCart" ||
        event._tag === "PlaceOrder" ||
        event._tag === "MarkShipped" ||
        event._tag === "MarkDelivered" ||
        event._tag === "CancelOrder";

      const isItemEvent =
        event._tag === "AddItem" ||
        event._tag === "RemoveItem" ||
        event._tag === "UpdateQuantity";

      if (isStateEvent) {
        await updateStateMutation({
          orderId: context.orderId,
          state: serializeState(newSnapshot.state),
        });
      } else if (isItemEvent) {
        await updateItemsMutation({
          orderId: context.orderId,
          items: [...newSnapshot.context.items],
          total: newSnapshot.context.total,
        });
      }
    },
  });

  // Wrap send to handle the promise (useSyncedActor.send is async)
  const send = useCallback(
    (event: OrderEvent) => {
      baseSend(event);
    },
    [baseSend]
  );

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

export function useOrderList(): UseOrderListResult {
  const orders = useQuery(api.functions.orders.listOrders, {});
  const createOrderMutation = useMutation(api.functions.orders.createOrder);

  const createOrder = useCallback(
    async (customerName: string, items: OrderItem[]): Promise<string> => {
      const orderId = generateOrderId();
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

      // Apply simulated latency
      if (simulatedLatency > 0) {
        await new Promise((resolve) => setTimeout(resolve, simulatedLatency));
      }

      await createOrderMutation({
        orderId,
        customerName,
        items: items.map((item) => ({ ...item })),
        total,
      });

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
