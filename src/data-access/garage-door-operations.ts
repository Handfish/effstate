import { Atom } from "@effect-atom/atom-react";
import { appRuntime } from "@/lib/app-runtime";
import {
  assign,
  createMachine,
  createUseMachineHook,
  decodeSnapshotSync,
  effect,
  encodeSnapshotSync,
  interpret,
} from "@/lib/state-machine";
import { Data, Duration, Effect, Schedule, Schema, Stream, SubscriptionRef } from "effect";

// ============================================================================
// Types
// ============================================================================

export type GarageDoorState =
  | "closed"
  | "opening"
  | "paused-while-opening"
  | "open"
  | "closing"
  | "paused-while-closing";

const GarageDoorContextSchema = Schema.Struct({
  position: Schema.Number,
  lastUpdated: Schema.DateFromString,
});

class Click extends Data.TaggedClass("CLICK")<{}> {}
class Tick extends Data.TaggedClass("TICK")<{ readonly delta: number }> {}
class AnimationComplete extends Data.TaggedClass("ANIMATION_COMPLETE")<{}> {}

type GarageDoorEvent = Click | Tick | AnimationComplete;

// ============================================================================
// Configuration
// ============================================================================

const FULL_CYCLE_DURATION = Duration.seconds(10);
const TICK_INTERVAL = Duration.millis(16);
const POSITION_DELTA_PER_TICK =
  100 / (Duration.toMillis(FULL_CYCLE_DURATION) / Duration.toMillis(TICK_INTERVAL));

// ============================================================================
// Animation Activity
// ============================================================================

const createAnimationActivity = (direction: 1 | -1) => ({
  id: `animation-${direction === 1 ? "opening" : "closing"}`,
  src: ({ send }: { send: (event: GarageDoorEvent) => void }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Animation activity started: ${direction === 1 ? "opening" : "closing"}`);

      yield* Stream.fromSchedule(Schedule.spaced(TICK_INTERVAL)).pipe(
        Stream.runForEach(() =>
          Effect.sync(() => {
            send(new Tick({ delta: direction * POSITION_DELTA_PER_TICK }));
          }),
        ),
      );
    }),
});

// ============================================================================
// Garage Door Machine
// ============================================================================

export const garageDoorMachine = createMachine<
  GarageDoorState,
  GarageDoorEvent,
  typeof GarageDoorContextSchema
>({
  id: "garageDoor",
  initial: "closed",
  context: GarageDoorContextSchema,
  initialContext: {
    position: 0,
    lastUpdated: new Date(),
  },
  states: {
    closed: {
      entry: [assign({ position: 0, lastUpdated: new Date() })],
      on: {
        CLICK: { target: "opening" },
      },
    },

    opening: {
      entry: [effect(() => Effect.log("Entering: opening"))],
      activities: [createAnimationActivity(1)],
      on: {
        CLICK: { target: "paused-while-opening" },
        TICK: {
          actions: [
            assign(({ context, event }) => ({
              position: Math.min(100, context.position + event.delta),
              lastUpdated: new Date(),
            })),
          ],
        },
        ANIMATION_COMPLETE: { target: "open" },
      },
    },

    "paused-while-opening": {
      entry: [effect(() => Effect.log("Entering: paused-while-opening"))],
      on: {
        CLICK: { target: "closing" },
      },
    },

    open: {
      entry: [assign({ position: 100, lastUpdated: new Date() })],
      on: {
        CLICK: { target: "closing" },
      },
    },

    closing: {
      entry: [effect(() => Effect.log("Entering: closing"))],
      activities: [createAnimationActivity(-1)],
      on: {
        CLICK: { target: "paused-while-closing" },
        TICK: {
          actions: [
            assign(({ context, event }) => ({
              position: Math.max(0, context.position + event.delta),
              lastUpdated: new Date(),
            })),
          ],
        },
        ANIMATION_COMPLETE: { target: "closed" },
      },
    },

    "paused-while-closing": {
      entry: [effect(() => Effect.log("Entering: paused-while-closing"))],
      on: {
        CLICK: { target: "opening" },
      },
    },
  },
});

// ============================================================================
// Persistence
// ============================================================================

const STORAGE_KEY = "garageDoor:snapshot";

export const loadSnapshot = (): typeof garageDoorMachine.initialSnapshot | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return decodeSnapshotSync(garageDoorMachine, JSON.parse(stored));
  } catch {
    return null;
  }
};

const saveSnapshot = (snapshot: typeof garageDoorMachine.initialSnapshot): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(encodeSnapshotSync(garageDoorMachine, snapshot)));
  } catch {
    // Ignore storage errors
  }
};

// ============================================================================
// Atom Integration
// ============================================================================

const actorAtom = appRuntime
  .atom(interpret(garageDoorMachine))
  .pipe(Atom.keepAlive);

const snapshotAtom = appRuntime
  .subscriptionRef((get) =>
    Effect.gen(function* () {
      const actor = yield* get.result(actorAtom);
      const ref = yield* SubscriptionRef.make(actor.getSnapshot());
      actor.subscribe((snapshot) => {
        Effect.runSync(SubscriptionRef.set(ref, snapshot));
        saveSnapshot(snapshot);
      });
      return ref;
    })
  )
  .pipe(Atom.keepAlive);

const useMachine = createUseMachineHook(
  actorAtom,
  snapshotAtom,
  garageDoorMachine.initialSnapshot,
);

// ============================================================================
// React Hook
// ============================================================================

export interface GarageDoorStatus {
  readonly state: GarageDoorState;
  readonly position: number;
}

export const useGarageDoor = (): {
  status: GarageDoorStatus;
  handleButtonClick: () => void;
  isLoading: boolean;
} => {
  const { snapshot, send, isLoading, matches, context } = useMachine();

  const handleButtonClick = () => send(new Click());

  if (context.position >= 100 && matches("opening")) {
    send(new AnimationComplete());
  } else if (context.position <= 0 && matches("closing")) {
    send(new AnimationComplete());
  }

  return {
    status: { state: snapshot.value, position: context.position },
    handleButtonClick,
    isLoading,
  };
};

// ============================================================================
// UI Helpers
// ============================================================================

const stateLabels: Record<GarageDoorState, string> = {
  closed: "Closed",
  opening: "Opening...",
  "paused-while-opening": "Paused (was opening)",
  open: "Open",
  closing: "Closing...",
  "paused-while-closing": "Paused (was closing)",
};

export const getStateLabel = (state: GarageDoorState) => stateLabels[state];

const buttonLabels: Record<GarageDoorState, string> = {
  closed: "Open Door",
  opening: "Pause",
  "paused-while-opening": "Close Door",
  open: "Close Door",
  closing: "Pause",
  "paused-while-closing": "Open Door",
};

export const getButtonLabel = (state: GarageDoorState) => buttonLabels[state];
