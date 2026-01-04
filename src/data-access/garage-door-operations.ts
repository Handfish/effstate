import { appRuntime } from "@/lib/app-runtime";
import { Atom, useAtomValue } from "@effect-atom/atom-react";
import { Duration, Effect, Queue, Schedule, Stream, SubscriptionRef } from "effect";
import React from "react";

// ============================================================================
// Garage Door State Machine Types
// ============================================================================

export type GarageDoorState =
  | "closed"
  | "opening"
  | "paused-while-opening"
  | "open"
  | "closing"
  | "paused-while-closing";

export interface GarageDoorStatus {
  readonly state: GarageDoorState;
  readonly position: number;
}

type Command = "click";

// ============================================================================
// Configuration
// ============================================================================

const FULL_CYCLE_DURATION = Duration.seconds(10);
const TICK_INTERVAL = Duration.millis(16);
const POSITION_DELTA_PER_TICK =
  100 / (Duration.toMillis(FULL_CYCLE_DURATION) / Duration.toMillis(TICK_INTERVAL));

// ============================================================================
// Helper
// ============================================================================

const makeStatus = (state: GarageDoorState, position: number): GarageDoorStatus => ({
  state,
  position,
});

// ============================================================================
// State machine logic
// ============================================================================

const getNextStateOnClick = (
  current: GarageDoorStatus,
): { status: GarageDoorStatus; direction: 1 | -1 | 0 } => {
  switch (current.state) {
    case "closed":
      return { status: makeStatus("opening", current.position), direction: 1 };
    case "open":
      return { status: makeStatus("closing", current.position), direction: -1 };
    case "opening":
      return { status: makeStatus("paused-while-opening", current.position), direction: 0 };
    case "closing":
      return { status: makeStatus("paused-while-closing", current.position), direction: 0 };
    case "paused-while-opening":
      return { status: makeStatus("closing", current.position), direction: -1 };
    case "paused-while-closing":
      return { status: makeStatus("opening", current.position), direction: 1 };
  }
};

// ============================================================================
// Garage Door Control Atom (with forkScoped animation loop)
// ============================================================================

const garageDoorControlAtom = appRuntime
  .atom(
    Effect.gen(function* () {
      const statusRef = yield* SubscriptionRef.make<GarageDoorStatus>(makeStatus("closed", 0));
      const commandQueue = yield* Queue.unbounded<Command>();

      // Animation loop runs forever, scoped to atom lifetime
      yield* Stream.fromQueue(commandQueue).pipe(
        Stream.runForEach(() =>
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(statusRef);
            const { status, direction } = getNextStateOnClick(current);

            yield* Effect.log(
              `Click received. State: ${current.state} -> ${status.state}, direction: ${direction}`,
            );
            yield* SubscriptionRef.set(statusRef, status);

            // If direction is non-zero, run animation until complete or interrupted by next click
            if (direction !== 0) {
              yield* runAnimation(statusRef, commandQueue, direction);
            }
          }),
        ),
        Effect.forkScoped,
      );

      return { statusRef, commandQueue };
    }),
  )
  .pipe(Atom.keepAlive);

// Animation runs until: reaches end, or receives a new click command
const runAnimation = (
  statusRef: SubscriptionRef.SubscriptionRef<GarageDoorStatus>,
  commandQueue: Queue.Queue<Command>,
  direction: 1 | -1,
) =>
  Effect.gen(function* () {
    yield* Effect.log(`Animation starting: ${direction === 1 ? "opening" : "closing"}`);

    // Use repeat with a schedule, checking for completion or interruption each tick
    yield* Effect.repeat(
      Effect.gen(function* () {
        // Check if there's a pending command (non-blocking)
        const hasCommand = yield* Queue.poll(commandQueue);
        if (hasCommand._tag === "Some") {
          // Put it back and stop animation - the main loop will handle it
          yield* Queue.offer(commandQueue, hasCommand.value);
          yield* Effect.log("Animation interrupted by click");
          return false; // Signal to stop
        }

        const current = yield* SubscriptionRef.get(statusRef);
        const newPosition = Math.max(
          0,
          Math.min(100, current.position + direction * POSITION_DELTA_PER_TICK),
        );

        if (newPosition <= 0) {
          yield* SubscriptionRef.set(statusRef, makeStatus("closed", 0));
          yield* Effect.log("Door fully closed");
          return false;
        } else if (newPosition >= 100) {
          yield* SubscriptionRef.set(statusRef, makeStatus("open", 100));
          yield* Effect.log("Door fully open");
          return false;
        } else {
          const newState: GarageDoorState = direction === 1 ? "opening" : "closing";
          yield* SubscriptionRef.set(statusRef, makeStatus(newState, newPosition));
          return true; // Continue animation
        }
      }),
      { while: (continueAnimation) => continueAnimation, schedule: Schedule.spaced(TICK_INTERVAL) },
    );
  });

// ============================================================================
// Public: Reactive status atom using subscriptionRef
// ============================================================================

const garageDoorStatusAtom = appRuntime
  .subscriptionRef((get) =>
    Effect.gen(function* () {
      const control = yield* get.result(garageDoorControlAtom);
      return control.statusRef;
    }),
  )
  .pipe(Atom.keepAlive);

// ============================================================================
// React Hook
// ============================================================================

export const useGarageDoor = () => {
  const controlResult = useAtomValue(garageDoorControlAtom);
  const statusResult = useAtomValue(garageDoorStatusAtom);

  const handleButtonClick = React.useCallback(() => {
    if (controlResult._tag !== "Success") return;
    controlResult.value.commandQueue.unsafeOffer("click");
  }, [controlResult]);

  const isLoading = controlResult._tag !== "Success" || statusResult._tag !== "Success";

  const status: GarageDoorStatus =
    statusResult._tag === "Success" ? statusResult.value : makeStatus("closed", 0);

  return {
    status,
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
