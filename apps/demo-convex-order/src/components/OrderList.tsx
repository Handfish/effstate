import { useCallback, useState } from "react";
import { OrderCard } from "./OrderCard";
import { CreateOrderForm } from "./CreateOrderForm";
import { useOrderList } from "@/hooks/useOrderState";
import type { OrderItem } from "@/machines/order";

export function OrderList() {
  const { orders, isLoading, createOrder } = useOrderList();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateOrder = useCallback(
    async (customerName: string, items: OrderItem[]) => {
      setIsCreating(true);
      try {
        await createOrder(customerName, items);
      } finally {
        setIsCreating(false);
      }
    },
    [createOrder]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-400">Loading orders...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CreateOrderForm onCreateOrder={handleCreateOrder} isCreating={isCreating} />

      {orders && orders.length > 0 ? (
        <div className="space-y-4">
          {orders.map((order) => (
            <OrderCard key={order._id} order={order} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          No orders yet. Create your first order above!
        </div>
      )}
    </div>
  );
}
