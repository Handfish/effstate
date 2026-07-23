/**
 * EffState v3 Convex Integration
 *
 * Higher-level hooks for integrating EffState machines with Convex.
 * Provides automatic sync between local machine state and Convex backend.
 */

import { useCallback, useEffect, useRef, useMemo } from "react";
import { Effect } from "effect";
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineActor,
  MachineSnapshot,
  MachineDefinition,
} from "effstate/v3";
import type { SerializedState, ConvexAdapter } from "effstate/v3";

// ============================================================================
// Types
// ============================================================================

/**
 * Mutation functions for Convex integration.
 */
export interface ConvexMutations<TDocument extends { state: SerializedState }> {
  /** Update state only */
  updateState?: (args: { orderId: string; state: SerializedState }) => Promise<boolean>;
  /** Update context/items */
  updateContext?: (args: { orderId: string } & Partial<Omit<TDocument, "state" | "_id">>) => Promise<boolean>;
  /** Create new document */
  create?: (args: Omit<TDocument, "_id" | "state"> & { state?: SerializedState }) => Promise<string>;
}

/**
 * Configuration for useConvexMachine hook.
 */
export interface UseConvexMachineConfig<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TDocument extends { state: SerializedState },
> {
  /** Machine definition */
  machine: MachineDefinition<S, C, E>;

  /** Convex adapter for serialization */
  adapter: ConvexAdapter<S, C, TDocument>;

  /** Document data from useQuery (undefined while loading) */
  document: TDocument | undefined | null;

  /** ID field name in context (for mutations) */
  idField: keyof C;

  /** Mutations for syncing changes to Convex */
  mutations?: ConvexMutations<TDocument>;

  /** Debounce delay for saves (ms) */
  debounceMs?: number;

  /** Enable optimistic updates (default: true) */
  optimisticUpdates?: boolean;

  /** Initial context for new documents */
  initialContext?: C;

  /** Initial state for new documents */
  initialState?: S;
}

/**
 * Result of useConvexMachine hook.
 */
export interface UseConvexMachineResult<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
> {
  /** Current snapshot (state + context) */
  snapshot: MachineSnapshot<S, C>;
  /** Current state */
  state: S;
  /** Current context */
  context: C;
  /** Current state tag */
  stateTag: S["_tag"];
  /** Send an event to the machine */
  send: (event: E) => void;
  /** Whether data is loading from Convex */
  isLoading: boolean;
  /** Whether there are pending saves */
  isPending: boolean;
  /** The underlying actor */
  actor: MachineActor<S, C, E> | null;
}

// ============================================================================
// Hook: useConvexMachine
// ============================================================================

/**
 * Integrate an EffState machine with Convex backend.
 *
 * This hook:
 * - Creates a machine actor from the definition
 * - Syncs initial state from Convex query data
 * - Persists state changes back to Convex via mutations
 * - Handles loading and pending states
 *
 * @example
 * ```ts
 * const { snapshot, send, isLoading } = useConvexMachine({
 *   machine: orderMachine,
 *   adapter: orderAdapter,
 *   document: useQuery(api.orders.getOrder, { orderId }),
 *   idField: "orderId",
 *   mutations: {
 *     updateState: useMutation(api.orders.updateState),
 *     updateContext: useMutation(api.orders.updateItems),
 *   },
 * });
 * ```
 */
export function useConvexMachine<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TDocument extends { state: SerializedState },
>(
  config: UseConvexMachineConfig<S, C, E, TDocument>
): UseConvexMachineResult<S, C, E> {
  const {
    machine,
    adapter,
    document,
    idField,
    mutations,
    debounceMs = 500,
    optimisticUpdates = true,
    initialContext,
    initialState,
  } = config;

  // Track pending saves
  const pendingRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create initial snapshot
  const initialSnapshot = useMemo(() => {
    if (document) {
      return adapter.fromDocument(document);
    }
    if (initialContext && initialState) {
      return { state: initialState, context: initialContext };
    }
    return undefined;
  }, []); // Only compute once

  // Create actor (only once)
  const actorRef = useRef<MachineActor<S, C, E> | null>(null);

  if (actorRef.current === null && initialSnapshot) {
    const program = machine.interpret({ snapshot: initialSnapshot });
    actorRef.current = Effect.runSync(program);
  }

  const actor = actorRef.current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      actorRef.current?.stop();
      actorRef.current = null;
    };
  }, []);

  // Sync from Convex when document changes
  const prevDocRef = useRef<TDocument | undefined | null>(undefined);

  useEffect(() => {
    if (!actor || document === undefined) return;

    // Skip if document hasn't changed (reference check)
    if (prevDocRef.current === document) return;
    prevDocRef.current = document;

    if (document === null) return;

    // Sync external changes to actor
    const externalSnapshot = adapter.fromDocument(document);
    const currentSnapshot = actor.getSnapshot();

    // Only sync if state tag differs (avoid loops during our own saves)
    if (externalSnapshot.state._tag !== currentSnapshot.state._tag) {
      actor._syncSnapshot(externalSnapshot);
    }
  }, [actor, adapter, document]);

  // Persist changes to Convex
  const persistState = useCallback(
    async (snapshot: MachineSnapshot<S, C>) => {
      if (!mutations?.updateState) return;

      const id = String(snapshot.context[idField]);
      const state = adapter.serializeState(snapshot.state);

      try {
        pendingRef.current = true;
        await mutations.updateState({ orderId: id, state });
      } catch {
        // Error handling can be added via onError callback in config
      } finally {
        pendingRef.current = false;
      }
    },
    [adapter, idField, mutations]
  );

  // Subscribe to actor changes and persist
  useEffect(() => {
    if (!actor || !mutations?.updateState) return;

    let prevTag = actor.getSnapshot().state._tag;

    const unsubscribe = actor.subscribe((snapshot) => {
      // Only persist on state tag changes
      if (snapshot.state._tag === prevTag) return;
      prevTag = snapshot.state._tag;

      // Debounce saves
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        persistState(snapshot);
      }, debounceMs);
    });

    return () => {
      unsubscribe();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [actor, mutations?.updateState, debounceMs, persistState]);

  // Send function with optimistic updates
  const send = useCallback(
    (event: E) => {
      if (!actor) return;

      if (optimisticUpdates) {
        // Update immediately (optimistic)
        actor.send(event);
      } else {
        // Would need to queue and wait for persistence
        // For now, still update immediately
        actor.send(event);
      }
    },
    [actor, optimisticUpdates]
  );

  // Loading state
  const isLoading = document === undefined;

  // Build result
  if (!actor) {
    // Return loading/empty state
    const emptySnapshot = {
      state: (initialState ?? { _tag: "Loading" }) as S,
      context: (initialContext ?? {}) as C,
    };

    return {
      snapshot: emptySnapshot,
      state: emptySnapshot.state,
      context: emptySnapshot.context,
      stateTag: emptySnapshot.state._tag,
      send: () => {},
      isLoading: true,
      isPending: false,
      actor: null,
    };
  }

  const snapshot = actor.getSnapshot();

  return {
    snapshot,
    state: snapshot.state,
    context: snapshot.context,
    stateTag: snapshot.state._tag,
    send,
    isLoading,
    isPending: pendingRef.current,
    actor,
  };
}

// ============================================================================
// Hook: useConvexSync
// ============================================================================

/**
 * Configuration for standalone sync hook.
 */
export interface UseConvexSyncConfig<
  S extends MachineState,
  C extends MachineContext,
  TDocument extends { state: SerializedState },
> {
  /** The actor to sync */
  actor: MachineActor<S, C, MachineEvent>;
  /** Convex adapter */
  adapter: ConvexAdapter<S, C, TDocument>;
  /** ID field in context */
  idField: keyof C;
  /** Persist function */
  persist: (id: string, state: SerializedState) => Promise<void>;
  /** Debounce delay (ms) */
  debounceMs?: number;
}

/**
 * Sync an existing actor to Convex.
 *
 * Use this when you have an actor from useActor and want to add Convex persistence.
 *
 * @example
 * ```ts
 * const { actor, send } = useActor(orderMachine, { initialSnapshot });
 * const updateState = useMutation(api.orders.updateState);
 *
 * useConvexSync({
 *   actor,
 *   adapter: orderAdapter,
 *   idField: "orderId",
 *   persist: async (id, state) => {
 *     await updateState({ orderId: id, state });
 *   },
 * });
 * ```
 */
export function useConvexSync<
  S extends MachineState,
  C extends MachineContext,
  TDocument extends { state: SerializedState },
>(config: UseConvexSyncConfig<S, C, TDocument>): { isPending: boolean } {
  const { actor, adapter, idField, persist, debounceMs = 500 } = config;

  const pendingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs fresh
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    let prevTag = actor.getSnapshot().state._tag;

    const unsubscribe = actor.subscribe((snapshot) => {
      if (snapshot.state._tag === prevTag) return;
      prevTag = snapshot.state._tag;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(async () => {
        const { adapter, idField, persist } = configRef.current;
        const id = String(snapshot.context[idField]);
        const state = adapter.serializeState(snapshot.state);

        try {
          pendingRef.current = true;
          await persist(id, state);
        } catch {
          // Error handling can be added via onError callback
        } finally {
          pendingRef.current = false;
        }
      }, debounceMs);
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [actor, debounceMs]);

  return { isPending: pendingRef.current };
}
