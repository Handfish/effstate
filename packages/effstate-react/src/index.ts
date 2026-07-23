/**
 * EffState React - Hooks for effstate-v4 state machines
 *
 * Clean, composable hooks for state machine integration in React.
 *
 * @example
 * ```tsx
 * import { useActor } from "effstate-react";
 * import { myMachine } from "./machines/my-machine";
 *
 * function App() {
 *   const { state, send } = useActor(myMachine);
 *   return <button onClick={() => send(Click.make())}>{state._tag}</button>;
 * }
 * ```
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
} from "@handfish/effstate-v4";

// Re-export types for convenience
export type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineActor,
  MachineSnapshot,
  MachineDefinition,
} from "@handfish/effstate-v4";

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
 *
 * @example
 * ```tsx
 * const { state, send } = useActor(counterMachine);
 *
 * return (
 *   <div>
 *     <p>State: {state._tag}</p>
 *     <button onClick={() => send(Increment.make())}>+</button>
 *   </div>
 * );
 * ```
 */
export function useActor<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  CI = C,
>(
  // `R`/`Err` are pinned to `never` (useActor runs the machine with runSync),
  // but the context schema's encoded type `CI` is left free so machines built
  // with a transforming context schema (CI !== C) are still accepted.
  definition: MachineDefinition<S, C, E, never, never, CI>,
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
 *
 * @example
 * ```tsx
 * useActorEffect(actor, (snapshot) => {
 *   console.log("State changed to:", snapshot.state._tag);
 * });
 * ```
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
 *
 * @example
 * ```tsx
 * useActorSync(actor, savedState, {
 *   isLeader: isTabLeader,
 *   serialize: (snap) => JSON.stringify(snap),
 *   deserialize: (json) => JSON.parse(json),
 *   onSave: (json) => localStorage.setItem("state", json),
 * });
 * ```
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

    // Only sync if external actually changed
    if (prevExternalRef.current !== externalSnapshot) {
      prevExternalRef.current = externalSnapshot;
      actor._syncSnapshot(optionsRef.current.deserialize(externalSnapshot));
    }
  }, [actor, isLeader, externalSnapshot]);

  // Sync TO external when leader
  useEffect(() => {
    if (!isLeader) return;

    let timeout: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = actor.subscribe((snapshot) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        optionsRef.current.onSave(optionsRef.current.serialize(snapshot));
      }, saveDebounce);
    });

    // Save initial state
    timeout = setTimeout(() => {
      optionsRef.current.onSave(optionsRef.current.serialize(actor.getSnapshot()));
    }, saveDebounce);

    return () => {
      unsubscribe();
      if (timeout) clearTimeout(timeout);
    };
  }, [actor, isLeader, saveDebounce]);
}

// ============================================================================
// Utility: useActorWatch
// ============================================================================

/**
 * Watch a value derived from an actor's snapshot and trigger a callback when it changes.
 *
 * @example
 * ```tsx
 * useActorWatch(
 *   actor,
 *   (snap) => snap.context.count,
 *   (count, prevCount) => {
 *     console.log(`Count changed from ${prevCount} to ${count}`);
 *   }
 * );
 * ```
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

// ============================================================================
// Utility: useActorBridge
// ============================================================================

/**
 * Bridge two actors - when a derived value changes in source, send an event to target.
 *
 * This is the idiomatic EffState pattern for cross-actor communication.
 * Instead of XState's sendTo/sendParent, React owns the actor references
 * and handles the wiring explicitly.
 *
 * @example
 * ```tsx
 * // Hamster electricity powers garage doors
 * useActorBridge(
 *   hamster.actor,
 *   leftDoor.actor,
 *   (snap) => snap.context.electricityLevel > 0,
 *   (isPowered) => isPowered ? PowerOn.make() : PowerOff.make()
 * );
 * ```
 *
 * @example
 * ```tsx
 * // Sync shared value between actors
 * useActorBridge(
 *   source.actor,
 *   target.actor,
 *   (snap) => snap.context.sharedValue,
 *   (value) => Sync.make({ value })
 * );
 * ```
 */
export function useActorBridge<
  S1 extends MachineState,
  C1 extends MachineContext,
  E1 extends MachineEvent,
  S2 extends MachineState,
  C2 extends MachineContext,
  E2 extends MachineEvent,
  T,
>(
  source: MachineActor<S1, C1, E1>,
  target: MachineActor<S2, C2, E2>,
  selector: (snapshot: MachineSnapshot<S1, C1>) => T,
  toEvent: (value: T) => E2,
  deps: readonly unknown[] = []
): void {
  useActorWatch(source, selector, (value) => {
    target.send(toEvent(value));
  }, [target, ...deps]);
}
