# Plan: demo-convex-order - EffState v3 + Confect/Convex

## Overview

Create a new demo app `apps/demo-convex-order` that integrates EffState v3 with Confect/Convex, demonstrating an order workflow with real-time sync.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Client (React + Vite)                      │
│  ┌─────────────────┐  ┌─────────────────┐  │
│  │ EffState v3     │  │ Convex React    │  │
│  │ Order Machine   │──│ + Confect hooks │  │
│  │ (client-side)   │  │                 │  │
│  └─────────────────┘  └────────┬────────┘  │
└────────────────────────────────┼────────────┘
                                 │
┌────────────────────────────────┼────────────┐
│  Convex Backend                ▼            │
│  ┌──────────────────────────────────────┐  │
│  │ Confect Functions (queries/mutations)│  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ Convex Database (orders table)       │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Key Design Decisions

1. **Hybrid transitions**: Client EffState for optimistic UI, Convex for validation/persistence
2. **Per-order machines**: Each order gets its own EffState actor
3. **Convex as source of truth**: Real-time queries sync back to EffState via `_syncSnapshot()`
4. **Shared serialization**: State ↔ Convex data conversion helpers

## Order States

```
Cart → Checkout → Processing → Shipped → Delivered
  ↓       ↓          ↓
  └───────┴──────────┴──→ Cancelled
```

## File Structure

```
apps/demo-convex-order/
├── convex/
│   ├── schema.ts              # Convex table schema (orders)
│   └── functions/orders.ts    # Confect queries/mutations
├── src/
│   ├── machines/order.ts      # EffState v3 order machine
│   ├── lib/convex-adapter.ts  # Serialization & Convex helpers
│   ├── hooks/useOrderState.ts # Combined EffState + Convex hook
│   ├── components/
│   │   ├── CreateOrderForm.tsx
│   │   ├── OrderCard.tsx
│   │   ├── OrderList.tsx
│   │   └── StateBadge.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── postcss.config.js
```

## Implementation Phases

### Phase 1: Project Setup
- Create package.json with dependencies:
  - `effstate` (workspace), `@effstate/react` (workspace)
  - `convex`, `@rjdellecese/confect`
  - `effect`, `react`, `react-dom`
- Create vite.config.ts, tsconfig.json, tailwind.config.js
- Initialize Convex (`npx convex dev`)

### Phase 2: Order Machine (src/machines/order.ts)
- Define OrderState discriminated union (Cart, Checkout, Processing, Shipped, Delivered, Cancelled)
- Define OrderContext (orderId, customerName, items, total)
- Define OrderEvents using Data.TaggedClass
- Implement machine with `defineMachine()` v3 API

### Phase 3: Convex Backend
- Create convex/schema.ts with orders table
- Create convex/functions/orders.ts with Confect mutations/queries:
  - `listOrders` - real-time order list
  - `getOrder` - single order by orderId
  - `createOrder` - create new order
  - `updateOrderState` - validate & persist state transitions
  - `updateOrderItems` - update cart items

### Phase 4: Convex Adapter (src/lib/convex-adapter.ts)
- `serializeState()` - OrderState → Convex format
- `deserializeState()` - Convex format → OrderState
- `convexOrderToSnapshot()` - full snapshot conversion

### Phase 5: React Hooks (src/hooks/useOrderState.ts)
- `useOrderState(orderId)` - combines EffState actor with Convex sync
- `useOrderList()` - list orders with create function
- Optimistic updates with server rollback via `_syncSnapshot()`

### Phase 6: React Components
- CreateOrderForm - form to create orders with sample items
- OrderCard - displays order with action buttons per state
- OrderList - renders all orders from Convex query
- StateBadge - colored state indicator

### Phase 7: Wire Up App
- App.tsx with ConvexProvider
- main.tsx entry point
- index.css with Tailwind

## Data Flow

```
1. User clicks "Checkout"
2. send(new ProceedToCheckout())
3. Optimistic: baseSend() updates local EffState immediately
4. Sync: updateStateMutation() persists to Convex
5. Convex validates transition, updates DB
6. Real-time query fires with new data
7. _syncSnapshot() corrects local state if needed
```

## Critical Reference Files

- `packages/core/src/v3/machine.ts` - defineMachine, _syncSnapshot
- `packages/react/src/v3/hooks.ts` - useActor hook
- `apps/demo-dexie-v3/src/machines/garage-door.ts` - v3 machine example
- `apps/demo-hono-order/src/machines/order.ts` - order states to adapt

## Verification

1. Run `pnpm install` in new app directory
2. Run `npx convex dev` to start Convex backend
3. Run `pnpm dev` to start Vite frontend
4. Test workflow:
   - Create new order (should appear in list)
   - Click Checkout → Place Order → Mark Delivered
   - Test Cancel from various states
   - Open in two browser tabs to verify real-time sync
