import { Cause, Duration, Effect, Exit, Fiber, Option, Runtime, Scope } from "effect";
import type {
  Action,
  ActionEnqueuer,
  AfterEvent,
  AssignResultCatchTagHandler,
  CatchTagHandler,
  EmittedEvent,
  Guard,
  InternalEvent,
  InvokeConfigInternal,
  InvokeSuccessEvent,
  InvokeFailureEvent,
  InvokeDefectEvent,
  InvokeInterruptEvent,
  MachineContext,
  MachineDefinition,
  MachineEvent,
  MachineSnapshot,
  StateNodeConfig,
  StateMachineError,
  TransitionConfig,
} from "./types.js";
import {
  EffectActionError,
  ActivityError,
} from "./types.js";

// ============================================================================
// Machine Creation
// ============================================================================

/**
 * Create a state machine definition.
 *
 * @example Plain context (backwards compatible)
 * ```ts
 * const machine = createMachine({
 *   id: "counter",
 *   initial: "idle",
 *   context: { count: 0 },
 *   states: { ... }
 * });
 * ```
 *
 * @example Schema context (with serialization)
 * ```ts
 * const ContextSchema = Schema.Struct({
 *   count: Schema.Number,
 *   lastUpdated: Schema.DateFromString,
 * });
 *
 * const machine = createMachine({
 *   id: "counter",
 *   initial: "idle",
 *   context: ContextSchema,
 *   initialContext: { count: 0, lastUpdated: new Date() },
 *   states: { ... }
 * });
 * ```
 */
/**
 * Create a state machine with Schema-based context.
 * Type parameters:
 * - TStateValue: The state literal union (e.g., "idle" | "loading" | "done")
 * - TEvent: The event union type
 * - TContextSchema: Use `typeof YourContextSchema`
 *
 * @example
 * ```ts
 * const machine = createMachine<
 *   "idle" | "loading" | "done",
 *   MyEvent,
 *   typeof MyContextSchema
 * >({
 *   id: "myMachine",
 *   initial: "idle",
 *   context: MyContextSchema,
 *   states: { idle: {}, loading: {}, done: {} },
 * });
 * ```
 */
export function createMachine<
  TStateValue extends string,
  TEvent extends MachineEvent,
  TContextSchema extends import("effect").Schema.Schema.Any,
  R = never,
  E = never,
>(config: {
  readonly id: string;
  readonly initial: TStateValue;
  readonly context: TContextSchema;
  readonly initialContext: import("effect").Schema.Schema.Type<TContextSchema>;
  readonly states: Record<TStateValue, StateNodeConfig<TStateValue, import("effect").Schema.Schema.Type<TContextSchema>, TEvent, R, E>>;
}): MachineDefinition<
  string,
  TStateValue,
  import("effect").Schema.Schema.Type<TContextSchema>,
  TEvent,
  R,
  E,
  import("effect").Schema.Schema.Encoded<TContextSchema>
> {
  // Cast necessary: TypeScript can't unify TContextSchema (Schema<any, any, unknown>)
  // with Schema<Type<T>, Encoded<T>, never> due to the third type parameter (Context/R).
  // Fixing this would require exposing Schema's R parameter throughout the API.
  type Def = MachineDefinition<
    string, TStateValue, import("effect").Schema.Schema.Type<TContextSchema>,
    TEvent, R, E, import("effect").Schema.Schema.Encoded<TContextSchema>
  >;

  const definition = {
    _tag: "MachineDefinition" as const,
    id: config.id,
    config: config as unknown as Def["config"],
    initialSnapshot: {
      value: config.initial,
      context: config.initialContext,
      event: null,
    },
    contextSchema: config.context as unknown as Def["contextSchema"],
  };

  return definition;
}

/**
 * Narrow the R channel (requirements) of a machine definition.
 *
 * Use this when your machine uses services via `invoke.src` or `effect()` actions
 * that return Effects requiring services. This is a type-only operation that
 * helps TypeScript understand the machine's service dependencies.
 *
 * @example
 * ```ts
 * // Machine that uses WeatherService in its invoke
 * const GarageDoorMachine = withRequirements<WeatherService>()(
 *   createMachine({
 *     id: "garageDoor",
 *     // ...states that use WeatherService
 *   })
 * );
 *
 * // Now GarageDoorMachine has R = WeatherService
 * type R = MachineDefinitionR<typeof GarageDoorMachine>;
 * // => WeatherService
 * ```
 */
export function withRequirements<R>() {
  return <
    TId extends string,
    TStateValue extends string,
    TContext extends MachineContext,
    TEvent extends MachineEvent,
    _R,
    E,
    TContextEncoded,
  >(
    machine: MachineDefinition<TId, TStateValue, TContext, TEvent, _R, E, TContextEncoded>,
  ): MachineDefinition<TId, TStateValue, TContext, TEvent, R, E, TContextEncoded> => {
    // Type-only operation - the machine is returned unchanged at runtime
    return machine as unknown as MachineDefinition<TId, TStateValue, TContext, TEvent, R, E, TContextEncoded>;
  };
}

// ============================================================================
// Mailbox (XState-style linked list queue)
// ============================================================================

interface MailboxItem<T> {
  value: T;
  next: MailboxItem<T> | null;
}

class Mailbox<T> {
  private _processing = false;
  private _current: MailboxItem<T> | null = null;
  private _last: MailboxItem<T> | null = null;
  private _processor: (event: T) => void;

  constructor(processor: (event: T) => void) {
    this._processor = processor;
  }

  enqueue(event: T): void {
    const item: MailboxItem<T> = { value: event, next: null };

    if (this._current) {
      this._last!.next = item;
      this._last = item;
    } else {
      this._current = item;
      this._last = item;
    }

    if (!this._processing) {
      this.flush();
    }
  }

  private flush(): void {
    this._processing = true;
    while (this._current) {
      const item = this._current;
      this._current = item.next;
      if (!this._current) {
        this._last = null;
      }
      this._processor(item.value);
    }
    this._processing = false;
  }
}

// ============================================================================
// Interpreter Types
// ============================================================================

export interface MachineActor<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
> {
  readonly send: (event: TEvent) => void;
  readonly getSnapshot: () => MachineSnapshot<TStateValue, TContext>;
  readonly subscribe: (observer: (snapshot: MachineSnapshot<TStateValue, TContext>) => void) => () => void;
  readonly on: <TEmitted extends EmittedEvent>(
    eventType: TEmitted["type"],
    handler: (event: TEmitted) => void,
  ) => () => void;
  /** Subscribe to machine errors (observer failures, effect errors, etc.) */
  readonly onError: (handler: (error: StateMachineError) => void) => () => void;
  /**
   * Wait for the machine to reach a state matching the predicate.
   * Returns an Effect that resolves with the snapshot when condition is met.
   *
   * @example
   * ```ts
   * const result = yield* actor.waitFor(s => s.value === "done")
   * ```
   */
  readonly waitFor: (
    predicate: (snapshot: MachineSnapshot<TStateValue, TContext>) => boolean,
  ) => Effect.Effect<MachineSnapshot<TStateValue, TContext>>;
  readonly children: ReadonlyMap<string, MachineActor<string, MachineContext, MachineEvent>>;
  readonly _parent?: MachineActor<string, MachineContext, MachineEvent>;
  /** Stop the actor and clean up resources */
  readonly stop: () => void;
  /**
   * Sync the actor's snapshot from external state (e.g., cross-tab sync).
   * Updates the snapshot and notifies observers without going through normal transitions.
   * Also syncs child actors if childSnapshots is provided.
   */
  readonly _syncSnapshot: (
    newSnapshot: MachineSnapshot<TStateValue, TContext>,
    childSnapshots?: ReadonlyMap<string, MachineSnapshot<string, MachineContext>>,
  ) => void;
  /**
   * Pause all activities and delayed transitions without stopping the actor.
   * Used when tab loses focus to prevent background updates.
   */
  readonly _pauseActivities: () => void;
  /**
   * Resume activities for the current state.
   * Used when tab regains focus to restart animations.
   */
  readonly _resumeActivities: () => void;
}

// ============================================================================
// Interpreter Implementation
// ============================================================================

/**
 * Internal actor creation - used by both interpret and interpretSync
 */
function createActor<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
  TContextEncoded,
>(
  machine: MachineDefinition<TId, TStateValue, TContext, TEvent, R, E, TContextEncoded>,
  options?: {
    parent?: MachineActor<string, MachineContext, MachineEvent>;
    runtime?: Runtime.Runtime<R>;
    /** Initial snapshot to restore from (for persistence) */
    snapshot?: MachineSnapshot<TStateValue, TContext>;
    /** Child snapshots to restore (keyed by child ID) */
    childSnapshots?: ReadonlyMap<string, MachineSnapshot<string, MachineContext>>;
  },
): MachineActor<TStateValue, TContext, TEvent> {
  const runtime = options?.runtime;
  const childSnapshots = options?.childSnapshots;
  // Mutable state - use provided snapshot or initial
  let snapshot: MachineSnapshot<TStateValue, TContext> = options?.snapshot ?? machine.initialSnapshot;
  let stopped = false;

  const observers = new Set<(snapshot: MachineSnapshot<TStateValue, TContext>) => void>();
  const errorHandlers = new Set<(error: StateMachineError) => void>();
  const activityCleanups = new Map<string, () => void>();
  const invokeCleanups = new Map<string, () => void>();
  const delayCleanups = new Map<string, () => void>();
  const persistentDelayCleanups = new Map<string, () => void>(); // survives state exits
  let delayCounter = 0;
  const listenersRef = new Map<string, Set<(event: EmittedEvent) => void>>();
  const childrenRef = new Map<string, MachineActor<string, MachineContext, MachineEvent>>();

  // Helper to access invoke config properties at runtime.
  // InvokeResult is a branded type for public API, but at runtime it's InvokeConfigInternal.
  type InvokeInternal = InvokeConfigInternal<TStateValue, TContext, TEvent, R>;
  const asInvokeConfig = (invoke: unknown): InvokeInternal => invoke as InvokeInternal;

  // Emit error to all error handlers
  const emitError = (error: StateMachineError) => {
    errorHandlers.forEach((handler) => {
      try {
        handler(error);
      } catch {
        // Prevent error handler errors from cascading
      }
    });
  };

  // Deferred effects to run after state update
  const deferredEffects: Array<() => void> = [];

  const flushDeferred = () => {
    while (deferredEffects.length > 0) {
      const fn = deferredEffects.shift()!;
      try { fn(); } catch { /* ignore */ }
    }
  };

  const notifyObservers = () => {
    observers.forEach((observer) => {
      try { observer(snapshot); } catch { /* isolate only */ }
    });
  };

  const emitEvent = (event: EmittedEvent) => {
    const listeners = listenersRef.get(event.type);
    if (listeners) {
      listeners.forEach((handler) => handler(event));
    }
  };

  const on = <TEmitted extends EmittedEvent>(
    eventType: TEmitted["type"],
    handler: (event: TEmitted) => void,
  ): (() => void) => {
    let listeners = listenersRef.get(eventType);
    if (!listeners) {
      listeners = new Set();
      listenersRef.set(eventType, listeners);
    }
    listeners.add(handler as (event: EmittedEvent) => void);
    return () => listeners!.delete(handler as (event: EmittedEvent) => void);
  };

  // Forward declare actor
  let actor: MachineActor<TStateValue, TContext, TEvent>;

  const cancelDelay = (id: string) => {
    // Check both regular and persistent delays
    const cleanup = delayCleanups.get(id) ?? persistentDelayCleanups.get(id);
    if (cleanup) {
      cleanup();
      delayCleanups.delete(id);
      persistentDelayCleanups.delete(id);
    }
  };

  const stopAllDelays = () => {
    delayCleanups.forEach((cleanup) => {
      try { cleanup(); } catch { /* ignore */ }
    });
    delayCleanups.clear();
  };

  const stopAllPersistentDelays = () => {
    persistentDelayCleanups.forEach((cleanup) => {
      try { cleanup(); } catch { /* ignore */ }
    });
    persistentDelayCleanups.clear();
  };

  const sendToChild = (childId: string, event: MachineEvent): void => {
    const child = childrenRef.get(childId);
    if (child) child.send(event);
  };

  const sendToParent = (event: MachineEvent): void => {
    if (actor._parent) actor._parent.send(event);
  };

  // Type alias for events that can be processed (user events + internal events)
  type ProcessableEvent = TEvent | InternalEvent<TStateValue>;

  // Internal events can trigger state transitions which call user callbacks (activities, invokes).
  // User callbacks are typed to receive TEvent, but may receive internal events.
  // This cast is safe because internal events satisfy MachineEvent (they have _tag).
  const asUserEvent = (e: ProcessableEvent): TEvent => e as TEvent;

  const processEvent = (event: ProcessableEvent): void => {
    if (stopped) return;

    const stateConfig = machine.config.states[snapshot.value];

    // Handle $after events
    if (event._tag === "$after") {
      const afterEvent = event as AfterEvent<TStateValue>;

      let targetState: TStateValue;
      let transitionConfig: TransitionConfig<TStateValue, TContext, TEvent, R, E> | undefined;

      // Persistent delays include the target in the event
      if (afterEvent.target) {
        targetState = afterEvent.target;
        transitionConfig = { target: targetState };
      } else {
        // Normal delays look up config from current state
        const afterConfig = stateConfig?.after;
        if (!afterConfig) return;

        if ("delay" in afterConfig && "transition" in afterConfig) {
          transitionConfig = afterConfig.transition as TransitionConfig<TStateValue, TContext, TEvent, R, E>;
        } else {
          const delays = afterConfig as Record<number, TransitionConfig<TStateValue, TContext, TEvent, R, E>>;
          transitionConfig = delays[Number(afterEvent.delay)];
        }

        if (!transitionConfig?.target) return;
        targetState = transitionConfig.target;
      }
      let newContext = snapshot.context;
      const userEvent = asUserEvent(event);

      if (stateConfig?.exit) {
        newContext = runActionsSync(stateConfig.exit, newContext, userEvent);
      }

      stopAllActivities();
      stopAllInvokes();
      stopAllDelays();

      if (transitionConfig.actions) {
        newContext = runActionsSync(
          transitionConfig.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
          newContext,
          userEvent,
        );
      }

      const targetStateConfig = machine.config.states[targetState];
      if (targetStateConfig?.entry) {
        newContext = runActionsSync(targetStateConfig.entry, newContext, userEvent);
      }

      snapshot = { value: targetState, context: newContext, event: userEvent };

      if (targetStateConfig?.activities) {
        startActivities(targetStateConfig.activities, newContext, userEvent);
      }

      if (targetStateConfig?.invoke) {
        // Cast InvokeResult to InvokeConfigInternal - same object at runtime
        startInvoke(asInvokeConfig(targetStateConfig.invoke), newContext, userEvent);
      }

      if (targetStateConfig?.after) {
        scheduleAfterTransition(targetStateConfig.after);
      }

      flushDeferred();
      notifyObservers();
      return;
    }

    // Handle $invoke.success events (also handles legacy $invoke.done)
    if (event._tag === "$invoke.success") {
      // Cast required: TS doesn't narrow TEvent | InternalEvent because TEvent could have same _tag
      const successEvent = event as InvokeSuccessEvent;
      const userEvent = asUserEvent(event);
      const invokeConfig = stateConfig?.invoke ? asInvokeConfig(stateConfig.invoke) : undefined;

      // Check for assignResult shorthand first
      if (invokeConfig?.assignResult?.success) {
        invokeCleanups.delete(successEvent.id);
        const updates = invokeConfig.assignResult.success({
          context: snapshot.context,
          output: successEvent.output,
        });
        snapshot = {
          value: snapshot.value,
          context: { ...snapshot.context, ...updates },
          event: userEvent,
        };
        notifyObservers();
        return;
      }

      const handler = invokeConfig?.onSuccess ?? invokeConfig?.onDone;
      if (!handler) return;

      // Clean up the invoke
      invokeCleanups.delete(successEvent.id);

      // Check guard if present
      if (handler.guard) {
        if (!handler.guard({ context: snapshot.context, event: successEvent })) {
          return;
        }
      }

      const targetState = handler.target ?? snapshot.value;
      const isTransition = targetState !== snapshot.value;

      let newContext = snapshot.context;

      if (isTransition && stateConfig?.exit) {
        newContext = runActionsSync(stateConfig.exit, newContext, userEvent);
      }

      if (isTransition) {
        stopAllActivities();
        stopAllInvokes();
        stopAllDelays();
      }

      if (handler.actions) {
        // Cast needed: handler.actions is typed for InvokeSuccessEvent, runActionsSync expects TEvent
        newContext = runActionsSync(
          handler.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
          newContext,
          successEvent as unknown as TEvent,
        );
      }

      const targetStateConfig = machine.config.states[targetState];
      if (isTransition && targetStateConfig?.entry) {
        newContext = runActionsSync(targetStateConfig.entry, newContext, userEvent);
      }

      snapshot = { value: targetState, context: newContext, event: userEvent };

      if (isTransition && targetStateConfig?.activities) {
        startActivities(targetStateConfig.activities, newContext, userEvent);
      }

      if (isTransition && targetStateConfig?.invoke) {
        startInvoke(asInvokeConfig(targetStateConfig.invoke), newContext, userEvent);
      }

      if (isTransition && targetStateConfig?.after) {
        scheduleAfterTransition(targetStateConfig.after);
      }

      flushDeferred();
      notifyObservers();
      return;
    }

    // Handle $invoke.failure events (typed errors with catchTags support)
    if (event._tag === "$invoke.failure") {
      // Cast required: TS doesn't narrow TEvent | InternalEvent because TEvent could have same _tag
      const failureEvent = event as InvokeFailureEvent;
      const userEvent = asUserEvent(event);
      const invokeConfig = stateConfig?.invoke ? asInvokeConfig(stateConfig.invoke) : undefined;

      // Clean up the invoke
      invokeCleanups.delete(failureEvent.id);

      // Check for assignResult shorthand first
      if (invokeConfig?.assignResult) {
        let updates: Partial<TContext> | undefined;

        // Check catchTags first if error has _tag
        if (
          invokeConfig.assignResult.catchTags &&
          typeof failureEvent.error === "object" &&
          failureEvent.error !== null &&
          "_tag" in failureEvent.error
        ) {
          const errorTag = (failureEvent.error as { _tag: string })._tag;
          // Dynamic lookup by runtime error tag - handler type is narrowed to the base TaggedError shape
          const tagHandler = (invokeConfig.assignResult.catchTags as Record<string, AssignResultCatchTagHandler<TContext>>)[errorTag];
          if (tagHandler) {
            updates = tagHandler({ context: snapshot.context, error: failureEvent.error as { _tag: string } });
          }
        }

        // Fall back to failure handler
        if (updates === undefined && invokeConfig.assignResult.failure) {
          updates = invokeConfig.assignResult.failure({
            context: snapshot.context,
            error: failureEvent.error,
          });
        }

        if (updates !== undefined) {
          snapshot = {
            value: snapshot.value,
            context: { ...snapshot.context, ...updates },
            event: userEvent,
          };
          notifyObservers();
          return;
        }
      }

      // First, check catchTags if error has _tag
      // Dynamic lookup by runtime error tag - handler type uses base TaggedError shape
      let handler: CatchTagHandler<TStateValue, TContext, R, E> | undefined;

      if (
        invokeConfig?.catchTags &&
        typeof failureEvent.error === "object" &&
        failureEvent.error !== null &&
        "_tag" in failureEvent.error
      ) {
        const errorTag = (failureEvent.error as { _tag: string })._tag;
        handler = (invokeConfig.catchTags as Record<string, CatchTagHandler<TStateValue, TContext, R, E>>)[errorTag];
      }

      // Fall back to onFailure or onError
      // onFailure/onError have the same shape but with InvokeFailureEvent<unknown> instead of TaggedError
      if (!handler) {
        handler = (invokeConfig?.onFailure ?? invokeConfig?.onError) as CatchTagHandler<TStateValue, TContext, R, E> | undefined;
      }

      if (!handler) return;

      // Check guard if present
      if (handler.guard) {
        if (!(handler.guard as Guard<TContext, InvokeFailureEvent>)({ context: snapshot.context, event: failureEvent })) {
          return;
        }
      }

      const targetState = handler.target ?? snapshot.value;
      const isTransition = targetState !== snapshot.value;

      let newContext = snapshot.context;

      if (isTransition && stateConfig?.exit) {
        newContext = runActionsSync(stateConfig.exit, newContext, userEvent);
      }

      if (isTransition) {
        stopAllActivities();
        stopAllInvokes();
        stopAllDelays();
      }

      if (handler.actions) {
        // Cast needed: handler.actions is typed for InvokeFailureEvent, runActionsSync expects TEvent
        newContext = runActionsSync(
          handler.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
          newContext,
          failureEvent as unknown as TEvent,
        );
      }

      const targetStateConfig = machine.config.states[targetState];
      if (isTransition && targetStateConfig?.entry) {
        newContext = runActionsSync(targetStateConfig.entry, newContext, userEvent);
      }

      snapshot = { value: targetState, context: newContext, event: userEvent };

      if (isTransition && targetStateConfig?.activities) {
        startActivities(targetStateConfig.activities, newContext, userEvent);
      }

      if (isTransition && targetStateConfig?.invoke) {
        startInvoke(asInvokeConfig(targetStateConfig.invoke), newContext, userEvent);
      }

      if (isTransition && targetStateConfig?.after) {
        scheduleAfterTransition(targetStateConfig.after);
      }

      flushDeferred();
      notifyObservers();
      return;
    }

    // Handle $invoke.defect events (unexpected errors)
    if (event._tag === "$invoke.defect") {
      // Cast required: TS doesn't narrow TEvent | InternalEvent because TEvent could have same _tag
      const defectEvent = event as InvokeDefectEvent;
      const userEvent = asUserEvent(event);
      const invokeConfig = stateConfig?.invoke ? asInvokeConfig(stateConfig.invoke) : undefined;

      // Clean up the invoke
      invokeCleanups.delete(defectEvent.id);

      // Check for assignResult shorthand first
      if (invokeConfig?.assignResult?.defect) {
        const updates = invokeConfig.assignResult.defect({
          context: snapshot.context,
          defect: defectEvent.defect,
        });
        snapshot = {
          value: snapshot.value,
          context: { ...snapshot.context, ...updates },
          event: userEvent,
        };
        notifyObservers();
        return;
      }

      if (!invokeConfig?.onDefect) return;

      const targetState = invokeConfig.onDefect.target ?? snapshot.value;
      const isTransition = targetState !== snapshot.value;

      let newContext = snapshot.context;

      if (isTransition && stateConfig?.exit) {
        newContext = runActionsSync(stateConfig.exit, newContext, userEvent);
      }

      if (isTransition) {
        stopAllActivities();
        stopAllInvokes();
        stopAllDelays();
      }

      if (invokeConfig.onDefect.actions) {
        // Cast needed: onDefect.actions is typed for InvokeDefectEvent, runActionsSync expects TEvent
        newContext = runActionsSync(
          invokeConfig.onDefect.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
          newContext,
          defectEvent as unknown as TEvent,
        );
      }

      const targetStateConfig = machine.config.states[targetState];
      if (isTransition && targetStateConfig?.entry) {
        newContext = runActionsSync(targetStateConfig.entry, newContext, userEvent);
      }

      snapshot = { value: targetState, context: newContext, event: userEvent };

      if (isTransition && targetStateConfig?.activities) {
        startActivities(targetStateConfig.activities, newContext, userEvent);
      }

      if (isTransition && targetStateConfig?.invoke) {
        startInvoke(asInvokeConfig(targetStateConfig.invoke), newContext, userEvent);
      }

      if (isTransition && targetStateConfig?.after) {
        scheduleAfterTransition(targetStateConfig.after);
      }

      flushDeferred();
      notifyObservers();
      return;
    }

    // Handle $invoke.interrupt events
    if (event._tag === "$invoke.interrupt") {
      // Cast required: TS doesn't narrow TEvent | InternalEvent because TEvent could have same _tag
      const interruptEvent = event as InvokeInterruptEvent;
      const userEvent = asUserEvent(event);
      const invokeConfig = stateConfig?.invoke ? asInvokeConfig(stateConfig.invoke) : undefined;

      // Clean up the invoke
      invokeCleanups.delete(interruptEvent.id);

      if (!invokeConfig?.onInterrupt) return;

      const targetState = invokeConfig.onInterrupt.target ?? snapshot.value;
      const isTransition = targetState !== snapshot.value;

      let newContext = snapshot.context;

      if (isTransition && stateConfig?.exit) {
        newContext = runActionsSync(stateConfig.exit, newContext, userEvent);
      }

      if (isTransition) {
        stopAllActivities();
        stopAllInvokes();
        stopAllDelays();
      }

      if (invokeConfig.onInterrupt.actions) {
        // Cast needed: onInterrupt.actions is typed for InvokeInterruptEvent, runActionsSync expects TEvent
        newContext = runActionsSync(
          invokeConfig.onInterrupt.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
          newContext,
          interruptEvent as unknown as TEvent,
        );
      }

      const targetStateConfig = machine.config.states[targetState];
      if (isTransition && targetStateConfig?.entry) {
        newContext = runActionsSync(targetStateConfig.entry, newContext, userEvent);
      }

      snapshot = { value: targetState, context: newContext, event: userEvent };

      if (isTransition && targetStateConfig?.activities) {
        startActivities(targetStateConfig.activities, newContext, userEvent);
      }

      if (isTransition && targetStateConfig?.invoke) {
        startInvoke(asInvokeConfig(targetStateConfig.invoke), newContext, userEvent);
      }

      if (isTransition && targetStateConfig?.after) {
        scheduleAfterTransition(targetStateConfig.after);
      }

      flushDeferred();
      notifyObservers();
      return;
    }

    if (!stateConfig?.on) return;

    // At this point, we know event is a user event (all internal events returned early above)
    const userEvent = event as TEvent;

    // Index with type assertion since TS can't narrow the mapped type key
    const transitionConfig = stateConfig.on[userEvent._tag as TEvent["_tag"]];
    if (!transitionConfig) return;

    if (transitionConfig.guard) {
      // Cast guard to accept the event (narrowed event type is compatible)
      const guardFn = transitionConfig.guard as Guard<TContext, TEvent>;
      if (!guardFn({ context: snapshot.context, event: userEvent })) {
        return;
      }
    }

    const targetState = transitionConfig.target ?? snapshot.value;
    const isTransition = targetState !== snapshot.value;

    let newContext = snapshot.context;

    if (isTransition && stateConfig.exit) {
      newContext = runActionsSync(stateConfig.exit, newContext, userEvent);
    }

    if (isTransition) {
      stopAllActivities();
      stopAllInvokes();
      stopAllDelays();
    }

    if (transitionConfig.actions) {
      newContext = runActionsSync(
        transitionConfig.actions as ReadonlyArray<Action<TContext, TEvent, R, E>>,
        newContext,
        userEvent,
      );
    }

    const targetStateConfig = machine.config.states[targetState as TStateValue];
    if (isTransition && targetStateConfig?.entry) {
      newContext = runActionsSync(targetStateConfig.entry, newContext, userEvent);
    }

    snapshot = { value: targetState as TStateValue, context: newContext, event: userEvent };

    if (isTransition && targetStateConfig?.activities) {
      startActivities(targetStateConfig.activities, newContext, userEvent);
    }

    if (isTransition && targetStateConfig?.invoke) {
      startInvoke(asInvokeConfig(targetStateConfig.invoke), newContext, userEvent);
    }

    if (isTransition && targetStateConfig?.after) {
      scheduleAfterTransition(targetStateConfig.after);
    }

    flushDeferred();
    notifyObservers();
  };

  const runActionsSync = (
    actions: ReadonlyArray<Action<TContext, TEvent, any, any>>,
    context: TContext,
    event: TEvent,
  ): TContext => {
    let ctx = context;
    for (const action of actions) {
      switch (action._tag) {
        case "assign": {
          const updates = action.fn({ context: ctx, event });
          ctx = { ...ctx, ...updates };
          break;
        }
        case "effect": {
          // Defer effect - run async with Exit-based error handling
          const eff = action.fn({ context: ctx, event });
          deferredEffects.push(() => {
            // Use runtime if available (from interpret), otherwise run directly (interpretSync)
            const runEffect = runtime
              ? Runtime.runPromiseExit(runtime)(eff as Effect.Effect<void, unknown, R>)
              : Effect.runPromiseExit(eff as Effect.Effect<void>);

            runEffect.then((exit) => {
              Exit.match(exit, {
                onFailure: (cause) => {
                  emitError(new EffectActionError({
                    message: "Effect action failed",
                    cause,
                  }));
                },
                onSuccess: () => {},
              });
            });
          });
          break;
        }
        case "raise": {
          const raisedEvent = typeof action.event === "function"
            ? action.event({ context: ctx, event })
            : action.event;
          mailbox.enqueue(raisedEvent as TEvent);
          break;
        }
        case "cancel": {
          const id = typeof action.sendId === "function"
            ? action.sendId({ context: ctx, event })
            : action.sendId;
          cancelDelay(id);
          break;
        }
        case "emit": {
          const emitted = typeof action.event === "function"
            ? action.event({ context: ctx, event })
            : action.event;
          emitEvent(emitted);
          break;
        }
        case "enqueueActions": {
          const queue: Array<Action<TContext, TEvent, any, any>> = [];
          const enqueue = createActionEnqueuer<TContext, TEvent, any, any>(queue);
          action.collect({ context: ctx, event, enqueue });
          ctx = runActionsSync(queue, ctx, event);
          break;
        }
        case "spawnChild": {
          const childId = typeof action.id === "function"
            ? action.id({ context: ctx, event })
            : action.id;
          // Only spawn if child doesn't already exist (idempotent)
          if (!childrenRef.has(childId)) {
            // Spawn child synchronously, inherit runtime for service access
            // Cast AnyMachineDefinition back to full MachineDefinition for createActor
            const childMachine = action.src as unknown as MachineDefinition<string, string, MachineContext, MachineEvent, unknown, unknown, unknown>;
            // Check if we have a saved snapshot for this child
            const childSnapshot = childSnapshots?.get(childId);
            // Build options conditionally to satisfy exactOptionalPropertyTypes
            const childOptions: {
              parent: MachineActor<string, MachineContext, MachineEvent>;
              runtime?: Runtime.Runtime<unknown>;
              snapshot?: MachineSnapshot<string, MachineContext>;
            } = {
              parent: actor as unknown as MachineActor<string, MachineContext, MachineEvent>,
            };
            if (runtime) childOptions.runtime = runtime as Runtime.Runtime<unknown>;
            if (childSnapshot) childOptions.snapshot = childSnapshot;
            const childActor = createActor(childMachine, childOptions);
            childrenRef.set(childId, childActor);
          }
          break;
        }
        case "stopChild": {
          const childId = typeof action.childId === "function"
            ? action.childId({ context: ctx, event })
            : action.childId;
          const child = childrenRef.get(childId);
          if (child) {
            child.stop();
            childrenRef.delete(childId);
          }
          break;
        }
        case "sendTo": {
          const targetId = typeof action.target === "function"
            ? action.target({ context: ctx, event })
            : action.target;
          const targetEvent = typeof action.event === "function"
            ? action.event({ context: ctx, event })
            : action.event;
          sendToChild(targetId, targetEvent);
          break;
        }
        case "sendParent": {
          const parentEvent = typeof action.event === "function"
            ? action.event({ context: ctx, event })
            : action.event;
          sendToParent(parentEvent);
          break;
        }
        case "forwardTo": {
          const targetId = typeof action.target === "function"
            ? action.target({ context: ctx, event })
            : action.target;
          sendToChild(targetId, event);
          break;
        }
      }
    }
    return ctx;
  };

  const stopAllActivities = () => {
    activityCleanups.forEach((cleanup) => {
      try { cleanup(); } catch { /* ignore */ }
    });
    activityCleanups.clear();
  };

  const stopAllInvokes = () => {
    invokeCleanups.forEach((cleanup) => {
      try { cleanup(); } catch { /* ignore */ }
    });
    invokeCleanups.clear();
  };

  const startActivities = (
    activities: ReadonlyArray<{
      readonly id: string;
      readonly src: (params: { context: TContext; event: TEvent; send: (event: TEvent) => void }) => Effect.Effect<void, any, any>;
    }>,
    context: TContext,
    event: TEvent,
  ) => {
    for (const activity of activities) {
      const send = (e: TEvent) => {
        if (!stopped) mailbox.enqueue(e);
      };

      // Fork the activity and store the fiber for interruption
      const activityId = activity.id;
      const activityEffect = activity.src({ context, event, send }).pipe(
        // catchAllCause handles both typed errors and defects
        Effect.catchAllCause((cause) => {
          emitError(new ActivityError({
            message: `Activity "${activityId}" failed`,
            activityId,
            cause,
          }));
          return Effect.void;
        }),
      );

      // Use runtime if available, otherwise run directly
      const fiber = runtime
        ? Runtime.runFork(runtime)(activityEffect as Effect.Effect<void, never, R>)
        : Effect.runFork(activityEffect as Effect.Effect<void>);

      activityCleanups.set(activity.id, () => {
        Effect.runFork(Fiber.interrupt(fiber));
      });
    }
  };

  const startInvoke = (
    invoke: InvokeConfigInternal<TStateValue, TContext, TEvent, R>,
    context: TContext,
    event: TEvent,
  ) => {
    const invokeId = invoke.id ?? `invoke-${Date.now()}`;

    const invokeEffect = invoke.src({ context, event }).pipe(
      Effect.matchCauseEffect({
        onSuccess: (output) => {
          if (!stopped) {
            mailbox.enqueue({
              _tag: "$invoke.success",
              id: invokeId,
              output,
            });
          }
          return Effect.void;
        },
        onFailure: (cause) => {
          if (stopped) return Effect.void;

          // Check for interrupt first
          if (Cause.isInterruptedOnly(cause)) {
            mailbox.enqueue({
              _tag: "$invoke.interrupt",
              id: invokeId,
            });
            return Effect.void;
          }

          // Check for typed failure (E channel)
          const failure = Cause.failureOption(cause);
          if (Option.isSome(failure)) {
            mailbox.enqueue({
              _tag: "$invoke.failure",
              id: invokeId,
              error: failure.value,
            });
            return Effect.void;
          }

          // Check for defect (unexpected error)
          const defect = Cause.dieOption(cause);
          if (Option.isSome(defect)) {
            mailbox.enqueue({
              _tag: "$invoke.defect",
              id: invokeId,
              defect: defect.value,
            });
            return Effect.void;
          }

          // Fallback: treat as defect with the full cause
          mailbox.enqueue({
            _tag: "$invoke.defect",
            id: invokeId,
            defect: cause,
          });
          return Effect.void;
        },
      }),
    );

    // Fork the invoke effect
    const fiber = runtime
      ? Runtime.runFork(runtime)(invokeEffect as Effect.Effect<void, never, R>)
      : Effect.runFork(invokeEffect as Effect.Effect<void>);

    invokeCleanups.set(invokeId, () => {
      Effect.runFork(Fiber.interrupt(fiber));
    });
  };

  const scheduleAfterTransition = (
    after: StateNodeConfig<TStateValue, TContext, TEvent, any, any>["after"],
  ) => {
    if (!after) return;

    // Schedule a delay with Duration (milliseconds)
    const scheduleDelayMs = (
      delayMs: number,
      delayKey: number | string,
      transitionId?: string,
      persistent = false,
      target?: TStateValue,
    ) => {
      const cleanupId = transitionId ?? `$delay_${delayCounter++}`;
      const cleanupMap = persistent ? persistentDelayCleanups : delayCleanups;

      // For persistent delays, include target in the event so it works across state changes
      const afterEvent: AfterEvent<TStateValue> = persistent && target
        ? { _tag: "$after", delay: delayKey, target }
        : { _tag: "$after", delay: delayKey };

      const delayEffect = Effect.sleep(Duration.millis(delayMs)).pipe(
        Effect.flatMap(() =>
          Effect.sync(() => {
            cleanupMap.delete(cleanupId);
            mailbox.enqueue(afterEvent);
          })
        ),
      );

      const fiber = runtime
        ? Runtime.runFork(runtime)(delayEffect as Effect.Effect<void, never, R>)
        : Effect.runFork(delayEffect);

      cleanupMap.set(cleanupId, () => {
        Effect.runFork(Fiber.interrupt(fiber));
      });
    };

    // Schedule a delay with a user-provided Effect
    const scheduleDelayEffect = (
      userEffect: Effect.Effect<void, never, R>,
      delayKey: string,
      transitionId?: string,
      persistent = false,
      target?: TStateValue,
    ) => {
      const cleanupId = transitionId ?? `$delay_${delayCounter++}`;
      const cleanupMap = persistent ? persistentDelayCleanups : delayCleanups;

      // For persistent delays, include target in the event so it works across state changes
      const afterEvent: AfterEvent<TStateValue> = persistent && target
        ? { _tag: "$after", delay: delayKey, target }
        : { _tag: "$after", delay: delayKey };

      const delayEffect = userEffect.pipe(
        Effect.flatMap(() =>
          Effect.sync(() => {
            cleanupMap.delete(cleanupId);
            mailbox.enqueue(afterEvent);
          })
        ),
      );

      // Cast needed for else branch: user is warned via console.warn if using Effect delays without runtime
      const fiber = runtime
        ? Runtime.runFork(runtime)(delayEffect as Effect.Effect<void, never, R>)
        : Effect.runFork(delayEffect as Effect.Effect<void, never, never>);

      cleanupMap.set(cleanupId, () => {
        Effect.runFork(Fiber.interrupt(fiber));
      });
    };

    if ("delay" in after && "transition" in after) {
      const transition = after.transition as TransitionConfig<TStateValue, TContext, TEvent, any, any>;
      const transitionId = transition.id;
      const persistent = (after as { persistent?: boolean }).persistent ?? false;
      const target = transition.target;

      // Check if delay is an Effect or Duration
      if (Effect.isEffect(after.delay)) {
        if (!runtime) {
          console.warn(
            "[effstate] Effect-based delays require interpret() with a runtime. " +
            "Using interpretSync() with Effect delays that require services will fail. " +
            "Consider using Duration-based delays or switch to interpret()."
          );
        }
        scheduleDelayEffect(
          after.delay as Effect.Effect<void, never, R>,
          "$effect",
          transitionId,
          persistent,
          target,
        );
      } else {
        const delayMs = Duration.toMillis(Duration.decode(after.delay as Duration.DurationInput));
        scheduleDelayMs(delayMs, delayMs, transitionId, persistent, target);
      }
      return;
    }

    // Numeric shorthand: { 1000: { target: "done" } }
    const entries = Object.entries(after as Record<number, TransitionConfig<TStateValue, TContext, TEvent, any, any>>);
    for (const [delayMs, config] of entries) {
      scheduleDelayMs(Number(delayMs), delayMs, config.id, false);
    }
  };

  const stop = () => {
    stopped = true;
    stopAllActivities();
    stopAllInvokes();
    stopAllDelays();
    stopAllPersistentDelays();
    childrenRef.forEach((child) => child.stop());
    childrenRef.clear();
  };

  // Create mailbox - accepts both user events and internal events
  const mailbox = new Mailbox<TEvent | InternalEvent<TStateValue>>(processEvent);

  // waitFor implementation - returns Effect that resolves when predicate matches
  const waitFor = (
    predicate: (snapshot: MachineSnapshot<TStateValue, TContext>) => boolean,
  ): Effect.Effect<MachineSnapshot<TStateValue, TContext>> => {
    // Check if already satisfied
    if (predicate(snapshot)) {
      return Effect.succeed(snapshot);
    }

    // Use Effect.async to bridge callback-based subscription to Effect
    return Effect.async<MachineSnapshot<TStateValue, TContext>>((resume) => {
      let resolved = false;

      const observer = (newSnapshot: MachineSnapshot<TStateValue, TContext>) => {
        if (!resolved && predicate(newSnapshot)) {
          resolved = true;
          observers.delete(observer);
          resume(Effect.succeed(newSnapshot));
        }
      };

      observers.add(observer);

      // Return cleanup function for interruption
      return Effect.sync(() => {
        observers.delete(observer);
      });
    });
  };

  // Pause activities without stopping the actor (for tab visibility changes)
  const pauseActivities = () => {
    stopAllActivities();
    stopAllDelays();
    // Recursively pause children
    childrenRef.forEach((child) => {
      child._pauseActivities();
    });
  };

  // Resume activities for the current state (for when window regains focus)
  const resumeActivities = () => {
    const currentState = machine.config.states[snapshot.value];
    if (currentState?.activities) {
      startActivities(currentState.activities, snapshot.context, { _tag: "$resume" } as TEvent);
    }
    if (currentState?.after) {
      scheduleAfterTransition(currentState.after);
    }
    // Recursively resume children
    childrenRef.forEach((child) => {
      child._resumeActivities();
    });
  };

  // Sync snapshot from external source (e.g., cross-tab sync)
  const syncSnapshot = (
    newSnapshot: MachineSnapshot<TStateValue, TContext>,
    childSnapshotsToSync?: ReadonlyMap<string, MachineSnapshot<string, MachineContext>>,
  ) => {
    const previousState = snapshot.value;
    const newState = newSnapshot.value;
    const stateChanged = previousState !== newState;

    // Only stop/restart activities if state actually changed
    if (stateChanged) {
      stopAllActivities();
      stopAllDelays();
    }

    // Update the snapshot
    snapshot = newSnapshot;

    // Sync child snapshots if provided
    if (childSnapshotsToSync) {
      childSnapshotsToSync.forEach((childSnapshot, childId) => {
        const child = childrenRef.get(childId);
        if (child) {
          child._syncSnapshot(childSnapshot as MachineSnapshot<string, MachineContext>);
        }
      });
    }

    // Only restart activities if state changed
    if (stateChanged) {
      const currentState = machine.config.states[snapshot.value];
      if (currentState?.activities) {
        startActivities(currentState.activities, snapshot.context, { _tag: "$sync" } as TEvent);
      }
      if (currentState?.after) {
        scheduleAfterTransition(currentState.after);
      }
    }

    // Notify observers of the new snapshot
    notifyObservers();
  };

  // Create actor
  actor = {
    send: (event: TEvent) => mailbox.enqueue(event),
    getSnapshot: () => snapshot,
    subscribe: (observer) => {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    on,
    onError: (handler) => {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    waitFor,
    children: childrenRef as ReadonlyMap<string, MachineActor<string, MachineContext, MachineEvent>>,
    stop,
    _syncSnapshot: syncSnapshot,
    _pauseActivities: pauseActivities,
    _resumeActivities: resumeActivities,
    ...(options?.parent ? { _parent: options.parent } : {}),
  };

  // Determine if we're restoring from a saved snapshot
  const isRestoring = options?.snapshot !== undefined;
  // Use restored state or initial state
  const currentState = machine.config.states[snapshot.value];
  const initialState = machine.config.states[machine.config.initial];

  // When restoring to a non-initial state, first spawn any children from the initial state's entry actions
  // This ensures children exist even if we're restoring to a state that doesn't have spawnChild actions
  const restoringToNonInitialState = isRestoring && snapshot.value !== machine.config.initial;
  if (restoringToNonInitialState && initialState?.entry) {
    const spawnActions = initialState.entry.filter((a) => a._tag === "spawnChild");
    if (spawnActions.length > 0) {
      runActionsSync(spawnActions, snapshot.context, { _tag: "$init" } as TEvent);
    }
  }

  // Run entry actions for current state
  if (currentState?.entry) {
    // When restoring, filter out assign actions (context is already restored)
    // Only filter out spawnChild if we already handled them above (restoring to non-initial state)
    const actions = isRestoring
      ? currentState.entry.filter((a) =>
          a._tag !== "assign" &&
          (restoringToNonInitialState ? a._tag !== "spawnChild" : true)
        )
      : currentState.entry;
    if (actions.length > 0) {
      snapshot = {
        ...snapshot,
        context: runActionsSync(actions, snapshot.context, { _tag: "$init" } as TEvent),
      };
    }
  }

  // Start activities for current state (always needed, even when restoring)
  if (currentState?.activities) {
    startActivities(currentState.activities, snapshot.context, { _tag: "$init" } as TEvent);
  }

  // Start invoke for current state (always needed, even when restoring)
  if (currentState?.invoke) {
    startInvoke(asInvokeConfig(currentState.invoke), snapshot.context, { _tag: "$init" } as TEvent);
  }

  // Handle delayed transitions for current state (always needed, even when restoring)
  if (currentState?.after) {
    scheduleAfterTransition(currentState.after);
  }

  flushDeferred();

  return actor;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Interpret a machine, returning an Effect that creates the actor.
 *
 * This is the primary API for Effect users. It:
 * - Captures the current Effect runtime to run effect actions with services
 * - Integrates with Scope for automatic cleanup
 * - Supports dependency injection via Effect.provideService
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const actor = yield* interpret(machine)
 *   actor.send(new MyEvent())
 *   const result = yield* actor.waitFor(s => s.value === "done")
 * })
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provideService(ApiService, liveApi),
 *     Effect.scoped
 *   )
 * )
 * ```
 */
export const interpret = <
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
  TContextEncoded,
>(
  machine: MachineDefinition<TId, TStateValue, TContext, TEvent, R, E, TContextEncoded>,
  options?: {
    parent?: MachineActor<string, MachineContext, MachineEvent>;
    /** Initial snapshot to restore from (for persistence) */
    snapshot?: MachineSnapshot<TStateValue, TContext>;
    /** Child snapshots to restore (keyed by child ID) */
    childSnapshots?: ReadonlyMap<string, MachineSnapshot<string, MachineContext>>;
  },
): Effect.Effect<MachineActor<TStateValue, TContext, TEvent>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    // Capture runtime to run effects with the current context (services)
    const runtime = yield* Effect.runtime<R>();

    const actor = createActor(machine, {
      ...options,
      runtime,
    });

    // Register cleanup when scope closes
    yield* Effect.addFinalizer(() => Effect.sync(() => actor.stop()));

    return actor;
  });

/**
 * Synchronously interpret a machine without Effect context.
 *
 * This is the escape hatch for:
 * - React components that manage lifecycle themselves
 * - Simple use cases that don't need services
 * - Backwards compatibility
 *
 * Note: Effect actions that require services (R !== never) will fail at runtime.
 *
 * @example
 * ```ts
 * const actor = interpretSync(machine)
 * actor.send(new MyEvent())
 * // Don't forget to clean up!
 * actor.stop()
 * ```
 */
export function interpretSync<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
  TContextEncoded,
>(
  machine: MachineDefinition<TId, TStateValue, TContext, TEvent, R, E, TContextEncoded>,
  options?: {
    parent?: MachineActor<string, MachineContext, MachineEvent>;
  },
): MachineActor<TStateValue, TContext, TEvent> {
  return createActor(machine, options);
}

// ============================================================================
// Internal Helpers
// ============================================================================

const createActionEnqueuer = <TContext extends MachineContext, TEvent extends MachineEvent, R, E>(
  queue: Array<Action<TContext, TEvent, R, E>>,
): ActionEnqueuer<TContext, TEvent, R, E> => {
  const enqueue = ((action: Action<TContext, TEvent, R, E>) => {
    queue.push(action);
  }) as ActionEnqueuer<TContext, TEvent, R, E>;

  enqueue.assign = (assignment) => {
    queue.push({
      _tag: "assign",
      fn: typeof assignment === "function" ? assignment : () => assignment,
    } as Action<TContext, TEvent, R, E>);
  };

  enqueue.raise = (event) => {
    queue.push({
      _tag: "raise",
      event,
    } as Action<TContext, TEvent, R, E>);
  };

  enqueue.effect = (fn) => {
    queue.push({
      _tag: "effect",
      fn,
    } as Action<TContext, TEvent, R, E>);
  };

  return enqueue;
};
