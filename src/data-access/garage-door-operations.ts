import { Atom } from "@effect-atom/atom-react";
import { appRuntime } from "@/lib/app-runtime";
import {
  assign,
  createMachine,
  createUseMachineHook,
  effect,
  interpret,
} from "@/lib/state-machine";
import { Data, Duration, Effect, Match, Schedule, Stream, SubscriptionRef } from "effect";

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

// Events using Effect's Data.TaggedClass for structural equality and type safety
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
            assign(({ context, event }) => ({
              position: Math.min(100, context.position + event.delta),
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
            assign(({ context, event }) => ({
              position: Math.max(0, context.position + event.delta),
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
// Atom Integration
// ============================================================================

// Create atoms with full type inference from appRuntime
// interpret() now returns MachineActor synchronously, so wrap in Effect.sync
const actorAtom = appRuntime
  .atom(Effect.sync(() => interpret(garageDoorMachine)))
  .pipe(Atom.keepAlive);

// Create a SubscriptionRef that stays in sync with the actor's snapshot
const snapshotAtom = appRuntime
  .subscriptionRef((get) =>
    Effect.gen(function* () {
      const actor = yield* get.result(actorAtom);
      // Create a SubscriptionRef with the current snapshot
      const ref = yield* SubscriptionRef.make(actor.getSnapshot());
      // Subscribe to actor changes and update the ref
      actor.subscribe((snapshot) => {
        Effect.runSync(SubscriptionRef.set(ref, snapshot));
      });
      return ref;
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
    send(new Click());
  };

  // Check for animation completion
  if (context.position >= 100 && matches("opening")) {
    send(new AnimationComplete());
  } else if (context.position <= 0 && matches("closing")) {
    send(new AnimationComplete());
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
// UI Helpers (using Effect Match for exhaustive pattern matching)
// ============================================================================

const StateLabelMatcher = Match.type<GarageDoorState>().pipe(
  Match.when("closed", () => "Closed"),
  Match.when("opening", () => "Opening..."),
  Match.when("paused-while-opening", () => "Paused (was opening)"),
  Match.when("open", () => "Open"),
  Match.when("closing", () => "Closing..."),
  Match.when("paused-while-closing", () => "Paused (was closing)"),
  Match.exhaustive,
);

export const getStateLabel = (state: GarageDoorState): string =>
  StateLabelMatcher(state);

const ButtonLabelMatcher = Match.type<GarageDoorState>().pipe(
  Match.when("closed", () => "Open Door"),
  Match.when("opening", () => "Pause"),
  Match.when("paused-while-opening", () => "Close Door"),
  Match.when("open", () => "Close Door"),
  Match.when("closing", () => "Pause"),
  Match.when("paused-while-closing", () => "Open Door"),
  Match.exhaustive,
);

export const getButtonLabel = (state: GarageDoorState): string =>
  ButtonLabelMatcher(state);
