/**
 * EffState v4 - Machine Definition
 *
 * Schema-first machine that works with plain objects.
 * No serialization needed - works directly with Convex.
 */

import { Effect, Schema } from "effect";

// ============================================================================
// Types
// ============================================================================

/** Base state shape - must have _tag */
export type MachineState = { readonly _tag: string };

/** Base context shape - any object */
export type MachineContext = Record<string, unknown>;

/** Base event shape - must have _tag */
export type MachineEvent = { readonly _tag: string };

/** Snapshot = state + context */
export interface MachineSnapshot<S extends MachineState, C extends MachineContext> {
  readonly state: S;
  readonly context: C;
}

// ============================================================================
// Handler Result Types
// ============================================================================

/** Update context only (stay in current state) */
export interface UpdateResult<C extends MachineContext> {
  readonly update: Partial<C>;
}

/** Transition to new state */
export interface GotoResult<S extends MachineState> {
  readonly goto: S;
}

/** Transition with context update */
export interface GotoWithUpdateResult<S extends MachineState, C extends MachineContext> {
  readonly goto: S;
  readonly update: Partial<C>;
}

/** Handler result - update, goto, or null (no change) */
export type HandlerResult<S extends MachineState, C extends MachineContext> =
  | UpdateResult<C>
  | GotoResult<S>
  | GotoWithUpdateResult<S, C>
  | null;

/** Event handler function */
export type EventHandler<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
> = (context: C, event: E, state: S) => HandlerResult<S, C>;

/** Map of event tag to handler */
export type EventHandlers<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
> = {
  [K in E["_tag"]]?: EventHandler<S, C, Extract<E, { _tag: K }>>;
};

/** State configuration */
export interface StateConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
> {
  readonly on: EventHandlers<S, C, E>;
}

// ============================================================================
// Machine Config
// ============================================================================

export interface MachineConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
> {
  /** Unique machine identifier */
  readonly id?: string;

  /** Initial state */
  readonly initial: S;

  /** Initial context */
  readonly context: C;

  /** State configurations */
  readonly states: {
    [K in S["_tag"]]: StateConfig<S, C, E>;
  };
}

// ============================================================================
// Machine Actor
// ============================================================================

export interface MachineActor<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
> {
  /** Get current snapshot */
  getSnapshot(): MachineSnapshot<S, C>;

  /** Send an event */
  send(event: E): void;

  /** Subscribe to snapshot changes */
  subscribe(callback: (snapshot: MachineSnapshot<S, C>) => void): () => void;

  /** Sync snapshot from external source (e.g., Convex) */
  _syncSnapshot(snapshot: MachineSnapshot<S, C>): void;

  /** Stop the actor */
  stop(): void;
}

// ============================================================================
// Machine Definition
// ============================================================================

export interface MachineDefinition<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
> {
  readonly config: MachineConfig<S, C, E>;

  /** Create an actor from this machine */
  interpret(options?: {
    snapshot?: MachineSnapshot<S, C>;
  }): Effect.Effect<MachineActor<S, C, E>>;
}

// ============================================================================
// Define Machine
// ============================================================================

/**
 * Define a state machine.
 *
 * @example
 * ```ts
 * const orderMachine = defineMachine({
 *   initial: Cart.make(),
 *   context: { orderId: "123", items: [], total: 0 },
 *   states: {
 *     Cart: {
 *       on: {
 *         AddItem: (ctx, event) => ({
 *           update: { items: [...ctx.items, event.item] }
 *         }),
 *         ProceedToCheckout: (ctx) =>
 *           ctx.items.length > 0 ? { goto: Checkout.make() } : null,
 *       },
 *     },
 *     // ...
 *   },
 * });
 * ```
 */
export function defineMachine<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent
>(config: MachineConfig<S, C, E>): MachineDefinition<S, C, E> {
  return {
    config,

    interpret(options) {
      return Effect.sync(() => {
        // Initial snapshot
        let snapshot: MachineSnapshot<S, C> = options?.snapshot ?? {
          state: config.initial,
          context: config.context,
        };

        // Subscribers
        const subscribers = new Set<(snapshot: MachineSnapshot<S, C>) => void>();

        // Notify subscribers
        const notify = () => {
          subscribers.forEach((cb) => cb(snapshot));
        };

        // Process event
        const processEvent = (event: E) => {
          const stateConfig = config.states[snapshot.state._tag as S["_tag"]];
          if (!stateConfig) return;

          const handler = stateConfig.on[event._tag as E["_tag"]];
          if (!handler) return;

          const result = (handler as EventHandler<S, C, E>)(
            snapshot.context,
            event,
            snapshot.state
          );

          if (!result) return;

          // Apply result
          if ("goto" in result && "update" in result) {
            snapshot = {
              state: result.goto,
              context: { ...snapshot.context, ...result.update },
            };
          } else if ("goto" in result) {
            snapshot = {
              state: result.goto,
              context: snapshot.context,
            };
          } else if ("update" in result) {
            snapshot = {
              state: snapshot.state,
              context: { ...snapshot.context, ...result.update },
            };
          }

          notify();
        };

        // Build actor
        const actor: MachineActor<S, C, E> = {
          getSnapshot: () => snapshot,

          send: (event) => {
            processEvent(event);
          },

          subscribe: (callback) => {
            subscribers.add(callback);
            return () => subscribers.delete(callback);
          },

          _syncSnapshot: (newSnapshot) => {
            snapshot = newSnapshot;
            notify();
          },

          stop: () => {
            subscribers.clear();
          },
        };

        return actor;
      });
    },
  };
}
