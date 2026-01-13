/**
 * HamsterWheel Machine - v2 API with Dexie persistence
 *
 * Demonstrates:
 * - Parent-child machine relationships
 * - Discriminated union states (Data.TaggedEnum)
 * - Exhaustive event handling with Match
 * - Cross-tab sync via Dexie liveQuery
 * - Effect.Service pattern
 */

import { Atom } from "@effect-atom/atom-react";
import { useLiveQuery } from "dexie-react-hooks";
import { appRuntime } from "@/lib/app-runtime";
import { Machine } from "effstate/v2";
import type { MachineSnapshot, MachineActor, AnyMachineDefinition } from "effstate/v2";
import {
  createUseMachineHook,
  createUseChildMachineHook,
} from "@effstate/react/v2";
import { Data, Duration, Effect, Match, Schedule, Schema, Scope, Stream, SubscriptionRef } from "effect";
import { useCallback, useEffect, useState } from "react";
import {
  GarageDoorMachineService,
  GarageDoorState,
  GarageDoorContextSchema,
  PowerOn,
  PowerOff,
  WakeHamster,
  type GarageDoorContext,
  type GarageDoorEvent,
  initialSnapshot as garageDoorInitialSnapshot,
} from "./garage-door-operations";
import { createCrossTabSync } from "@/lib/cross-tab-leader";
import { DexieService, type EffStateDexie } from "@/lib/services/dexie";
import { StatePersistence, type PersistedState } from "@/lib/services/state-persistence";

// ============================================================================
// States (Discriminated Union with Data)
// ============================================================================

export type HamsterWheelState = Data.TaggedEnum<{
  Idle: {};
  Running: { readonly startedAt: Date };
  Stopping: { readonly stoppingAt: Date };
}>;

export const HamsterWheelState = Data.taggedEnum<HamsterWheelState>();

// ============================================================================
// Events
// ============================================================================

class Toggle extends Data.TaggedClass("Toggle")<{}> {}
class Tick extends Data.TaggedClass("Tick")<{ readonly delta: number }> {}
class StopComplete extends Data.TaggedClass("StopComplete")<{}> {}

type HamsterWheelEvent = Toggle | Tick | StopComplete | WakeHamster;

// ============================================================================
// Context Schema
// ============================================================================

const HamsterWheelContextSchema = Schema.Struct({
  wheelRotation: Schema.Number,
  electricityLevel: Schema.Number,
});

type HamsterWheelContext = typeof HamsterWheelContextSchema.Type;

// ============================================================================
// Animation Constants
// ============================================================================

const TICK_MS = 16;
const ROTATION_SPEED = 5; // degrees per tick

const wheelAnimation: Stream.Stream<Tick> =
  Stream.fromSchedule(Schedule.spaced(Duration.millis(TICK_MS))).pipe(
    Stream.map(() => new Tick({ delta: ROTATION_SPEED })),
  );

// Stopping delay stream - emits StopComplete after 2 seconds
const stoppingDelay: Stream.Stream<StopComplete> =
  Stream.fromSchedule(Schedule.spaced(Duration.seconds(2))).pipe(
    Stream.take(1),
    Stream.map(() => new StopComplete()),
  );

// ============================================================================
// Initial Snapshot
// ============================================================================

type HamsterWheelSnapshot = MachineSnapshot<HamsterWheelState, HamsterWheelContext>;

const initialSnapshot: HamsterWheelSnapshot = {
  state: HamsterWheelState.Idle(),
  context: {
    wheelRotation: 0,
    electricityLevel: 0,
  },
  event: null,
};

// ============================================================================
// Child Machine IDs
// ============================================================================

const GARAGE_DOOR_LEFT_ID = "garageDoorLeft" as const;
const GARAGE_DOOR_RIGHT_ID = "garageDoorRight" as const;

// Type for children config - used by child hooks for type inference
type HamsterWheelChildrenKeys = Record<
  typeof GARAGE_DOOR_LEFT_ID | typeof GARAGE_DOOR_RIGHT_ID,
  AnyMachineDefinition
>;

// ============================================================================
// Hamster Wheel Machine Service
// ============================================================================

/**
 * HamsterWheel machine as an Effect.Service using v2 API.
 *
 * Parent machine that spawns two GarageDoor child machines.
 * Uses discriminated union states and exhaustive event handling.
 */
export class HamsterWheelMachineService extends Effect.Service<HamsterWheelMachineService>()(
  "HamsterWheelMachineService",
  {
    effect: Effect.gen(function* () {
      // Yield child service to get its machine definition
      const garageDoorService = yield* GarageDoorMachineService;

      // Define children config type for proper typing
      const childrenConfig = {
        [GARAGE_DOOR_LEFT_ID]: garageDoorService.definition,
        [GARAGE_DOOR_RIGHT_ID]: garageDoorService.definition,
      } as const;

      type ChildrenConfigType = typeof childrenConfig;

      // Machine definition with v2 API - explicit type parameters for proper inference
      const machine = Machine.define<
        HamsterWheelState,
        HamsterWheelContext,
        HamsterWheelEvent,
        typeof HamsterWheelContextSchema,
        never,
        ChildrenConfigType
      >({
        id: "hamsterWheel",
        context: HamsterWheelContextSchema,
        initialContext: {
          wheelRotation: 0,
          electricityLevel: 0,
        },
        initialState: HamsterWheelState.Idle(),

        // Declare child machines (using pre-defined config for type safety)
        children: childrenConfig,

        states: {
          // ========================================================================
          // Idle
          // ========================================================================
          Idle: {
            entry: () =>
              Effect.log("Hamster is resting - lights out"),

            on: (_ctx, _state, { goto, stay }) => (event) =>
              Match.value(event).pipe(
                Match.tag("Toggle", () =>
                  goto(HamsterWheelState.Running({ startedAt: new Date() }))
                    .update({ electricityLevel: 100 })
                    .spawn(GARAGE_DOOR_LEFT_ID)
                    .spawn(GARAGE_DOOR_RIGHT_ID)
                    .send(GARAGE_DOOR_LEFT_ID, new PowerOn())
                    .send(GARAGE_DOOR_RIGHT_ID, new PowerOn())
                    .effect(Effect.log("Hamster is running! Generating electricity"))
                ),
                // Child garage doors can wake the hamster by banging the hammer!
                Match.tag("WakeHamster", () =>
                  goto(HamsterWheelState.Running({ startedAt: new Date() }))
                    .update({ electricityLevel: 100 })
                    .spawn(GARAGE_DOOR_LEFT_ID)
                    .spawn(GARAGE_DOOR_RIGHT_ID)
                    .send(GARAGE_DOOR_LEFT_ID, new PowerOn())
                    .send(GARAGE_DOOR_RIGHT_ID, new PowerOn())
                    .effect(Effect.log("Hamster woken by hammer bang!"))
                ),
                Match.orElse(() => stay),
              ),
          },

          // ========================================================================
          // Running
          // ========================================================================
          Running: {
            entry: ({ startedAt }) =>
              Effect.log(`Hamster started running at ${startedAt.toISOString()}`),

            // Stream runs while in this state
            run: wheelAnimation,

            on: (ctx, _state, { goto, update, stay }) => (event) =>
              Match.value(event).pipe(
                Match.tag("Toggle", () =>
                  goto(HamsterWheelState.Stopping({ stoppingAt: new Date() }))
                    .effect(Effect.log("Hamster stopped - electricity draining in 2 seconds..."))
                ),
                Match.tag("Tick", ({ delta }) =>
                  update({ wheelRotation: (ctx.wheelRotation + delta) % 360 })
                ),
                Match.orElse(() => stay),
              ),
          },

          // ========================================================================
          // Stopping
          // ========================================================================
          Stopping: {
            entry: ({ stoppingAt }) =>
              Effect.log(`Hamster stopping at ${stoppingAt.toISOString()}`),

            // Stream emits StopComplete after 2 seconds
            run: stoppingDelay,

            on: (_ctx, _state, { goto, stay }) => (event) =>
              Match.value(event).pipe(
                Match.tag("Toggle", () =>
                  goto(HamsterWheelState.Running({ startedAt: new Date() }))
                    .effect(Effect.log("Hamster started running again!"))
                ),
                Match.tag("StopComplete", () =>
                  goto(HamsterWheelState.Idle())
                    .update({ electricityLevel: 0 })
                    .send(GARAGE_DOOR_LEFT_ID, new PowerOff())
                    .send(GARAGE_DOOR_RIGHT_ID, new PowerOff())
                    .effect(Effect.log("Electricity drained - lights out"))
                ),
                Match.tag("WakeHamster", () =>
                  goto(HamsterWheelState.Running({ startedAt: new Date() }))
                    .effect(Effect.log("Hamster woken by hammer bang!"))
                ),
                Match.orElse(() => stay),
              ),
          },
        },
      });

      return {
        /** The machine definition */
        definition: machine,
        /** Create a new actor instance */
        createActor: (): Effect.Effect<
          MachineActor<HamsterWheelState, HamsterWheelContext, HamsterWheelEvent, any>,
          never,
          Scope.Scope
        > => machine.interpret(),
      };
    }),
    // Depend on GarageDoorMachineService - this chains the dependency on WeatherService
    dependencies: [GarageDoorMachineService.Default],
  }
) {}

// ============================================================================
// Dexie-Based Persistence
// ============================================================================

const MACHINE_ID = "hamsterWheel";
const LEADER_KEY = "hamsterWheel:dexie";

// Helper to map v2 state tag to v1 value for persistence compatibility
const stateTagToValue = (state: HamsterWheelState): "idle" | "running" | "stopping" =>
  Match.value(state).pipe(
    Match.tag("Idle", () => "idle" as const),
    Match.tag("Running", () => "running" as const),
    Match.tag("Stopping", () => "stopping" as const),
    Match.exhaustive,
  );

const garageDoorStateTagToValue = (state: GarageDoorState): "closed" | "opening" | "paused-while-opening" | "open" | "closing" | "paused-while-closing" =>
  Match.value(state).pipe(
    Match.tag("Closed", () => "closed" as const),
    Match.tag("Opening", () => "opening" as const),
    Match.tag("PausedWhileOpening", () => "paused-while-opening" as const),
    Match.tag("Open", () => "open" as const),
    Match.tag("Closing", () => "closing" as const),
    Match.tag("PausedWhileClosing", () => "paused-while-closing" as const),
    Match.exhaustive,
  );

// Schema for garage door snapshot (encoded form for JSON)
const GarageDoorSnapshotSchema = Schema.Struct({
  value: Schema.Literal("closed", "opening", "paused-while-opening", "open", "closing", "paused-while-closing"),
  context: GarageDoorContextSchema,
});

/**
 * Save the actor state to IndexedDB via Dexie.
 */
const saveStateToDexie = (
  actor: MachineActor<HamsterWheelState, HamsterWheelContext, HamsterWheelEvent, any>
): void => {
  const parentSnapshot = actor.getSnapshot();
  const leftChild = actor.children.get(GARAGE_DOOR_LEFT_ID);
  const rightChild = actor.children.get(GARAGE_DOOR_RIGHT_ID);

  // Build children snapshots - convert v2 state to v1 format for persistence
  const leftSnapshot = leftChild ? {
    value: garageDoorStateTagToValue(leftChild.getSnapshot().state as GarageDoorState),
    context: leftChild.getSnapshot().context as GarageDoorContext,
  } : undefined;

  const rightSnapshot = rightChild ? {
    value: garageDoorStateTagToValue(rightChild.getSnapshot().state as GarageDoorState),
    context: rightChild.getSnapshot().context as GarageDoorContext,
  } : undefined;

  const state: PersistedState = {
    parent: {
      value: stateTagToValue(parentSnapshot.state),
      context: parentSnapshot.context,
    },
    children: {
      garageDoorLeft: leftSnapshot,
      garageDoorRight: rightSnapshot,
    },
  };

  // Run the persistence effect using Effect.runFork
  Effect.runFork(
    Effect.gen(function* () {
      const persistence = yield* StatePersistence;
      yield* persistence.save(MACHINE_ID, state);
      console.log("[Dexie] Saved state:", state.parent.value);
    }).pipe(
      Effect.provide(StatePersistence.Default),
      Effect.provide(DexieService.Default),
    )
  );
};

// Helper to convert v1 state value back to v2 state
const valueToHamsterWheelState = (value: "idle" | "running" | "stopping"): HamsterWheelState => {
  switch (value) {
    case "idle": return HamsterWheelState.Idle();
    case "running": return HamsterWheelState.Running({ startedAt: new Date() });
    case "stopping": return HamsterWheelState.Stopping({ stoppingAt: new Date() });
  }
};

const valueToGarageDoorState = (value: string): GarageDoorState => {
  switch (value) {
    case "closed": return GarageDoorState.Closed();
    case "opening": return GarageDoorState.Opening({ startedAt: new Date() });
    case "paused-while-opening": return GarageDoorState.PausedWhileOpening({ pausedAt: new Date(), pausedPosition: 50 });
    case "open": return GarageDoorState.Open({ openedAt: new Date() });
    case "closing": return GarageDoorState.Closing({ startedAt: new Date() });
    case "paused-while-closing": return GarageDoorState.PausedWhileClosing({ pausedAt: new Date(), pausedPosition: 50 });
    default: return GarageDoorState.Closed();
  }
};

/**
 * Load the actor state from IndexedDB via Dexie.
 */
const loadStateFromDexie = (): Effect.Effect<
  { snapshot: HamsterWheelSnapshot; childSnapshots: Map<string, MachineSnapshot<any, Record<string, unknown>>> } | null,
  never,
  StatePersistence
> =>
  Effect.gen(function* () {
    const persistence = yield* StatePersistence;
    const state = yield* persistence.load(MACHINE_ID);
    if (!state) return null;

    const snapshot: HamsterWheelSnapshot = {
      state: valueToHamsterWheelState(state.parent.value),
      context: state.parent.context,
      event: null,
    };

    const childSnapshots = new Map<string, MachineSnapshot<any, Record<string, unknown>>>();

    if (state.children[GARAGE_DOOR_LEFT_ID]) {
      childSnapshots.set(GARAGE_DOOR_LEFT_ID, {
        state: valueToGarageDoorState(state.children[GARAGE_DOOR_LEFT_ID].value),
        context: state.children[GARAGE_DOOR_LEFT_ID].context,
        event: null,
      });
    }

    if (state.children[GARAGE_DOOR_RIGHT_ID]) {
      childSnapshots.set(GARAGE_DOOR_RIGHT_ID, {
        state: valueToGarageDoorState(state.children[GARAGE_DOOR_RIGHT_ID].value),
        context: state.children[GARAGE_DOOR_RIGHT_ID].context,
        event: null,
      });
    }

    console.log("[Dexie] Loaded state:", stateTagToValue(snapshot.state));
    return { snapshot, childSnapshots };
  });

// ============================================================================
// Cross-Tab Sync with Dexie
// ============================================================================

let currentActor: MachineActor<HamsterWheelState, HamsterWheelContext, HamsterWheelEvent, any> | null = null;

// Cross-tab sync - leader writes to Dexie, followers react via liveQuery
const crossTabSync = createCrossTabSync({
  storageKey: LEADER_KEY,
  onSave: () => {
    if (currentActor) saveStateToDexie(currentActor);
  },
});

// ============================================================================
// Atom Integration with Dexie Persistence
// ============================================================================

const actorAtom = appRuntime
  .atom(
    Effect.gen(function* () {
      const hamsterWheelService = yield* HamsterWheelMachineService;

      // Try to load persisted state from Dexie
      const persisted = yield* loadStateFromDexie();

      // Create actor with optional restored state
      const actor = yield* persisted
        ? hamsterWheelService.definition.interpret({
            snapshot: persisted.snapshot,
            childSnapshots: persisted.childSnapshots,
          })
        : hamsterWheelService.definition.interpret();

      // Store reference for cross-tab sync
      currentActor = actor;

      // Track which children we've subscribed to
      const subscribedChildren = new Set<string>();

      // Helper to subscribe to a child's changes
      const subscribeToChild = (childId: string) => {
        if (subscribedChildren.has(childId)) return;
        const child = actor.children.get(childId);
        if (child) {
          subscribedChildren.add(childId);
          child.subscribe(() => crossTabSync.saveIfLeader());
        }
      };

      // Save on state changes (only if leader)
      // Also check for new children to subscribe to
      actor.subscribe(() => {
        crossTabSync.saveIfLeader();
        // Subscribe to any new children that were spawned
        actor.children.forEach((_, childId) => subscribeToChild(childId));
      });

      // Subscribe to initially existing children
      actor.children.forEach((_, childId) => subscribeToChild(childId));

      return actor;
    }).pipe(
      Effect.provide(HamsterWheelMachineService.Default),
      Effect.provide(StatePersistence.Default),
    )
  )
  .pipe(Atom.keepAlive);

const snapshotAtom = appRuntime
  .subscriptionRef((get) =>
    Effect.gen(function* () {
      const actor = yield* get.result(actorAtom);
      const ref = yield* SubscriptionRef.make(actor.getSnapshot());
      actor.subscribe((snapshot) => {
        Effect.runSync(SubscriptionRef.set(ref, snapshot));
      });
      return ref;
    })
  )
  .pipe(Atom.keepAlive);

const useHamsterWheelMachine = createUseMachineHook(
  actorAtom,
  snapshotAtom,
  initialSnapshot,
);

// ============================================================================
// Cross-Tab Sync via Dexie liveQuery
// ============================================================================

/**
 * Hook to sync state from Dexie when another tab makes changes.
 * Uses Dexie's liveQuery for reactive IndexedDB updates.
 */
const useDexieCrossTabSync = () => {
  // Get the Dexie database from the runtime
  const [db, setDb] = useState<EffStateDexie | null>(null);

  useEffect(() => {
    // Initialize the database reference
    const init = Effect.gen(function* () {
      const dexie = yield* DexieService;
      return dexie.db;
    }).pipe(Effect.provide(DexieService.Default));

    Effect.runPromise(init).then(setDb);
  }, []);

  // Use liveQuery to watch for changes from other tabs
  const persistedState = useLiveQuery(
    () => db?.machineStates.get(MACHINE_ID),
    [db],
    undefined
  );

  // Sync when state changes and we're not the leader
  useEffect(() => {
    if (!persistedState || !currentActor || crossTabSync.isLeader()) return;

    // Reconstruct the state from the persisted row
    try {
      const raw = {
        parent: {
          value: persistedState.parentValue,
          context: persistedState.parentContext,
        },
        children: persistedState.childSnapshots,
      };

      // Decode the schema
      const PersistedStateSchema = Schema.Struct({
        parent: Schema.Struct({
          value: Schema.Literal("idle", "running", "stopping"),
          context: HamsterWheelContextSchema,
        }),
        children: Schema.Struct({
          garageDoorLeft: Schema.optional(GarageDoorSnapshotSchema),
          garageDoorRight: Schema.optional(GarageDoorSnapshotSchema),
        }),
      });

      const decoded = Schema.decodeUnknownSync(PersistedStateSchema)(raw);

      const snapshot: HamsterWheelSnapshot = {
        state: valueToHamsterWheelState(decoded.parent.value),
        context: decoded.parent.context,
        event: null,
      };

      const childSnapshots = new Map<string, MachineSnapshot<any, Record<string, unknown>>>();

      if (decoded.children.garageDoorLeft) {
        childSnapshots.set(GARAGE_DOOR_LEFT_ID, {
          state: valueToGarageDoorState(decoded.children.garageDoorLeft.value),
          context: decoded.children.garageDoorLeft.context,
          event: null,
        });
      }

      if (decoded.children.garageDoorRight) {
        childSnapshots.set(GARAGE_DOOR_RIGHT_ID, {
          state: valueToGarageDoorState(decoded.children.garageDoorRight.value),
          context: decoded.children.garageDoorRight.context,
          event: null,
        });
      }

      console.log("[Dexie liveQuery] Syncing from other tab:", stateTagToValue(snapshot.state));
      (currentActor as any)._syncSnapshot(snapshot, childSnapshots);
    } catch (e) {
      console.warn("[Dexie liveQuery] Failed to decode persisted state:", e);
    }
  }, [persistedState]);
};

// ============================================================================
// Child Machine Hooks (Garage Doors)
// ============================================================================

export const useGarageDoorLeft = createUseChildMachineHook<
  HamsterWheelState,
  HamsterWheelContext,
  HamsterWheelEvent,
  HamsterWheelChildrenKeys,
  GarageDoorState,
  GarageDoorContext,
  GarageDoorEvent,
  {}
>(
  appRuntime,
  actorAtom,
  GARAGE_DOOR_LEFT_ID,
  garageDoorInitialSnapshot,
);

export const useGarageDoorRight = createUseChildMachineHook<
  HamsterWheelState,
  HamsterWheelContext,
  HamsterWheelEvent,
  HamsterWheelChildrenKeys,
  GarageDoorState,
  GarageDoorContext,
  GarageDoorEvent,
  {}
>(
  appRuntime,
  actorAtom,
  GARAGE_DOOR_RIGHT_ID,
  garageDoorInitialSnapshot,
);

// ============================================================================
// React Hook
// ============================================================================

export interface HamsterWheelStatus {
  readonly state: HamsterWheelState;
  readonly stateTag: HamsterWheelState["_tag"];
  readonly wheelRotation: number;
  readonly electricityLevel: number;
  readonly isDark: boolean;
}

export const useHamsterWheel = (): {
  status: HamsterWheelStatus;
  handleToggle: () => void;
  isLoading: boolean;
} => {
  const { snapshot, send, isLoading, context } = useHamsterWheelMachine();

  // Enable cross-tab sync via Dexie liveQuery
  useDexieCrossTabSync();

  const handleToggle = useCallback(() => {
    send(new Toggle());
  }, [send]);

  return {
    status: {
      state: snapshot.state,
      stateTag: snapshot.state._tag,
      wheelRotation: context.wheelRotation,
      electricityLevel: context.electricityLevel,
      isDark: snapshot.state._tag === "Idle",
    },
    handleToggle,
    isLoading,
  };
};

// ============================================================================
// UI Helpers
// ============================================================================

export const getStateLabel = (state: HamsterWheelState): string =>
  Match.value(state).pipe(
    Match.tag("Idle", () => "Resting"),
    Match.tag("Running", () => "Running!"),
    Match.tag("Stopping", () => "Slowing down..."),
    Match.exhaustive,
  );

export const getButtonLabel = (state: HamsterWheelState): string =>
  Match.value(state).pipe(
    Match.tag("Idle", () => "Wake Up Hamster"),
    Match.tag("Running", () => "Stop Hamster"),
    Match.tag("Stopping", () => "Start Running Again"),
    Match.exhaustive,
  );
