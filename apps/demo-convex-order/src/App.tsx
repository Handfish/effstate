import { useState, useCallback } from "react";
import { OrderList } from "./components/OrderList";
import { DetailedOrderView } from "./components/DetailedOrderView";
import { useOrderList, setSimulatedLatency, getSimulatedLatency } from "./hooks/useOrderState";
import type { ConvexOrder } from "./lib/convex-adapter";

function LatencySlider() {
  const [latency, setLatency] = useState(getSimulatedLatency());

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    setLatency(value);
    setSimulatedLatency(value);
  }, []);

  return (
    <div className="bg-gradient-to-r from-orange-900/50 to-yellow-900/50 rounded-lg p-4 border border-orange-600/50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-orange-400 text-lg">⏱</span>
          <span className="font-medium text-orange-200">Simulated Network Latency</span>
        </div>
        <span className="text-2xl font-mono font-bold text-orange-400">{latency}ms</span>
      </div>
      <input
        type="range"
        min="0"
        max="3000"
        step="100"
        value={latency}
        onChange={handleChange}
        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
      />
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>0ms (instant)</span>
        <span>1500ms</span>
        <span>3000ms (slow)</span>
      </div>
      <p className="text-xs text-orange-300/70 mt-2">
        Increase latency to see optimistic updates in action - UI updates instantly while server
        catches up!
      </p>
    </div>
  );
}

function FeatureHighlights() {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
      <h3 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
        <span className="text-emerald-500">✦</span>
        What EffState + Convex Provides
      </h3>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-gray-900/50 p-2 rounded">
          <span className="text-yellow-400 font-medium">Optimistic Updates</span>
          <p className="text-gray-500 mt-1">UI updates instantly, no waiting for server</p>
        </div>
        <div className="bg-gray-900/50 p-2 rounded">
          <span className="text-blue-400 font-medium">State Machine</span>
          <p className="text-gray-500 mt-1">Type-safe transitions, impossible states prevented</p>
        </div>
        <div className="bg-gray-900/50 p-2 rounded">
          <span className="text-purple-400 font-medium">Auto Sync</span>
          <p className="text-gray-500 mt-1">
            <code className="text-purple-300">_syncSnapshot()</code> corrects drift
          </p>
        </div>
        <div className="bg-gray-900/50 p-2 rounded">
          <span className="text-green-400 font-medium">Real-time</span>
          <p className="text-gray-500 mt-1">Convex pushes updates across all tabs</p>
        </div>
      </div>
    </div>
  );
}

function MultiTabHint() {
  return (
    <div className="bg-blue-900/30 border border-blue-600/50 rounded-lg p-3 text-sm">
      <div className="flex items-start gap-2">
        <span className="text-blue-400 text-lg">🔄</span>
        <div>
          <span className="font-medium text-blue-300">Try opening in multiple tabs!</span>
          <p className="text-blue-400/70 text-xs mt-1">
            Changes sync in real-time across all connected clients via Convex subscriptions.
          </p>
        </div>
      </div>
    </div>
  );
}

function App() {
  const { orders, isLoading } = useOrderList();
  const [selectedOrder, setSelectedOrder] = useState<ConvexOrder | null>(null);

  // When orders update, refresh selected order
  const currentSelectedOrder =
    selectedOrder && orders
      ? orders.find((o) => o.orderId === selectedOrder.orderId) ?? null
      : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 border-b border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              EffState v3 + Convex Demo
            </h1>
            <p className="text-sm text-gray-400">
              Hybrid state management with optimistic updates & real-time sync
            </p>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/anthropics/effstate"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-white transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Control Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <LatencySlider />
          <FeatureHighlights />
          <MultiTabHint />
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Order List */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Orders
              <span className="text-sm font-normal text-gray-500">
                ({orders?.length ?? 0} total)
              </span>
            </h2>

            {/* Order Selection List */}
            {isLoading ? (
              <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
                Loading orders...
              </div>
            ) : orders && orders.length > 0 ? (
              <div className="space-y-2">
                {orders.map((order) => (
                  <button
                    key={order._id}
                    onClick={() => setSelectedOrder(order)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      currentSelectedOrder?.orderId === order.orderId
                        ? "bg-emerald-900/30 border-emerald-500"
                        : "bg-gray-800 border-gray-700 hover:border-gray-600"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-medium text-white">{order.orderId}</span>
                        <p className="text-sm text-gray-400">{order.customerName}</p>
                      </div>
                      <div className="text-right">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            order.state._tag === "Cart"
                              ? "bg-gray-600 text-gray-200"
                              : order.state._tag === "Checkout"
                                ? "bg-blue-600 text-blue-100"
                                : order.state._tag === "Processing"
                                  ? "bg-yellow-600 text-yellow-100"
                                  : order.state._tag === "Shipped"
                                    ? "bg-purple-600 text-purple-100"
                                    : order.state._tag === "Delivered"
                                      ? "bg-green-600 text-green-100"
                                      : "bg-red-600 text-red-100"
                          }`}
                        >
                          {order.state._tag}
                        </span>
                        <p className="text-sm font-mono text-gray-300 mt-1">
                          ${order.total.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
                No orders yet
              </div>
            )}

            {/* Create Order Form (inline) */}
            <div className="pt-4 border-t border-gray-700">
              <OrderList />
            </div>
          </div>

          {/* Right: Detailed Order View with Visualizations */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-500" />
              Order Details & Visualization
            </h2>

            {currentSelectedOrder ? (
              <DetailedOrderView order={currentSelectedOrder} />
            ) : (
              <div className="bg-gray-800 rounded-lg p-12 text-center">
                <div className="text-6xl mb-4 opacity-50">📦</div>
                <p className="text-gray-400 mb-2">Select an order to see detailed visualization</p>
                <p className="text-sm text-gray-500">
                  Watch the state machine diagram, event timeline, and sync status in action
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 border-t border-gray-800 px-6 py-4 mt-12">
        <div className="max-w-7xl mx-auto text-center text-sm text-gray-500">
          <p>
            Built with{" "}
            <span className="text-emerald-400 font-medium">EffState v3</span> +{" "}
            <span className="text-orange-400 font-medium">Confect</span> +{" "}
            <span className="text-blue-400 font-medium">Convex</span>
          </p>
          <p className="mt-1 text-gray-600">
            Demonstrating hybrid client-server state management with type-safe transitions
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
