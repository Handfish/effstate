import { Atom } from "@effect-atom/atom-react";
import { appRuntime } from "@/lib/app-runtime";
import {
  assign,
  createMachine,
  createUseMachineHook,
  effect,
  interpret,
} from "@/lib/state-machine";
import { Duration, Effect, Schedule, Stream } from "effect";

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

interface GarageDoorContext {
  readonly position: number;
}

type GarageDoorEvent =
  | { readonly type: "CLICK" }
  | { readonly type: "TICK"; readonly delta: number }
  | { readonly type: "ANIMATION_COMPLETE" };

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
            send({ type: "TICK", delta: direction * POSITION_DELTA_PER_TICK });
          }),
        ),
      );
    }),
});

// ============================================================================
// Garage Door Machine
// ============================================================================

export const garageDoorMachine = createMachine<
  "garageDoor",
  GarageDoorState,
  GarageDoorContext,
  GarageDoorEvent
>({
  id: "garageDoor",
  initial: "closed",
  context: {
    position: 0,
  },
  states: {
    closed: {
      entry: [assign({ position: 0 })],
      on: {
        CLICK: { target: "opening" },
      },
    },

    opening: {
      entry: [
        effect(() => Effect.log("Entering: opening")),
      ],
      activities: [createAnimationActivity(1)],
      on: {
        CLICK: { target: "paused-while-opening" },
        TICK: {
          actions: [
            assign(({ context, event }) => {
              const tickEvent = event as { type: "TICK"; delta: number };
              const newPosition = Math.min(100, context.position + tickEvent.delta);
              return { position: newPosition };
            }),
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
      entry: [assign({ position: 100 })],
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
            assign(({ context, event }) => {
              const tickEvent = event as { type: "TICK"; delta: number };
              const newPosition = Math.max(0, context.position + tickEvent.delta);
              return { position: newPosition };
            }),
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
// Atom Integration
// ============================================================================

// Create atoms with full type inference from appRuntime
const actorAtom = appRuntime
  .atom(interpret(garageDoorMachine))
  .pipe(Atom.keepAlive);

const snapshotAtom = appRuntime
  .subscriptionRef((get) =>
    Effect.gen(function* () {
      const actor = yield* get.result(actorAtom);
      return actor.snapshotRef;
    })
  )
  .pipe(Atom.keepAlive);

// Create the hook with full type safety
const useMachine = createUseMachineHook(
  actorAtom,
  snapshotAtom,
  garageDoorMachine.initialSnapshot,
);

// ============================================================================
// Status type for UI consumption
// ============================================================================

export interface GarageDoorStatus {
  readonly state: GarageDoorState;
  readonly position: number;
}

// ============================================================================
// React Hook
// ============================================================================

export const useGarageDoor = (): {
  status: GarageDoorStatus;
  handleButtonClick: () => void;
  isLoading: boolean;
} => {
  const { snapshot, send, isLoading, matches, context } = useMachine();

  const handleButtonClick = () => {
    send({ type: "CLICK" });
  };

  // Check for animation completion
  if (context.position >= 100 && matches("opening")) {
    send({ type: "ANIMATION_COMPLETE" });
  } else if (context.position <= 0 && matches("closing")) {
    send({ type: "ANIMATION_COMPLETE" });
  }

  return {
    status: {
      state: snapshot.value,
      position: context.position,
    },
    handleButtonClick,
    isLoading,
  };
};

// ============================================================================
// UI Helpers
// ============================================================================

export const getStateLabel = (state: GarageDoorState): string => {
  switch (state) {
    case "closed":
      return "Closed";
    case "opening":
      return "Opening...";
    case "paused-while-opening":
      return "Paused (was opening)";
    case "open":
      return "Open";
    case "closing":
      return "Closing...";
    case "paused-while-closing":
      return "Paused (was closing)";
  }
};

export const getButtonLabel = (state: GarageDoorState): string => {
  switch (state) {
    case "closed":
      return "Open Door";
    case "opening":
      return "Pause";
    case "paused-while-opening":
      return "Close Door";
    case "open":
      return "Close Door";
    case "closing":
      return "Pause";
    case "paused-while-closing":
      return "Open Door";
  }
};
