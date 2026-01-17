import { useState, useCallback } from "react";
import { OrderList } from "./components/OrderList";
import { DetailedOrderView } from "./components/DetailedOrderView";
import { HeroSection } from "./components/HeroSection";
import { useOrderList, setSimulatedLatency, getSimulatedLatency } from "./hooks/useOrderState";
import { cn } from "./lib/utils";
import type { ConvexOrder } from "./lib/convex-adapter";

function LatencySlider() {
  const [latency, setLatency] = useState(getSimulatedLatency());

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    setLatency(value);
    setSimulatedLatency(value);
  }, []);

  return (
    <div className="bg-gradient-to-br from-orange-950/50 via-amber-950/50 to-yellow-950/50 rounded-xl p-5 border border-orange-700/50 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-r from-orange-500/5 to-yellow-500/5 animate-pulse" />

      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-xl shadow-lg shadow-orange-500/30">
              ⏱
            </div>
            <div>
              <span className="font-bold text-orange-200 block">Network Latency</span>
              <span className="text-xs text-orange-400/70">Simulate slow connections</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-4xl font-black text-orange-400 font-mono">{latency}</span>
            <span className="text-orange-500 text-sm ml-1">ms</span>
          </div>
        </div>

        <input
          type="range"
          min="0"
          max="3000"
          step="100"
          value={latency}
          onChange={handleChange}
          className="w-full h-3 bg-gray-800 rounded-full appearance-none cursor-pointer accent-orange-500 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-br [&::-webkit-slider-thumb]:from-orange-400 [&::-webkit-slider-thumb]:to-amber-500 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-orange-500/50"
        />

        <div className="flex justify-between text-xs text-gray-500 mt-2">
          <span>Instant</span>
          <span className={latency >= 1000 ? "text-orange-400 font-medium" : ""}>
            {latency >= 1000 ? "🐌 Slow" : latency >= 500 ? "Normal" : "Fast"}
          </span>
          <span>3 sec</span>
        </div>

        {latency >= 500 && (
          <div className="mt-3 p-2 bg-orange-900/30 rounded-lg text-xs text-orange-300/80 flex items-center gap-2">
            <span className="animate-pulse">💡</span>
            <span>
              Watch the <span className="text-yellow-400 font-medium">optimistic update</span> happen
              instantly while the server catches up!
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickStartGuide({ onCreateDemo }: { onCreateDemo: () => void }) {
  return (
    <div className="bg-gradient-to-br from-emerald-950/50 via-cyan-950/50 to-blue-950/50 rounded-xl p-5 border border-emerald-700/50">
      <h3 className="font-bold text-emerald-300 mb-3 flex items-center gap-2">
        <span className="text-lg">🚀</span>
        Quick Start
      </h3>
      <ol className="space-y-2 text-sm">
        <li className="flex items-start gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-bold">
            1
          </span>
          <span className="text-gray-300">
            Set latency to <span className="text-orange-400 font-medium">1500ms</span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-bold">
            2
          </span>
          <span className="text-gray-300">Create an order or select existing</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-bold">
            3
          </span>
          <span className="text-gray-300">
            Click buttons and watch the{" "}
            <span className="text-yellow-400 font-medium">magic happen</span>
          </span>
        </li>
      </ol>
      <button
        onClick={onCreateDemo}
        className="mt-4 w-full py-2 px-4 rounded-lg font-semibold bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all hover:scale-[1.02]"
      >
        Create Demo Order →
      </button>
    </div>
  );
}

function MultiTabHint() {
  return (
    <div className="bg-gradient-to-br from-purple-950/50 via-violet-950/50 to-indigo-950/50 rounded-xl p-5 border border-purple-700/50">
      <h3 className="font-bold text-purple-300 mb-3 flex items-center gap-2">
        <span className="text-lg">🔄</span>
        Real-time Sync
      </h3>
      <p className="text-gray-400 text-sm mb-3">
        Open this app in{" "}
        <span className="text-purple-300 font-medium">multiple browser tabs</span> and watch
        changes sync instantly!
      </p>
      <div className="flex gap-2">
        <div className="flex-1 h-16 bg-gray-900/50 rounded-lg border border-gray-700 flex items-center justify-center text-2xl">
          🖥️
        </div>
        <div className="flex items-center text-purple-400">
          <svg className="w-6 h-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
        <div className="flex-1 h-16 bg-gray-900/50 rounded-lg border border-gray-700 flex items-center justify-center text-2xl">
          🖥️
        </div>
      </div>
      <p className="text-xs text-purple-400/60 mt-2 text-center">
        Powered by Convex real-time subscriptions
      </p>
    </div>
  );
}

function App() {
  const { orders, isLoading, createOrder } = useOrderList();
  const [selectedOrder, setSelectedOrder] = useState<ConvexOrder | null>(null);
  const [showHero, setShowHero] = useState(true);

  // When orders update, refresh selected order
  const currentSelectedOrder =
    selectedOrder && orders
      ? orders.find((o) => o.orderId === selectedOrder.orderId) ?? null
      : null;

  const handleCreateDemoOrder = useCallback(async () => {
    const orderId = await createOrder("Demo Customer", [
      { id: "item-1", name: "Premium Widget", quantity: 2, price: 29.99 },
      { id: "item-2", name: "Super Gadget", quantity: 1, price: 49.99 },
    ]);
    // Select the newly created order
    const newOrder = orders?.find((o) => o.orderId === orderId);
    if (newOrder) {
      setSelectedOrder(newOrder);
    }
  }, [createOrder, orders]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-950/80 backdrop-blur-xl border-b border-gray-800 px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-xl font-bold shadow-lg shadow-emerald-500/30">
              ⚡
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                EffState + Convex
              </h1>
              <p className="text-xs text-gray-500">Hybrid State Management Demo</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHero(!showHero)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                showHero
                  ? "bg-gray-800 text-gray-400 hover:text-white"
                  : "bg-emerald-600 text-white"
              )}
            >
              {showHero ? "Hide Intro" : "Show Intro"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        {/* Hero Section */}
        {showHero && (
          <div className="mb-8">
            <HeroSection />
          </div>
        )}

        {/* Control Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          <LatencySlider />
          <QuickStartGuide onCreateDemo={handleCreateDemoOrder} />
          <MultiTabHint />
        </div>

        {/* Main Two Column Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-[400px_1fr] gap-6">
          {/* Left Sidebar: Order List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                Orders
              </h2>
              <span className="text-sm text-gray-500 bg-gray-800 px-2 py-1 rounded">
                {orders?.length ?? 0} total
              </span>
            </div>

            {/* Order Selection List */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {isLoading ? (
                <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-500">
                  <div className="animate-spin w-8 h-8 border-2 border-gray-600 border-t-emerald-500 rounded-full mx-auto mb-3" />
                  Loading orders...
                </div>
              ) : orders && orders.length > 0 ? (
                orders.map((order) => (
                  <button
                    key={order._id}
                    onClick={() => setSelectedOrder(order)}
                    className={cn(
                      "w-full text-left p-4 rounded-xl border-2 transition-all group",
                      currentSelectedOrder?.orderId === order.orderId
                        ? "bg-gradient-to-r from-emerald-900/50 to-cyan-900/50 border-emerald-500 shadow-lg shadow-emerald-500/20"
                        : "bg-gray-900 border-gray-800 hover:border-gray-700 hover:bg-gray-800/50"
                    )}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-bold text-white group-hover:text-emerald-300 transition-colors">
                          {order.orderId}
                        </span>
                        <p className="text-sm text-gray-500">{order.customerName}</p>
                      </div>
                      <div className="text-right">
                        <span
                          className={cn(
                            "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wide",
                            order.state._tag === "Cart" && "bg-gray-700 text-gray-300",
                            order.state._tag === "Checkout" && "bg-blue-600 text-blue-100",
                            order.state._tag === "Processing" && "bg-yellow-600 text-yellow-100",
                            order.state._tag === "Shipped" && "bg-purple-600 text-purple-100",
                            order.state._tag === "Delivered" && "bg-green-600 text-green-100",
                            order.state._tag === "Cancelled" && "bg-red-600 text-red-100"
                          )}
                        >
                          {order.state._tag}
                        </span>
                        <p className="text-lg font-mono font-bold text-gray-300 mt-1">
                          ${order.total.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="bg-gray-900 rounded-xl p-8 text-center">
                  <div className="text-4xl mb-3 opacity-50">📦</div>
                  <p className="text-gray-500">No orders yet</p>
                  <p className="text-xs text-gray-600 mt-1">Create one to get started!</p>
                </div>
              )}
            </div>

            {/* Create Order Form */}
            <div className="pt-4 border-t border-gray-800">
              <h3 className="text-sm font-bold text-gray-400 mb-3">Create New Order</h3>
              <OrderList />
            </div>
          </div>

          {/* Right: Detailed Order View with Visualizations */}
          <div className="min-h-[600px]">
            {currentSelectedOrder ? (
              <DetailedOrderView order={currentSelectedOrder} />
            ) : (
              <div className="h-full bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 rounded-2xl border border-gray-800 flex flex-col items-center justify-center p-12">
                <div className="text-8xl mb-6 opacity-30 animate-bounce">📦</div>
                <h3 className="text-2xl font-bold text-gray-400 mb-2">Select an Order</h3>
                <p className="text-gray-500 text-center max-w-md mb-6">
                  Choose an order from the list to see the{" "}
                  <span className="text-emerald-400">state machine visualization</span>,{" "}
                  <span className="text-yellow-400">event timeline</span>, and{" "}
                  <span className="text-purple-400">sync status</span> in action.
                </p>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-yellow-500" />
                    Optimistic
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Confirmed
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    Synced
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900/50 border-t border-gray-800 px-6 py-6 mt-12">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <span className="text-gray-500 text-sm">Built with</span>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-400 text-sm font-medium border border-yellow-500/30">
                  EffState v3
                </span>
                <span className="px-3 py-1 rounded-full bg-orange-500/10 text-orange-400 text-sm font-medium border border-orange-500/30">
                  Confect
                </span>
                <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-sm font-medium border border-blue-500/30">
                  Convex
                </span>
              </div>
            </div>
            <p className="text-gray-600 text-sm">
              Type-safe hybrid state management for modern applications
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
