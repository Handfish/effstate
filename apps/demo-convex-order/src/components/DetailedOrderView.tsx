import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { StateBadge } from "./StateBadge";
import { StateMachineDiagram } from "./StateMachineDiagram";
import { EventTimeline } from "./EventTimeline";
import { SyncStatusPanel } from "./SyncStatusPanel";
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

interface DetailedOrderViewProps {
  order: ConvexOrder;
}

export function DetailedOrderView({ order }: DetailedOrderViewProps) {
  const {
    snapshot,
    stateTag,
    context,
    send,
    events,
    isSyncing,
    lastSyncTime,
    pendingMutations,
    serverState,
    serverTotal,
  } = useOrderState(order);

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
    <div className="space-y-4">
      {/* Order Header */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">{context.orderId}</h2>
            <p className="text-sm text-gray-400">{context.customerName}</p>
          </div>
          <StateBadge state={state} />
        </div>

        {/* Items */}
        <div className="space-y-2 mb-4">
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
        <div className="flex justify-between items-center pt-2 border-t border-gray-700 mb-4">
          <span className="text-gray-300">Total:</span>
          <span className="text-xl font-bold text-white">${context.total.toFixed(2)}</span>
        </div>

        {/* State-specific info */}
        {state._tag === "Shipped" && (
          <div className="text-sm text-gray-400 mb-4">
            Tracking: <span className="text-blue-400">{state.trackingNumber}</span>
          </div>
        )}
        {state._tag === "Cancelled" && (
          <div className="text-sm text-red-400 mb-4">Reason: {state.reason}</div>
        )}

        {/* Actions */}
        {!isTerminalState(state) && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-700">
            {stateTag === "Cart" && (
              <button
                onClick={handleProceedToCheckout}
                disabled={context.items.length === 0 || isSyncing}
                className={cn(
                  "px-4 py-2 rounded font-medium transition-all",
                  context.items.length === 0 || isSyncing
                    ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700 text-white hover:scale-105"
                )}
              >
                Proceed to Checkout
              </button>
            )}

            {stateTag === "Checkout" && (
              <>
                <button
                  onClick={handleBackToCart}
                  disabled={isSyncing}
                  className="px-4 py-2 rounded font-medium bg-gray-600 hover:bg-gray-500 text-white transition-all hover:scale-105 disabled:opacity-50"
                >
                  Back to Cart
                </button>
                <button
                  onClick={handlePlaceOrder}
                  disabled={isSyncing}
                  className="px-4 py-2 rounded font-medium bg-green-600 hover:bg-green-700 text-white transition-all hover:scale-105 disabled:opacity-50"
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
                      className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <button
                      onClick={handleMarkShipped}
                      disabled={!trackingInput.trim() || isSyncing}
                      className={cn(
                        "px-4 py-2 rounded font-medium transition-all",
                        !trackingInput.trim() || isSyncing
                          ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                          : "bg-purple-600 hover:bg-purple-700 text-white hover:scale-105"
                      )}
                    >
                      Ship
                    </button>
                    <button
                      onClick={() => setShowTrackingInput(false)}
                      className="px-4 py-2 rounded font-medium bg-gray-600 hover:bg-gray-500 text-white transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowTrackingInput(true)}
                    disabled={isSyncing}
                    className="px-4 py-2 rounded font-medium bg-purple-600 hover:bg-purple-700 text-white transition-all hover:scale-105 disabled:opacity-50"
                  >
                    Mark Shipped
                  </button>
                )}
              </>
            )}

            {stateTag === "Shipped" && (
              <button
                onClick={handleMarkDelivered}
                disabled={isSyncing}
                className="px-4 py-2 rounded font-medium bg-green-600 hover:bg-green-700 text-white transition-all hover:scale-105 disabled:opacity-50"
              >
                Mark Delivered
              </button>
            )}

            {canCancel(state) && (
              <button
                onClick={handleCancel}
                disabled={isSyncing}
                className="px-4 py-2 rounded font-medium bg-red-600 hover:bg-red-700 text-white transition-all hover:scale-105 disabled:opacity-50"
              >
                Cancel Order
              </button>
            )}
          </div>
        )}
      </div>

      {/* State Machine Diagram */}
      <StateMachineDiagram currentState={state} />

      {/* Sync Status Panel */}
      <SyncStatusPanel
        localState={state}
        localContext={context}
        serverState={serverState}
        serverTotal={serverTotal}
        isSyncing={isSyncing}
        lastSyncTime={lastSyncTime}
        pendingMutations={pendingMutations}
      />

      {/* Event Timeline */}
      <EventTimeline events={events} />
    </div>
  );
}
