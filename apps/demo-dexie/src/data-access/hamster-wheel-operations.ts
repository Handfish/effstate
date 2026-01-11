import { Atom } from "@effect-atom/atom-react";
import { useLiveQuery } from "dexie-react-hooks";
import { appRuntime } from "@/lib/app-runtime";
import {
  assign,
  createMachine,
  effect,
  interpret,
  sendTo,
  spawnChild,
  type MachineSnapshot,
  type MachineActor,
} from "effstate";
import {
  createUseChildMachineHook,
  createUseMachineHook,
} from "@effstate/react";
import { Data, Duration, Effect, Schedule, Schema, Scope, Stream, SubscriptionRef } from "effect";
import { useCallback, useEffect, useState } from "react";
import {
  GarageDoorMachineService,
  GarageDoorContextSchema,
  PowerOn,
  PowerOff,
  WakeHamster,
  type GarageDoorState,
  type GarageDoorEvent,
  initialSnapshot as garageDoorInitialSnapshot,
} from "./garage-door-operations";
import { createCrossTabSync } from "@/lib/cross-tab-leader";
import { DexieService, type EffStateDexie } from "@/lib/services/dexie";
import { StatePersistence, type PersistedState } from "@/lib/services/state-persistence";

// ============================================================================
// Types
// ============================================================================

export type HamsterWheelState = "idle" | "running" | "stopping";

const HamsterWheelContextSchema = Schema.Struct({
  wheelRotation: Schema.Number,
  electricityLevel: Schema.Number,
});

class Toggle extends Data.TaggedClass("TOGGLE")<{}> {}
class Tick extends Data.TaggedClass("TICK")<{ readonly delta: number }> {}

type HamsterWheelEvent = Toggle | Tick | WakeHamster;

type HamsterWheelContext = typeof HamsterWheelContextSchema.Type;
type HamsterWheelSnapshot = MachineSnapshot<HamsterWheelState, HamsterWheelContext>;

const initialSnapshot: HamsterWheelSnapshot = {
  value: "idle",
  context: {
    wheelRotation: 0,
    electricityLevel: 0,
  },
  event: null,
};

// ============================================================================
// Animation Activity
// ============================================================================

const TICK_MS = 16;
const ROTATION_SPEED = 5; // degrees per tick

const wheelAnimation = {
  id: "wheel-animation",
  src: ({ send }: { send: (e: HamsterWheelEvent) => void }) =>
    Stream.fromSchedule(Schedule.spaced(Duration.millis(TICK_MS))).pipe(
      Stream.runForEach(() => Effect.sync(() => send(new Tick({ delta: ROTATION_SPEED })))),
    ),
};

// ============================================================================
// Hamster Wheel Machine Service
// ============================================================================

const GARAGE_DOOR_LEFT_ID = "garageDoorLeft";
const GARAGE_DOOR_RIGHT_ID = "garageDoorRight";

/**
 * HamsterWheel machine as an Effect.Service.
 *
 * Same pattern as the localStorage demo, but persistence is handled
 * by Dexie (IndexedDB) instead of localStorage.
 */
export class HamsterWheelMachineService extends Effect.Service<HamsterWheelMachineService>()(
  "HamsterWheelMachineService",
  {
    effect: Effect.gen(function* () {
      // Yield child service to get its machine definition
      const garageDoorService = yield* GarageDoorMachineService;

      // Machine definition with closure over child service
      const machine = createMachine<HamsterWheelState, HamsterWheelEvent, typeof HamsterWheelContextSchema>({
        id: "hamsterWheel",
        initial: "idle",
        context: HamsterWheelContextSchema,
        initialContext: {
          wheelRotation: 0,
          electricityLevel: 0,
        },
        states: {
          idle: {
            entry: [
              effect(() => Effect.log("Hamster is resting - lights out")),
              assign(() => ({ electricityLevel: 0 })),
              // Spawn both garage doors
              spawnChild(garageDoorService.definition, { id: GARAGE_DOOR_LEFT_ID }),
              spawnChild(garageDoorService.definition, { id: GARAGE_DOOR_RIGHT_ID }),
              // Power off both garage doors
              sendTo(GARAGE_DOOR_LEFT_ID, new PowerOff()),
              sendTo(GARAGE_DOOR_RIGHT_ID, new PowerOff()),
            ],
            on: {
              TOGGLE: { target: "running" },
              // Child garage doors can wake the hamster by banging the hammer!
              WAKE_HAMSTER: { target: "running" },
            },
          },

          running: {
            entry: [
              effect(() => Effect.log("Hamster is running! Generating electricity")),
              assign(() => ({ electricityLevel: 100 })),
              // Power on both garage doors
              sendTo(GARAGE_DOOR_LEFT_ID, new PowerOn()),
              sendTo(GARAGE_DOOR_RIGHT_ID, new PowerOn()),
            ],
            activities: [wheelAnimation],
            on: {
              TOGGLE: { target: "stopping" },
              TICK: {
                actions: [
                  assign<HamsterWheelContext, Tick>(({ context, event }) => ({
                    wheelRotation: (context.wheelRotation + event.delta) % 360,
                  })),
                ],
              },
            },
          },

          stopping: {
            entry: [
              effect(() => Effect.log("Hamster stopped - electricity draining in 2 seconds...")),
              // Power stays on during stopping - only turns off when entering idle
            ],
            after: {
              delay: Duration.seconds(2),
              transition: { target: "idle" },
            },
            on: {
              TOGGLE: { target: "running" },
            },
          },
        },
      });

      return {
        /** The machine definition */
        definition: machine,
        /** Create a new actor instance */
        createActor: (): Effect.Effect<
          MachineActor<HamsterWheelState, HamsterWheelContext, HamsterWheelEvent>,
          never,
          Scope.Scope
        > => interpret(machine),
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

// Schema for garage door snapshot (encoded form for JSON)
const GarageDoorSnapshotSchema = Schema.Struct({
  value: Schema.Literal("closed", "opening", "paused-while-opening", "open", "closing", "paused-while-closing"),
  context: GarageDoorContextSchema,
});

/**
 * Save the actor state to IndexedDB via Dexie.
 * This replaces localStorage.setItem.
 */
const saveStateToDexie = (
  actor: MachineActor<HamsterWheelState, HamsterWheelContext, HamsterWheelEvent>
): void => {
  const parentSnapshot = actor.getSnapshot();
  const leftChild = actor.children.get(GARAGE_DOOR_LEFT_ID);
  const rightChild = actor.children.get(GARAGE_DOOR_RIGHT_ID);

  // Build children snapshots
  const leftSnapshot = leftChild ? {
    value: leftChild.getSnapshot().value as GarageDoorState,
    context: leftChild.getSnapshot().context as typeof GarageDoorContextSchema.Type,
  } : undefined;

  const rightSnapshot = rightChild ? {
    value: rightChild.getSnapshot().value as GarageDoorState,
    context: rightChild.getSnapshot().context as typeof GarageDoorContextSchema.Type,
  } : undefined;

  const state: PersistedState = {
    parent: {
      value: parentSnapshot.value,
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

/**
 * Load the actor state from IndexedDB via Dexie.
 * This replaces localStorage.getItem.
 */
const loadStateFromDexie = (): Effect.Effect<
  { snapshot: HamsterWheelSnapshot; childSnapshots: Map<string, MachineSnapshot<string, object>> } | null,
  never,
  StatePersistence
> =>
  Effect.gen(function* () {
    const persistence = yield* StatePersistence;
    const state = yield* persistence.load(MACHINE_ID);
    if (!state) return null;

    const snapshot: HamsterWheelSnapshot = {
      value: state.parent.value,
      context: state.parent.context,
      event: null,
    };

    const childSnapshots = new Map<string, MachineSnapshot<string, object>>();

    if (state.children[GARAGE_DOOR_LEFT_ID]) {
      childSnapshots.set(GARAGE_DOOR_LEFT_ID, {
        value: state.children[GARAGE_DOOR_LEFT_ID].value,
        context: state.children[GARAGE_DOOR_LEFT_ID].context,
        event: null,
      });
    }

    if (state.children[GARAGE_DOOR_RIGHT_ID]) {
      childSnapshots.set(GARAGE_DOOR_RIGHT_ID, {
        value: state.children[GARAGE_DOOR_RIGHT_ID].value,
        context: state.children[GARAGE_DOOR_RIGHT_ID].context,
        event: null,
      });
    }

    console.log("[Dexie] Loaded state:", snapshot.value);
    return { snapshot, childSnapshots };
  });

// ============================================================================
// Cross-Tab Sync with Dexie
// ============================================================================

let currentActor: MachineActor<HamsterWheelState, HamsterWheelContext, HamsterWheelEvent> | null = null;

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
        ? interpret(hamsterWheelService.definition, {
            snapshot: persisted.snapshot,
            childSnapshots: persisted.childSnapshots,
          })
        : interpret(hamsterWheelService.definition);

      // Store reference for cross-tab sync
      currentActor = actor;

      // Save on state changes (only if leader)
      actor.subscribe(() => crossTabSync.saveIfLeader());

      // Also save when child actors change state
      actor.children.forEach((child) => {
        child.subscribe(() => crossTabSync.saveIfLeader());
      });

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
        value: decoded.parent.value,
        context: decoded.parent.context,
        event: null,
      };

      const childSnapshots = new Map<string, MachineSnapshot<string, object>>();

      if (decoded.children.garageDoorLeft) {
        childSnapshots.set(GARAGE_DOOR_LEFT_ID, {
          value: decoded.children.garageDoorLeft.value,
          context: decoded.children.garageDoorLeft.context,
          event: null,
        });
      }

      if (decoded.children.garageDoorRight) {
        childSnapshots.set(GARAGE_DOOR_RIGHT_ID, {
          value: decoded.children.garageDoorRight.value,
          context: decoded.children.garageDoorRight.context,
          event: null,
        });
      }

      console.log("[Dexie liveQuery] Syncing from other tab:", snapshot.value);
      currentActor._syncSnapshot(snapshot, childSnapshots);
    } catch (e) {
      console.warn("[Dexie liveQuery] Failed to decode persisted state:", e);
    }
  }, [persistedState]);
};

// ============================================================================
// Child Machine Hooks (Garage Doors)
// ============================================================================

// Type for garage door context (inferred from schema)
type GarageDoorContext = typeof garageDoorInitialSnapshot.context;

export const useGarageDoorLeft = createUseChildMachineHook<
  HamsterWheelState,
  HamsterWheelContext,
  HamsterWheelEvent,
  GarageDoorState,
  GarageDoorContext,
  GarageDoorEvent
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
  GarageDoorState,
  GarageDoorContext,
  GarageDoorEvent
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
      state: snapshot.value,
      wheelRotation: context.wheelRotation,
      electricityLevel: context.electricityLevel,
      isDark: snapshot.value === "idle",
    },
    handleToggle,
    isLoading,
  };
};

// ============================================================================
// UI Helpers
// ============================================================================

const stateLabels: Record<HamsterWheelState, string> = {
  idle: "Resting",
  running: "Running!",
  stopping: "Slowing down...",
};

export const getStateLabel = (state: HamsterWheelState) => stateLabels[state];

const buttonLabels: Record<HamsterWheelState, string> = {
  idle: "Wake Up Hamster",
  running: "Stop Hamster",
  stopping: "Start Running Again",
};

export const getButtonLabel = (state: HamsterWheelState) => buttonLabels[state];
