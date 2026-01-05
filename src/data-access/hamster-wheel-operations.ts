import { Atom } from "@effect-atom/atom-react";
import { appRuntime } from "@/lib/app-runtime";
import {
  assign,
  createMachine,
  createUseChildMachineHook,
  createUseMachineHook,
  effect,
  interpret,
  sendTo,
  spawnChild,
  type MachineSnapshot,
  type MachineActor,
} from "@/lib/state-machine";
import { Data, Duration, Effect, Schedule, Schema, Scope, Stream, SubscriptionRef } from "effect";
import {
  GarageDoorMachineService,
  PowerOn,
  PowerOff,
  WakeHamster,
  type GarageDoorState,
  type GarageDoorEvent,
  initialSnapshot as garageDoorInitialSnapshot,
} from "./garage-door-operations";

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
 * The machine is defined inside the service, yielding GarageDoorMachineService
 * to access its `.definition` for spawning as a child.
 *
 * This provides:
 * - Clean types (no explicit R parameter needed)
 * - No type casts
 * - Automatic R channel composition via `dependencies`
 *
 * The dependency chain ensures the R channel flows:
 * HamsterWheelMachineService -> GarageDoorMachineService -> WeatherService
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const hamsterWheel = yield* HamsterWheelMachineService;
 *   const actor = yield* hamsterWheel.createActor();
 *   actor.send(new Toggle());
 * });
 *
 * Effect.runPromise(program.pipe(Effect.provide(HamsterWheelMachineService.Default)));
 * ```
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
// Atom Integration
// ============================================================================

const actorAtom = appRuntime
  .atom(
    Effect.gen(function* () {
      const hamsterWheelService = yield* HamsterWheelMachineService;
      return yield* hamsterWheelService.createActor();
    }).pipe(
      // Provide machine service inline to avoid circular imports with app-runtime
      Effect.provide(HamsterWheelMachineService.Default)
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

  const handleToggle = () => send(new Toggle());

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
