# Plan: demo-convex-order - Hybrid EffState + Convex Architecture

## The Hybrid Value Proposition

This demo showcases why a **hybrid client/server state machine** is superior to either approach alone:

| Scenario | Server-only | Client-only | Hybrid |
|----------|-------------|-------------|--------|
| Instant UI feedback | ❌ Wait 50-200ms | ✅ Instant | ✅ Instant |
| Multi-user consistency | ✅ Automatic | ❌ Conflicts | ✅ Server authoritative |
| Rich animations | ❌ Can't run on server | ✅ Activities/streams | ✅ Client activities |
| Offline support | ❌ None | ✅ Full | ✅ Queue & sync |
| Optimistic rollback | N/A | ❌ Manual | ✅ Automatic |
| Business validation | ✅ Trusted | ❌ Bypassable | ✅ Server validates |

## Demo Scenarios That Showcase Hybrid Benefits

### Scenario 1: Optimistic Checkout with Server Validation
```
User clicks "Place Order"
  ↓
Client: Instantly shows "Processing..." (optimistic)
  ↓
Server: Validates inventory, payment, etc.
  ↓
Success → Client stays in Processing
Failure → Client rolls back to Checkout with error toast
```
**Benefit:** User sees instant feedback, but server has final say.

### Scenario 2: Processing Animation (Client Activity)
```
Order enters Processing state
  ↓
Client EffState activity starts:
  - Progress bar animation (0% → 100%)
  - Estimated time countdown
  - Pulsing status indicator
  ↓
Server completes processing (via scheduled action)
  ↓
Client syncs: Processing → Shipped (with tracking number)
```
**Benefit:** Rich UI that couldn't run on Convex server.

### Scenario 3: Multi-User Real-Time Sync
```
Tab A: User clicks "Cancel Order"
  ↓
Tab A: Optimistically shows Cancelled
  ↓
Convex mutation runs, persists
  ↓
Tab B: Real-time query fires
  ↓
Tab B: _syncSnapshot() updates local machine
  ↓
Both tabs show Cancelled (consistent)
```
**Benefit:** Instant feedback + guaranteed consistency.

### Scenario 4: Conflict Resolution
```
Tab A: Clicks "Ship Order" (admin)
Tab B: Clicks "Cancel Order" (customer) - at same moment
  ↓
Both show optimistic states locally
  ↓
Server processes Tab A first (Ship wins)
  ↓
Tab B: Server rejects cancel (already shipped)
  ↓
Tab B: Rollback → shows Shipped with toast "Order already shipped"
```
**Benefit:** Optimistic UX with server-authoritative conflict resolution.

### Scenario 5: Network Resilience
```
User goes offline
  ↓
Clicks "Add to Cart" - works (local EffState)
Clicks "Checkout" - works (local EffState)
Clicks "Place Order" - queued, shows "Pending sync..."
  ↓
Network restored
  ↓
Queued mutation runs
  ↓
Success → Processing state syncs
Failure → Rollback with "Failed to place order"
```
**Benefit:** Graceful offline experience with eventual sync.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Client (React + Vite)                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  EffState v3 Order Machine                                 │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │ │
│  │  │ Optimistic   │  │ Activities   │  │ Pending Events   │ │ │
│  │  │ State Layer  │  │ (animations) │  │ Queue (offline)  │ │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↕ sync                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Convex React (useQuery, useMutation)                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│  Convex Backend              ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Server State Machine (Authoritative)                      │ │
│  │  - Validates all transitions                               │ │
│  │  - Business rules (inventory, payment)                     │ │
│  │  - Returns success/failure + new state                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Scheduled Actions                                         │ │
│  │  - Auto-process orders after delay                         │ │
│  │  - Simulate payment/shipping                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Real-time Queries                                         │ │
│  │  - Order list, individual orders                           │ │
│  │  - Trigger client sync on change                           │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Enhanced Order States

```typescript
// Client has richer state for UI purposes
type OrderState =
  // === Cart Phase ===
  | { _tag: "Cart" }
  | { _tag: "Cart"; pending: "addItem" | "removeItem" }  // optimistic indicator

  // === Checkout Phase ===
  | { _tag: "Checkout" }
  | { _tag: "Checkout"; pending: "placeOrder" }  // "Placing order..."

  // === Processing Phase (with client activity) ===
  | { _tag: "Processing"; startedAt: Date; progress: number }  // 0-100 animated

  // === Shipping Phase ===
  | { _tag: "Shipped"; trackingNumber: string }
  | { _tag: "Shipped"; pending: "markDelivered" }

  // === Terminal States ===
  | { _tag: "Delivered"; deliveredAt: Date }
  | { _tag: "Cancelled"; reason: string }

  // === Error/Rollback States ===
  | { _tag: "RollbackPending"; previousState: OrderState; error: string }
```

## File Structure

```
apps/demo-convex-order/
├── convex/
│   ├── _generated/
│   ├── schema.ts                    # Orders table schema
│   ├── lib/
│   │   └── orderMachine.ts          # Server-side transition logic (shared)
│   └── functions/
│       ├── orders.ts                # CRUD + sendEvent mutation
│       └── scheduled.ts             # Auto-processing actions
├── src/
│   ├── machines/
│   │   ├── order.ts                 # Client EffState machine
│   │   └── orderActivities.ts       # Processing animation stream
│   ├── lib/
│   │   ├── convexSync.ts            # Sync layer (optimistic + rollback)
│   │   └── eventQueue.ts            # Offline event queue
│   ├── hooks/
│   │   ├── useOrderMachine.ts       # Main hook combining everything
│   │   └── useNetworkStatus.ts      # Online/offline detection
│   ├── components/
│   │   ├── OrderCard.tsx            # Rich order display
│   │   ├── OrderList.tsx            # All orders
│   │   ├── CreateOrderForm.tsx      # New order form
│   │   ├── ProcessingProgress.tsx   # Animated progress bar
│   │   ├── StateBadge.tsx           # State with pending indicator
│   │   ├── SyncStatus.tsx           # Shows sync/offline status
│   │   └── ConflictToast.tsx        # Rollback notifications
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── vite.config.ts
└── ...config files
```

## Implementation Phases

### Phase 1: Convex Backend with Server State Machine

**convex/lib/orderMachine.ts** - Shared transition logic:
```typescript
export const OrderStates = ["Cart", "Checkout", "Processing", "Shipped", "Delivered", "Cancelled"] as const;

export type TransitionResult =
  | { success: true; newState: string; newContext: Record<string, any> }
  | { success: false; error: string };

export function transition(
  currentState: string,
  event: { type: string; payload?: any },
  context: OrderContext
): TransitionResult {
  switch (currentState) {
    case "Cart":
      if (event.type === "ProceedToCheckout") {
        if (context.items.length === 0) {
          return { success: false, error: "Cart is empty" };
        }
        return { success: true, newState: "Checkout", newContext: context };
      }
      if (event.type === "Cancel") {
        return { success: true, newState: "Cancelled", newContext: { ...context, cancelReason: event.payload?.reason } };
      }
      break;

    case "Checkout":
      if (event.type === "PlaceOrder") {
        // Server-side validation (inventory, etc.)
        if (Math.random() < 0.1) {  // 10% simulated failure
          return { success: false, error: "Payment declined" };
        }
        return { success: true, newState: "Processing", newContext: { ...context, processedAt: Date.now() } };
      }
      break;

    // ... more transitions
  }
  return { success: false, error: `Invalid transition: ${currentState} + ${event.type}` };
}
```

**convex/functions/orders.ts** - Server mutation:
```typescript
export const sendEvent = mutation({
  args: {
    orderId: v.string(),
    event: v.object({ type: v.string(), payload: v.optional(v.any()) }),
    clientTimestamp: v.number(),  // For conflict detection
  },
  returns: v.object({
    success: v.boolean(),
    newState: v.optional(v.string()),
    error: v.optional(v.string()),
    serverTimestamp: v.number(),
  }),
  handler: ({ orderId, event, clientTimestamp }) => Effect.gen(function* () {
    const { db, scheduler } = yield* ConfectMutationCtx;

    const order = yield* db.query("orders")
      .withIndex("by_orderId", q => q.eq("orderId", orderId))
      .first();

    if (!order) {
      return { success: false, error: "Order not found", serverTimestamp: Date.now() };
    }

    // Run authoritative transition
    const result = transition(order.stateTag, event, order.context);

    if (!result.success) {
      return { success: false, error: result.error, serverTimestamp: Date.now() };
    }

    // Persist new state
    yield* db.patch(order._id, {
      stateTag: result.newState,
      context: result.newContext,
      updatedAt: Date.now(),
    });

    // Schedule auto-processing if entering Processing state
    if (result.newState === "Processing") {
      yield* scheduler.runAfter(3000, api.functions.scheduled.autoShip, { orderId });
    }

    return { success: true, newState: result.newState, serverTimestamp: Date.now() };
  }),
});
```

### Phase 2: Client EffState Machine with Activities

**src/machines/order.ts** - Client machine with optimistic states:
```typescript
export const createOrderMachine = (initialContext: OrderContext) =>
  defineMachine<OrderState, OrderContext, OrderEvent>({
    id: `order-${initialContext.orderId}`,
    context: OrderContextSchema,
    initialContext,
    initialState: OrderState.Cart(),

    states: {
      Cart: {
        on: {
          // Optimistic - immediately show pending
          ProceedToCheckout: (ctx) =>
            ctx.items.length > 0
              ? { goto: OrderState.Checkout() }
              : null,

          // Server confirmed
          ServerConfirm: (_, e) => ({ goto: deserializeState(e.state) }),
          ServerReject: (ctx, e) => ({
            goto: OrderState.Cart(),  // Stay/rollback
            actions: [() => toast.error(e.error)]
          }),
        },
      },

      Checkout: {
        on: {
          PlaceOrder: () => ({
            goto: OrderState.CheckoutPending(),  // Show "Placing order..."
          }),
          BackToCart: () => ({ goto: OrderState.Cart() }),
          ServerConfirm: (_, e) => ({ goto: deserializeState(e.state) }),
          ServerReject: (_, e) => ({
            goto: OrderState.Checkout(),  // Rollback
            actions: [() => toast.error(e.error)]
          }),
        },
      },

      CheckoutPending: {
        // Optimistic state while waiting for server
        on: {
          ServerConfirm: (_, e) => ({ goto: deserializeState(e.state) }),
          ServerReject: (_, e) => ({
            goto: OrderState.Checkout(),
            actions: [() => toast.error(`Order failed: ${e.error}`)]
          }),
        },
      },

      Processing: {
        // Client-side activity for progress animation
        run: Stream.fromSchedule(Schedule.spaced(Duration.millis(50))).pipe(
          Stream.scan(0, (progress) => Math.min(progress + 0.5, 95)),  // Never quite reaches 100
          Stream.map((progress) => new ProgressTick({ progress })),
        ),
        on: {
          ProgressTick: (ctx, e) => ({
            update: { processingProgress: e.progress }
          }),
          ServerConfirm: (_, e) => ({ goto: deserializeState(e.state) }),
        },
      },

      Shipped: {
        on: {
          MarkDelivered: () => ({ goto: OrderState.ShippedPending() }),
          ServerConfirm: (_, e) => ({ goto: deserializeState(e.state) }),
        },
      },

      // ... more states
    },
  });
```

### Phase 3: Sync Layer with Optimistic Updates

**src/lib/convexSync.ts**:
```typescript
export function useConvexSync(actor: OrderActor, orderId: string) {
  const convexOrder = useQuery(api.functions.orders.getOrder, { orderId });
  const sendEventMutation = useMutation(api.functions.orders.sendEvent);
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  const isOnline = useNetworkStatus();

  // Sync FROM Convex (server → client)
  useEffect(() => {
    if (!convexOrder) return;

    const serverSnapshot = convexOrderToSnapshot(convexOrder);
    const localState = actor.getSnapshot().state;

    // Only sync if no pending events and states differ
    if (pendingEvents.length === 0 && serverSnapshot.state._tag !== localState._tag) {
      actor._syncSnapshot(serverSnapshot);
    }
  }, [convexOrder, pendingEvents.length]);

  // Send event with optimistic update
  const send = useCallback(async (event: OrderEvent) => {
    const eventId = crypto.randomUUID();
    const clientTimestamp = Date.now();

    // 1. Optimistic local update
    actor.send(event);
    setPendingEvents(prev => [...prev, { id: eventId, event, timestamp: clientTimestamp }]);

    // 2. Queue if offline
    if (!isOnline) {
      queueEvent(orderId, event, eventId);
      return;
    }

    // 3. Send to server
    try {
      const result = await sendEventMutation({
        orderId,
        event: { type: event._tag, payload: eventToPayload(event) },
        clientTimestamp,
      });

      // 4. Handle result
      if (result.success) {
        actor.send(new ServerConfirm({ state: result.newState }));
      } else {
        actor.send(new ServerReject({ error: result.error }));
      }
    } catch (err) {
      actor.send(new ServerReject({ error: "Network error" }));
    } finally {
      setPendingEvents(prev => prev.filter(e => e.id !== eventId));
    }
  }, [actor, orderId, isOnline, sendEventMutation]);

  return { send, isPending: pendingEvents.length > 0, isOnline };
}
```

### Phase 4: Rich UI Components

**src/components/ProcessingProgress.tsx**:
```typescript
export function ProcessingProgress({ progress, startedAt }: { progress: number; startedAt: Date }) {
  const elapsed = useElapsedTime(startedAt);

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm text-gray-600">
        <span>Processing your order...</span>
        <span>{elapsed}s</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-100 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 animate-pulse">
        Verifying inventory and processing payment
      </p>
    </div>
  );
}
```

**src/components/StateBadge.tsx** - With pending indicator:
```typescript
export function StateBadge({ state, isPending }: { state: string; isPending?: boolean }) {
  return (
    <span className={`px-3 py-1 rounded-full border text-sm font-medium ${stateColors[state]} relative`}>
      {state}
      {isPending && (
        <span className="absolute -top-1 -right-1 w-3 h-3">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
        </span>
      )}
    </span>
  );
}
```

**src/components/SyncStatus.tsx**:
```typescript
export function SyncStatus({ isOnline, pendingCount }: { isOnline: boolean; pendingCount: number }) {
  if (!isOnline) {
    return (
      <div className="flex items-center gap-2 text-amber-600 text-sm">
        <WifiOff className="w-4 h-4" />
        <span>Offline - {pendingCount} pending</span>
      </div>
    );
  }
  if (pendingCount > 0) {
    return (
      <div className="flex items-center gap-2 text-blue-600 text-sm">
        <Loader className="w-4 h-4 animate-spin" />
        <span>Syncing...</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-green-600 text-sm">
      <Check className="w-4 h-4" />
      <span>Synced</span>
    </div>
  );
}
```

### Phase 5: Demo Features Panel

Add a panel to demonstrate/toggle hybrid features:
```typescript
export function DemoControls() {
  const [simulateLatency, setSimulateLatency] = useState(false);
  const [simulateOffline, setSimulateOffline] = useState(false);
  const [simulateFailures, setSimulateFailures] = useState(false);

  return (
    <div className="bg-gray-100 p-4 rounded-lg space-y-3">
      <h3 className="font-semibold text-gray-700">Demo Controls</h3>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={simulateLatency} onChange={...} />
        <span className="text-sm">Simulate 2s server latency</span>
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={simulateOffline} onChange={...} />
        <span className="text-sm">Simulate offline mode</span>
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={simulateFailures} onChange={...} />
        <span className="text-sm">Simulate 50% server failures</span>
      </label>

      <p className="text-xs text-gray-500">
        Toggle these to see how the hybrid architecture handles edge cases
      </p>
    </div>
  );
}
```

## Key Demo Interactions

### 1. "Feel the Speed" Demo
- With latency simulation OFF: Click checkout → instant
- With latency simulation ON: Still instant (optimistic), then syncs

### 2. "Server Authority" Demo
- Enable failure simulation
- Click "Place Order" → Shows "Processing..." instantly
- Server rejects → Smooth rollback to Checkout with error toast

### 3. "Multi-Tab Sync" Demo
- Open two browser tabs
- Cancel order in Tab A
- Watch Tab B update in real-time

### 4. "Offline Resilience" Demo
- Enable offline simulation
- Add items, proceed to checkout (all works)
- Place order → Shows "Pending sync..."
- Disable offline → Order syncs and processes

### 5. "Rich Animations" Demo
- Place order → Watch processing progress bar animate
- This animation runs purely on client via EffState activity
- Impossible to do on Convex server

## Dependencies

```json
{
  "dependencies": {
    "effect": "^3.19.12",
    "effstate": "workspace:*",
    "@effstate/react": "workspace:*",
    "convex": "^1.17.0",
    "@rjdellecese/confect": "^0.0.34",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "sonner": "^1.4.0"
  }
}
```

## Verification Checklist

1. **Optimistic updates**: Click action → UI updates instantly → server syncs
2. **Rollback**: Enable failures → trigger failure → see smooth rollback with toast
3. **Multi-tab**: Open 2 tabs → action in one → both update
4. **Processing animation**: Place order → see progress bar animate (client-only)
5. **Offline queue**: Go offline → queue actions → go online → actions sync
6. **Network indicator**: See sync status change (synced/syncing/offline)
