/**
 * EffState v3 React Hooks
 *
 * Clean, composable hooks for state machine integration.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Effect } from "effect";
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineActor,
  MachineSnapshot,
  MachineDefinition,
} from "effstate/v3";

// ============================================================================
// Core Hook: useActor
// ============================================================================

export interface UseActorResult<
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
  /** Current state tag for easy switching */
  stateTag: S["_tag"];
  /** Send an event to the machine */
  send: (event: E) => void;
  /** The underlying actor (for advanced use / external sync) */
  actor: MachineActor<S, C, E>;
}

/**
 * Create and manage a machine actor.
 */
export function useActor<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(
  definition: MachineDefinition<S, C, E>,
  options?: {
    initialSnapshot?: MachineSnapshot<S, C>;
  }
): UseActorResult<S, C, E> {
  const actorRef = useRef<MachineActor<S, C, E> | null>(null);

  if (actorRef.current === null) {
    const program = definition.interpret({ snapshot: options?.initialSnapshot });
    actorRef.current = Effect.runSync(program);
  }

  const actor = actorRef.current;

  useEffect(() => {
    return () => {
      actorRef.current?.stop();
      actorRef.current = null;
    };
  }, []);

  const snapshot = useSyncExternalStore(
    actor.subscribe,
    actor.getSnapshot,
    actor.getSnapshot
  );

  const send = useCallback((event: E) => actor.send(event), [actor]);

  return {
    snapshot,
    state: snapshot.state,
    context: snapshot.context,
    stateTag: snapshot.state._tag,
    send,
    actor,
  };
}

// ============================================================================
// Utility: useActorEffect
// ============================================================================

/**
 * Run a side effect whenever the actor's snapshot changes.
 */
export function useActorEffect<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(
  actor: MachineActor<S, C, E>,
  effect: (snapshot: MachineSnapshot<S, C>) => void | (() => void),
  deps: readonly unknown[] = []
): void {
  // Use ref to always have latest effect without re-subscribing
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    let cleanup: (() => void) | void;

    const unsubscribe = actor.subscribe((snapshot) => {
      if (cleanup) cleanup();
      cleanup = effectRef.current(snapshot);
    });

    // Run effect for initial state
    cleanup = effectRef.current(actor.getSnapshot());

    return () => {
      unsubscribe();
      if (cleanup) cleanup();
    };
  }, [actor, ...deps]);
}

// ============================================================================
// Utility: useActorSync
// ============================================================================

/**
 * Sync an actor's snapshot with an external source (persistence, cross-tab, etc.)
 */
export function useActorSync<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TSerialized,
>(
  actor: MachineActor<S, C, E>,
  externalSnapshot: TSerialized | undefined,
  options: {
    isLeader: boolean;
    serialize: (snapshot: MachineSnapshot<S, C>) => TSerialized;
    deserialize: (saved: TSerialized) => MachineSnapshot<S, C>;
    onSave: (serialized: TSerialized) => void | Promise<void>;
    saveDebounce?: number;
  }
): void {
  const { isLeader, saveDebounce = 100 } = options;

  // Use refs to avoid stale closures and unnecessary effect re-runs
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Sync FROM external when not leader
  const prevExternalRef = useRef<TSerialized | undefined>(undefined);

  useEffect(() => {
    if (isLeader || externalSnapshot === undefined) return;

    // Only sync if external actually changed (deep compare would be better, but this catches most cases)
    if (prevExternalRef.current !== externalSnapshot) {
      prevExternalRef.current = externalSnapshot;
      actor._syncSnapshot(optionsRef.current.deserialize(externalSnapshot));
    }
  }, [actor, isLeader, externalSnapshot]);

  // Sync TO external when leader
  useEffect(() => {
    if (!isLeader) return;

    let timeout: number | null = null;
    const _setTimeout = (globalThis as Record<string, unknown>).setTimeout as (fn: () => void, ms: number) => number;
    const _clearTimeout = (globalThis as Record<string, unknown>).clearTimeout as (id: number) => void;

    const unsubscribe = actor.subscribe((snapshot) => {
      if (timeout) _clearTimeout(timeout);
      timeout = _setTimeout(() => {
        optionsRef.current.onSave(optionsRef.current.serialize(snapshot));
      }, saveDebounce);
    });

    // Save initial state
    timeout = _setTimeout(() => {
      optionsRef.current.onSave(optionsRef.current.serialize(actor.getSnapshot()));
    }, saveDebounce);

    return () => {
      unsubscribe();
      if (timeout) _clearTimeout(timeout);
    };
  }, [actor, isLeader, saveDebounce]);
}

// ============================================================================
// Utility: useActorWatch
// ============================================================================

/**
 * Watch a value derived from an actor's snapshot and trigger a callback when it changes.
 */
export function useActorWatch<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  T,
>(
  actor: MachineActor<S, C, E>,
  selector: (snapshot: MachineSnapshot<S, C>) => T,
  onChange: (value: T, prevValue: T | undefined) => void,
  deps: readonly unknown[] = []
): void {
  const prevValueRef = useRef<T | undefined>(undefined);
  const selectorRef = useRef(selector);
  const onChangeRef = useRef(onChange);
  selectorRef.current = selector;
  onChangeRef.current = onChange;

  useEffect(() => {
    // Set initial value without triggering onChange
    prevValueRef.current = selectorRef.current(actor.getSnapshot());

    const unsubscribe = actor.subscribe((snapshot) => {
      const value = selectorRef.current(snapshot);
      const prevValue = prevValueRef.current;

      if (value !== prevValue) {
        onChangeRef.current(value, prevValue);
        prevValueRef.current = value;
      }
    });

    return unsubscribe;
  }, [actor, ...deps]);
}
