import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { OrderItem } from "@/machines/order";

// Sample products for demo
const SAMPLE_PRODUCTS: OrderItem[] = [
  { id: "prod-1", name: "Wireless Keyboard", quantity: 1, price: 79.99 },
  { id: "prod-2", name: "USB-C Hub", quantity: 1, price: 49.99 },
  { id: "prod-3", name: "Monitor Stand", quantity: 1, price: 129.99 },
  { id: "prod-4", name: "Webcam HD", quantity: 1, price: 89.99 },
];

interface CreateOrderFormProps {
  onCreateOrder: (customerName: string, items: OrderItem[]) => Promise<void>;
  isCreating?: boolean;
}

export function CreateOrderForm({ onCreateOrder, isCreating }: CreateOrderFormProps) {
  const [customerName, setCustomerName] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);

  const toggleProduct = useCallback((productId: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!customerName.trim() || selectedProducts.size === 0) return;

      const items = SAMPLE_PRODUCTS.filter((p) => selectedProducts.has(p.id));
      await onCreateOrder(customerName.trim(), items);

      // Reset form
      setCustomerName("");
      setSelectedProducts(new Set());
      setIsOpen(false);
    },
    [customerName, selectedProducts, onCreateOrder]
  );

  const total = SAMPLE_PRODUCTS.filter((p) => selectedProducts.has(p.id)).reduce(
    (sum, p) => sum + p.price * p.quantity,
    0
  );

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
      >
        + Create New Order
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-white">New Order</h3>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-white"
        >
          Cancel
        </button>
      </div>

      <div>
        <label htmlFor="customerName" className="block text-sm font-medium text-gray-300 mb-1">
          Customer Name
        </label>
        <input
          id="customerName"
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Enter customer name"
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Select Products</label>
        <div className="space-y-2">
          {SAMPLE_PRODUCTS.map((product) => (
            <label
              key={product.id}
              className={cn(
                "flex items-center justify-between p-3 rounded-md cursor-pointer transition-colors",
                selectedProducts.has(product.id)
                  ? "bg-blue-600/30 border border-blue-500"
                  : "bg-gray-700 border border-transparent hover:bg-gray-600"
              )}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedProducts.has(product.id)}
                  onChange={() => toggleProduct(product.id)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 focus:ring-offset-gray-800"
                />
                <span className="text-white">{product.name}</span>
              </div>
              <span className="text-gray-300">${product.price.toFixed(2)}</span>
            </label>
          ))}
        </div>
      </div>

      {selectedProducts.size > 0 && (
        <div className="flex justify-between items-center pt-2 border-t border-gray-700">
          <span className="text-gray-300">Total:</span>
          <span className="text-xl font-bold text-white">${total.toFixed(2)}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={!customerName.trim() || selectedProducts.size === 0 || isCreating}
        className={cn(
          "w-full px-4 py-2 rounded-md font-medium transition-colors",
          !customerName.trim() || selectedProducts.size === 0 || isCreating
            ? "bg-gray-600 text-gray-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700 text-white"
        )}
      >
        {isCreating ? "Creating..." : "Create Order"}
      </button>
    </form>
  );
}
