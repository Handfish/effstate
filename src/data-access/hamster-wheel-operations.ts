import { Atom, useAtomValue } from "@effect-atom/atom-react";
import { appRuntime } from "@/lib/app-runtime";
import {
  assign,
  createMachine,
  createUseMachineHook,
  effect,
  interpret,
  type MachineSnapshot,
} from "@/lib/state-machine";
import { Data, Duration, Effect, Schedule, Schema, Stream, SubscriptionRef } from "effect";

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

type HamsterWheelEvent = Toggle | Tick;

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
// Hamster Wheel Machine
// ============================================================================

const HamsterWheelMachine = createMachine<HamsterWheelState, HamsterWheelEvent, typeof HamsterWheelContextSchema>({
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
      ],
      on: {
        TOGGLE: { target: "running" },
      },
    },

    running: {
      entry: [
        effect(() => Effect.log("Hamster is running! Generating electricity")),
        assign(() => ({ electricityLevel: 100 })),
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

// ============================================================================
// Atom Integration
// ============================================================================

const actorAtom = appRuntime
  .atom(interpret(HamsterWheelMachine))
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

const useMachine = createUseMachineHook(
  actorAtom,
  snapshotAtom,
  initialSnapshot,
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
  const { snapshot, send, isLoading, context } = useMachine();

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
// Electricity Atom (for child state machines)
// ============================================================================

export const electricityAtom = appRuntime
  .subscriptionRef((get) =>
    Effect.gen(function* () {
      const actor = yield* get.result(actorAtom);
      const ref = yield* SubscriptionRef.make(actor.getSnapshot().context.electricityLevel > 0);
      actor.subscribe((snapshot) => {
        Effect.runSync(SubscriptionRef.set(ref, snapshot.context.electricityLevel > 0));
      });
      return ref;
    })
  )
  .pipe(Atom.keepAlive);

export const useElectricity = (): boolean => {
  const result = useAtomValue(electricityAtom);
  return result._tag === "Success" ? result.value : false;
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
