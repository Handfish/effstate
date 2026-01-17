import { useCallback, useState } from "react";
import { CreateOrderForm } from "./CreateOrderForm";
import { useOrderList } from "@/hooks/useOrderState";
import type { OrderItem } from "@/machines/order";

export function OrderList() {
  const { createOrder } = useOrderList();
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

  return <CreateOrderForm onCreateOrder={handleCreateOrder} isCreating={isCreating} />;
}
