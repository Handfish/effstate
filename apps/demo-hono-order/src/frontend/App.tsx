import { useState, useEffect, useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  orderId: string;
  state: string;
  stateData: Record<string, unknown>;
  context: {
    orderId: string;
    customerName: string;
    items: OrderItem[];
    total: number;
    createdAt: string;
  };
}

const API_BASE = "http://localhost:3001/api";

// ============================================================================
// State Badge Component
// ============================================================================

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    Pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
    Processing: "bg-blue-100 text-blue-800 border-blue-300",
    Shipped: "bg-purple-100 text-purple-800 border-purple-300",
    Delivered: "bg-green-100 text-green-800 border-green-300",
    Cancelled: "bg-red-100 text-red-800 border-red-300",
  };

  return (
    <span className={`px-3 py-1 rounded-full border text-sm font-medium ${colors[state] || "bg-gray-100"}`}>
      {state}
    </span>
  );
}

// ============================================================================
// Order Card Component
// ============================================================================

function OrderCard({ order, onRefresh }: { order: Order; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false);

  const sendAction = async (action: string, body?: object) => {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/orders/${order.orderId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      onRefresh();
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = order.state === "Pending";
  const canCancel = order.state === "Pending" || order.state === "Processing";
  const canDeliver = order.state === "Shipped";
  const isTerminal = order.state === "Delivered" || order.state === "Cancelled";

  return (
    <div className={`bg-white rounded-lg shadow-md p-6 ${isTerminal ? "opacity-75" : ""}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{order.orderId}</h3>
          <p className="text-sm text-gray-500">{order.context.customerName}</p>
        </div>
        <StateBadge state={order.state} />
      </div>

      <div className="mb-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Items:</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          {order.context.items.map((item, i) => (
            <li key={i}>
              {item.quantity}x {item.name} - ${(item.price * item.quantity).toFixed(2)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm font-semibold text-gray-900">
          Total: ${order.context.total.toFixed(2)}
        </p>
      </div>

      {order.state === "Shipped" && order.stateData.trackingNumber ? (
        <p className="text-sm text-purple-600 mb-4">
          Tracking: {String(order.stateData.trackingNumber)}
        </p>
      ) : null}

      {order.state === "Cancelled" && order.stateData.reason ? (
        <p className="text-sm text-red-600 mb-4">
          Reason: {String(order.stateData.reason)}
        </p>
      ) : null}

      {!isTerminal && (
        <div className="flex gap-2">
          {canSubmit && (
            <button
              onClick={() => sendAction("submit")}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Submit Order
            </button>
          )}
          {canDeliver && (
            <button
              onClick={() => sendAction("deliver")}
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              Mark Delivered
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => sendAction("cancel", { reason: "Customer changed mind" })}
              disabled={loading}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {order.state === "Processing" && (
        <p className="text-sm text-blue-600 mt-2 animate-pulse">
          Processing... (auto-ships in ~3s)
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Create Order Form
// ============================================================================

function CreateOrderForm({ onCreated }: { onCreated: () => void }) {
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(false);

  const sampleItems: OrderItem[] = [
    { name: "Widget Pro", quantity: 2, price: 29.99 },
    { name: "Gadget Basic", quantity: 1, price: 49.99 },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) return;

    setLoading(true);
    try {
      await fetch(`${API_BASE}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          items: sampleItems,
        }),
      });
      setCustomerName("");
      onCreated();
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Order</h2>
      <div className="flex gap-4">
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Customer name..."
          className="flex-1 px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || !customerName.trim()}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Create Order
        </button>
      </div>
      <p className="text-sm text-gray-500 mt-2">
        Creates order with sample items: 2x Widget Pro ($29.99), 1x Gadget Basic ($49.99)
      </p>
    </form>
  );
}

// ============================================================================
// App Component
// ============================================================================

export default function App() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/orders`);
      if (!res.ok) throw new Error("Failed to fetch orders");
      const data = await res.json();
      setOrders(data);
      setError(null);
    } catch (e) {
      setError("Could not connect to API. Is the server running?");
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 1000); // Poll for updates
    return () => clearInterval(interval);
  }, [fetchOrders]);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Order Processing Demo</h1>
      <p className="text-gray-600 mb-6">
        EffState v3 + Hono backend with state machine-driven order workflow
      </p>

      {error && (
        <div className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      <CreateOrderForm onCreated={fetchOrders} />

      <div className="space-y-4">
        {orders.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No orders yet. Create one above!</p>
        ) : (
          orders.map((order) => (
            <OrderCard key={order.orderId} order={order} onRefresh={fetchOrders} />
          ))
        )}
      </div>

      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="font-semibold text-gray-700 mb-2">State Flow:</h3>
        <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
          <StateBadge state="Pending" />
          <span>-&gt;</span>
          <StateBadge state="Processing" />
          <span>-&gt; (auto 3s)</span>
          <StateBadge state="Shipped" />
          <span>-&gt;</span>
          <StateBadge state="Delivered" />
        </div>
        <p className="text-sm text-gray-500 mt-2">
          Orders can be cancelled from Pending or Processing states
        </p>
      </div>
    </div>
  );
}
