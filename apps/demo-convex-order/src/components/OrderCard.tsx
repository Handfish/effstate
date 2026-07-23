import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { StateBadge } from "./StateBadge";
import { useOrderState } from "@/hooks/useOrderState";
import {
  ProceedToCheckout,
  BackToCart,
  PlaceOrder,
  MarkShipped,
  MarkDelivered,
  CancelOrder,
  canCancel,
  isTerminalState,
} from "@/machines/order";
import type { ConvexOrder } from "@/lib/convex-adapter";

interface OrderCardProps {
  order: ConvexOrder;
}

export function OrderCard({ order }: OrderCardProps) {
  const { snapshot, stateTag, context, send } = useOrderState(order);
  const [trackingInput, setTrackingInput] = useState("");
  const [showTrackingInput, setShowTrackingInput] = useState(false);

  const handleProceedToCheckout = useCallback(() => {
    send(new ProceedToCheckout());
  }, [send]);

  const handleBackToCart = useCallback(() => {
    send(new BackToCart());
  }, [send]);

  const handlePlaceOrder = useCallback(() => {
    send(new PlaceOrder());
  }, [send]);

  const handleMarkShipped = useCallback(() => {
    if (trackingInput.trim()) {
      send(new MarkShipped({ trackingNumber: trackingInput.trim() }));
      setTrackingInput("");
      setShowTrackingInput(false);
    }
  }, [send, trackingInput]);

  const handleMarkDelivered = useCallback(() => {
    send(new MarkDelivered());
  }, [send]);

  const handleCancel = useCallback(() => {
    send(new CancelOrder({ reason: "Customer requested cancellation" }));
  }, [send]);

  const state = snapshot.state;

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-medium text-white">{context.orderId}</h3>
          <p className="text-sm text-gray-400">{context.customerName}</p>
        </div>
        <StateBadge state={state} />
      </div>

      {/* Items */}
      <div className="space-y-2">
        {context.items.map((item) => (
          <div
            key={item.id}
            className="flex justify-between items-center text-sm bg-gray-700/50 rounded px-3 py-2"
          >
            <span className="text-gray-200">
              {item.name} x{item.quantity}
            </span>
            <span className="text-gray-300">${(item.price * item.quantity).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="flex justify-between items-center pt-2 border-t border-gray-700">
        <span className="text-gray-300">Total:</span>
        <span className="text-xl font-bold text-white">${context.total.toFixed(2)}</span>
      </div>

      {/* State-specific info */}
      {state._tag === "Shipped" && (
        <div className="text-sm text-gray-400">
          Tracking: <span className="text-blue-400">{state.trackingNumber}</span>
        </div>
      )}
      {state._tag === "Cancelled" && (
        <div className="text-sm text-red-400">Reason: {state.reason}</div>
      )}

      {/* Actions */}
      {!isTerminalState(state) && (
        <div className="flex flex-wrap gap-2 pt-2">
          {stateTag === "Cart" && (
            <button
              onClick={handleProceedToCheckout}
              disabled={context.items.length === 0}
              className={cn(
                "px-3 py-1.5 rounded text-sm font-medium transition-colors",
                context.items.length === 0
                  ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              )}
            >
              Checkout
            </button>
          )}

          {stateTag === "Checkout" && (
            <>
              <button
                onClick={handleBackToCart}
                className="px-3 py-1.5 rounded text-sm font-medium bg-gray-600 hover:bg-gray-500 text-white transition-colors"
              >
                Back to Cart
              </button>
              <button
                onClick={handlePlaceOrder}
                className="px-3 py-1.5 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
              >
                Place Order
              </button>
            </>
          )}

          {stateTag === "Processing" && (
            <>
              {showTrackingInput ? (
                <div className="flex gap-2 w-full">
                  <input
                    type="text"
                    value={trackingInput}
                    onChange={(e) => setTrackingInput(e.target.value)}
                    placeholder="Enter tracking number"
                    className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button
                    onClick={handleMarkShipped}
                    disabled={!trackingInput.trim()}
                    className={cn(
                      "px-3 py-1.5 rounded text-sm font-medium transition-colors",
                      !trackingInput.trim()
                        ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                        : "bg-purple-600 hover:bg-purple-700 text-white"
                    )}
                  >
                    Ship
                  </button>
                  <button
                    onClick={() => setShowTrackingInput(false)}
                    className="px-3 py-1.5 rounded text-sm font-medium bg-gray-600 hover:bg-gray-500 text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowTrackingInput(true)}
                  className="px-3 py-1.5 rounded text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors"
                >
                  Mark Shipped
                </button>
              )}
            </>
          )}

          {stateTag === "Shipped" && (
            <button
              onClick={handleMarkDelivered}
              className="px-3 py-1.5 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
            >
              Mark Delivered
            </button>
          )}

          {canCancel(state) && (
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 rounded text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
            >
              Cancel Order
            </button>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div className="text-xs text-gray-500 pt-2 border-t border-gray-700">
        Created: {context.createdAt.toLocaleString()}
        {state._tag === "Shipped" && (
          <>
            {" "}
            | Shipped: {state.shippedAt.toLocaleString()}
          </>
        )}
        {state._tag === "Delivered" && (
          <>
            {" "}
            | Delivered: {state.deliveredAt.toLocaleString()}
          </>
        )}
        {state._tag === "Cancelled" && (
          <>
            {" "}
            | Cancelled: {state.cancelledAt.toLocaleString()}
          </>
        )}
      </div>
    </div>
  );
}
