import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { StateBadge } from "./StateBadge";
import { StateMachineDiagram } from "./StateMachineDiagram";
import { EventTimeline } from "./EventTimeline";
import { SyncStatusPanel } from "./SyncStatusPanel";
import { DataFlowVisualization } from "./DataFlowVisualization";
import { ConflictSimulator } from "./ConflictSimulator";
import { MetricsDashboard } from "./MetricsDashboard";
import { useOrderState, getSimulatedLatency } from "@/hooks/useOrderState";
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
    lastEventType,
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
      {/* Order Header with dramatic styling */}
      <div className="relative overflow-hidden bg-gradient-to-br from-gray-800 via-gray-800 to-gray-900 rounded-xl p-5 border border-gray-700">
        {/* Background glow based on state */}
        <div
          className={cn(
            "absolute inset-0 opacity-20 blur-3xl",
            stateTag === "Cart" && "bg-gray-500",
            stateTag === "Checkout" && "bg-blue-500",
            stateTag === "Processing" && "bg-yellow-500",
            stateTag === "Shipped" && "bg-purple-500",
            stateTag === "Delivered" && "bg-green-500",
            stateTag === "Cancelled" && "bg-red-500"
          )}
        />

        <div className="relative">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                {context.orderId}
                {isSyncing && (
                  <span className="inline-flex items-center gap-1 text-sm font-normal text-yellow-400">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    syncing
                  </span>
                )}
              </h2>
              <p className="text-gray-400">{context.customerName}</p>
            </div>
            <StateBadge state={state} className="scale-110" />
          </div>

          {/* Items */}
          <div className="space-y-2 mb-4">
            {context.items.map((item) => (
              <div
                key={item.id}
                className="flex justify-between items-center text-sm bg-black/30 rounded-lg px-4 py-2"
              >
                <span className="text-gray-200">
                  {item.name} <span className="text-gray-500">×{item.quantity}</span>
                </span>
                <span className="text-gray-300 font-mono">${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="flex justify-between items-center pt-3 border-t border-gray-700/50 mb-4">
            <span className="text-gray-400 font-medium">Total</span>
            <span className="text-3xl font-bold text-white">${context.total.toFixed(2)}</span>
          </div>

          {/* State-specific info */}
          {state._tag === "Shipped" && (
            <div className="bg-purple-900/30 rounded-lg p-3 mb-4 border border-purple-700/50">
              <span className="text-purple-300 text-sm">Tracking Number:</span>
              <span className="text-purple-200 font-mono ml-2">{state.trackingNumber}</span>
            </div>
          )}
          {state._tag === "Cancelled" && (
            <div className="bg-red-900/30 rounded-lg p-3 mb-4 border border-red-700/50">
              <span className="text-red-300 text-sm">Cancellation Reason:</span>
              <span className="text-red-200 ml-2">{state.reason}</span>
            </div>
          )}

          {/* Actions */}
          {!isTerminalState(state) && (
            <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-700/50">
              {stateTag === "Cart" && (
                <button
                  onClick={handleProceedToCheckout}
                  disabled={context.items.length === 0 || isSyncing}
                  className={cn(
                    "px-5 py-2.5 rounded-lg font-semibold transition-all transform",
                    context.items.length === 0 || isSyncing
                      ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                      : "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/25 hover:scale-105 hover:shadow-blue-500/40"
                  )}
                >
                  Proceed to Checkout →
                </button>
              )}

              {stateTag === "Checkout" && (
                <>
                  <button
                    onClick={handleBackToCart}
                    disabled={isSyncing}
                    className="px-4 py-2 rounded-lg font-medium bg-gray-700 hover:bg-gray-600 text-white transition-all disabled:opacity-50"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={handlePlaceOrder}
                    disabled={isSyncing}
                    className="px-5 py-2.5 rounded-lg font-semibold bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-500 hover:to-emerald-400 text-white shadow-lg shadow-green-500/25 hover:scale-105 hover:shadow-green-500/40 transition-all disabled:opacity-50"
                  >
                    Place Order →
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
                        className="flex-1 px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <button
                        onClick={handleMarkShipped}
                        disabled={!trackingInput.trim() || isSyncing}
                        className={cn(
                          "px-4 py-2 rounded-lg font-medium transition-all",
                          !trackingInput.trim() || isSyncing
                            ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                            : "bg-gradient-to-r from-purple-600 to-violet-500 hover:from-purple-500 hover:to-violet-400 text-white"
                        )}
                      >
                        Ship
                      </button>
                      <button
                        onClick={() => setShowTrackingInput(false)}
                        className="px-4 py-2 rounded-lg font-medium bg-gray-700 hover:bg-gray-600 text-white transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowTrackingInput(true)}
                      disabled={isSyncing}
                      className="px-5 py-2.5 rounded-lg font-semibold bg-gradient-to-r from-purple-600 to-violet-500 hover:from-purple-500 hover:to-violet-400 text-white shadow-lg shadow-purple-500/25 hover:scale-105 hover:shadow-purple-500/40 transition-all disabled:opacity-50"
                    >
                      Mark Shipped →
                    </button>
                  )}
                </>
              )}

              {stateTag === "Shipped" && (
                <button
                  onClick={handleMarkDelivered}
                  disabled={isSyncing}
                  className="px-5 py-2.5 rounded-lg font-semibold bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-500 hover:to-emerald-400 text-white shadow-lg shadow-green-500/25 hover:scale-105 hover:shadow-green-500/40 transition-all disabled:opacity-50"
                >
                  Mark Delivered ✓
                </button>
              )}

              {canCancel(state) && (
                <button
                  onClick={handleCancel}
                  disabled={isSyncing}
                  className="px-4 py-2 rounded-lg font-medium bg-red-900/50 hover:bg-red-800/50 text-red-300 hover:text-red-200 border border-red-700/50 transition-all disabled:opacity-50"
                >
                  Cancel Order
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Two column layout for visualizations */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-4">
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

          {/* Conflict Simulator */}
          <ConflictSimulator orderId={context.orderId} currentState={stateTag} />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Data Flow Visualization */}
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              Live Data Flow
            </h3>
            <DataFlowVisualization
              isSyncing={isSyncing}
              pendingMutations={pendingMutations}
              lastEventType={lastEventType ?? undefined}
            />
          </div>

          {/* Metrics Dashboard */}
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <MetricsDashboard events={events} simulatedLatency={getSimulatedLatency()} />
          </div>
        </div>
      </div>

      {/* Event Timeline - full width */}
      <EventTimeline events={events} className="max-h-[400px]" />
    </div>
  );
}
