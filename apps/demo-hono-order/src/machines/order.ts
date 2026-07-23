/**
 * Order Processing State Machine (Database-Centric)
 *
 * Pure state transitions - no Effect runtime needed.
 * States: Pending -> Processing -> Shipped -> Delivered
 *         (can be Cancelled from Pending/Processing)
 */

// ============================================================================
// States
// ============================================================================

export class Pending {
  readonly _tag = "Pending" as const;
}

export class Processing {
  readonly _tag = "Processing" as const;
  constructor(readonly startedAt: Date = new Date()) {}
}

export class Shipped {
  readonly _tag = "Shipped" as const;
  constructor(readonly trackingNumber: string) {}
}

export class Delivered {
  readonly _tag = "Delivered" as const;
}

export class Cancelled {
  readonly _tag = "Cancelled" as const;
  constructor(readonly reason: string) {}
}

export type OrderState = Pending | Processing | Shipped | Delivered | Cancelled;

// ============================================================================
// Events
// ============================================================================

export class Submit {
  readonly _tag = "Submit" as const;
}

export class ProcessingComplete {
  readonly _tag = "ProcessingComplete" as const;
  constructor(readonly trackingNumber: string) {}
}

export class MarkDelivered {
  readonly _tag = "MarkDelivered" as const;
}

export class Cancel {
  readonly _tag = "Cancel" as const;
  constructor(readonly reason: string = "Customer requested") {}
}

export type OrderEvent = Submit | ProcessingComplete | MarkDelivered | Cancel;

// ============================================================================
// Context
// ============================================================================

export interface OrderContext {
  orderId: string;
  customerName: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  total: number;
  createdAt: Date;
}

// ============================================================================
// Pure Transition Function
// ============================================================================

export interface TransitionResult {
  state: OrderState;
  context: OrderContext;
  changed: boolean;
}

/**
 * Pure function: (state, context, event) => new state
 * No side effects, no async, just data transformation.
 */
export function transition(
  state: OrderState,
  context: OrderContext,
  event: OrderEvent
): TransitionResult {
  switch (state._tag) {
    case "Pending":
      switch (event._tag) {
        case "Submit":
          return { state: new Processing(), context, changed: true };
        case "Cancel":
          return { state: new Cancelled(event.reason), context, changed: true };
        default:
          return { state, context, changed: false };
      }

    case "Processing":
      switch (event._tag) {
        case "ProcessingComplete":
          return { state: new Shipped(event.trackingNumber), context, changed: true };
        case "Cancel":
          return { state: new Cancelled(event.reason), context, changed: true };
        default:
          return { state, context, changed: false };
      }

    case "Shipped":
      switch (event._tag) {
        case "MarkDelivered":
          return { state: new Delivered(), context, changed: true };
        default:
          return { state, context, changed: false };
      }

    case "Delivered":
    case "Cancelled":
      // Terminal states - no transitions
      return { state, context, changed: false };
  }
}

// ============================================================================
// Serialization
// ============================================================================

export function serializeState(state: OrderState): Record<string, unknown> {
  switch (state._tag) {
    case "Pending":
    case "Delivered":
      return { _tag: state._tag };
    case "Processing":
      return { _tag: state._tag, startedAt: state.startedAt.toISOString() };
    case "Shipped":
      return { _tag: state._tag, trackingNumber: state.trackingNumber };
    case "Cancelled":
      return { _tag: state._tag, reason: state.reason };
  }
}

export function deserializeState(data: Record<string, unknown>): OrderState {
  switch (data._tag) {
    case "Pending":
      return new Pending();
    case "Processing":
      return new Processing(data.startedAt ? new Date(data.startedAt as string) : new Date());
    case "Shipped":
      return new Shipped(data.trackingNumber as string);
    case "Delivered":
      return new Delivered();
    case "Cancelled":
      return new Cancelled(data.reason as string);
    default:
      return new Pending();
  }
}
