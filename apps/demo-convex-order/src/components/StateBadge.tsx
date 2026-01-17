import { cn } from "@/lib/utils";
import { getOrderStateLabel, getOrderStateColor, type OrderState } from "@/machines/order";

interface StateBadgeProps {
  state: OrderState;
  className?: string;
}

export function StateBadge({ state, className }: StateBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white",
        getOrderStateColor(state),
        className
      )}
    >
      {getOrderStateLabel(state)}
    </span>
  );
}
