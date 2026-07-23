import { useCallback, useState } from "react";
import { Effect, pipe } from "effect";
import { CreateOrderForm } from "./CreateOrderForm";
import { useOrderList } from "@/hooks/useOrderState";
import type { OrderItem } from "@/machines/order";

export function OrderList() {
  const { createOrder } = useOrderList();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateOrder = useCallback(
    (customerName: string, items: OrderItem[]) => {
      setIsCreating(true);

      const program = pipe(
        Effect.promise(() => createOrder(customerName, items)),
        Effect.ensuring(Effect.sync(() => setIsCreating(false))),
        Effect.asVoid
      );

      return Effect.runPromise(program);
    },
    [createOrder]
  );

  return <CreateOrderForm onCreateOrder={handleCreateOrder} isCreating={isCreating} />;
}
