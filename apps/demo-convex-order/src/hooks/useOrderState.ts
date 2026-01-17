/**
 * Combined EffState + Convex hooks for order management
 */

import { useCallback, useEffect, useRef } from "react";
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
} from "@/lib/convex-adapter";
import { generateOrderId } from "@/lib/utils";

// ============================================================================
// useOrderState - Per-order EffState + Convex sync
// ============================================================================

export interface UseOrderStateResult {
  snapshot: OrderSnapshot;
  stateTag: string;
  context: OrderContext;
  send: (event: OrderEvent) => void;
  actor: OrderActor;
}

export function useOrderState(convexOrder: ConvexOrder): UseOrderStateResult {
  const updateStateMutation = useMutation(api.functions.orders.updateOrderState);
  const updateItemsMutation = useMutation(api.functions.orders.updateOrderItems);

  // Create machine with initial snapshot from Convex
  const initialSnapshot = convexOrderToSnapshot(convexOrder);
  const machineRef = useRef(createOrderMachine(initialSnapshot.context));

  const { snapshot, state, context, send: baseSend, actor } = useActor(
    machineRef.current,
    { initialSnapshot }
  );

  // Sync from Convex when data changes
  const prevConvexOrderRef = useRef<ConvexOrder | null>(null);
  useEffect(() => {
    // Skip if same order (by reference or deep equality check)
    if (
      prevConvexOrderRef.current &&
      prevConvexOrderRef.current.state._tag === convexOrder.state._tag &&
      JSON.stringify(prevConvexOrderRef.current.items) === JSON.stringify(convexOrder.items)
    ) {
      return;
    }

    prevConvexOrderRef.current = convexOrder;
    const newSnapshot = convexOrderToSnapshot(convexOrder);

    // Use _syncSnapshot to update local state from server
    actor._syncSnapshot(newSnapshot);
  }, [convexOrder, actor]);

  // Wrapped send that syncs to Convex
  const send = useCallback(
    async (event: OrderEvent) => {
      // Optimistic: update local state immediately
      baseSend(event);

      // Get the new state after local transition
      const newSnapshot = actor.getSnapshot();

      // Sync to Convex based on event type
      if (
        event._tag === "ProceedToCheckout" ||
        event._tag === "BackToCart" ||
        event._tag === "PlaceOrder" ||
        event._tag === "MarkShipped" ||
        event._tag === "MarkDelivered" ||
        event._tag === "CancelOrder"
      ) {
        await updateStateMutation({
          orderId: context.orderId,
          state: serializeState(newSnapshot.state),
        });
      } else if (
        event._tag === "AddItem" ||
        event._tag === "RemoveItem" ||
        event._tag === "UpdateQuantity"
      ) {
        await updateItemsMutation({
          orderId: context.orderId,
          items: [...newSnapshot.context.items],
          total: newSnapshot.context.total,
        });
      }
    },
    [baseSend, actor, context.orderId, updateStateMutation, updateItemsMutation]
  );

  return {
    snapshot,
    stateTag: state._tag,
    context,
    send,
    actor,
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
