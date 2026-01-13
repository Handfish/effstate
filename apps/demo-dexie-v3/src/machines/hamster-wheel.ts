/**
 * Hamster Wheel Machine - v3 API
 *
 * Compare to v2: ~200 lines -> ~60 lines
 */

import { Data, Duration, Effect, Schedule, Schema, Stream } from "effect";
import { defineMachine, type MachineActor, type MachineSnapshot } from "effstate/v3";

// ============================================================================
// State (Discriminated Union)
// ============================================================================

export type HamsterState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running"; readonly startedAt: Date }
  | { readonly _tag: "Stopping"; readonly stoppingAt: Date };

export const HamsterState = {
  Idle: (): HamsterState => ({ _tag: "Idle" }),
  Running: (startedAt: Date): HamsterState => ({ _tag: "Running", startedAt }),
  Stopping: (stoppingAt: Date): HamsterState => ({ _tag: "Stopping", stoppingAt }),
};

// ============================================================================
// Context
// ============================================================================

export interface HamsterContext {
  readonly wheelRotation: number;
  readonly electricityLevel: number;
  readonly [key: string]: unknown; // Index signature for MachineContext
}

const HamsterContextSchema = Schema.Struct({
  wheelRotation: Schema.Number,
  electricityLevel: Schema.Number,
});

// ============================================================================
// Events
// ============================================================================

export class Toggle extends Data.TaggedClass("Toggle")<{}> {}
export class HamsterTick extends Data.TaggedClass("HamsterTick")<{ readonly delta: number }> {}
export class StopComplete extends Data.TaggedClass("StopComplete")<{}> {}

export type HamsterEvent = Toggle | HamsterTick | StopComplete;

// ============================================================================
// Machine Definition
// ============================================================================

const tickStream = Stream.fromSchedule(Schedule.spaced(Duration.millis(16))).pipe(
  Stream.map(() => new HamsterTick({ delta: 5 }))
);

const stopDelayStream = Stream.fromEffect(Effect.sleep(Duration.seconds(2))).pipe(
  Stream.map(() => new StopComplete())
);

export const hamsterWheelMachine = defineMachine<
  HamsterState,
  HamsterContext,
  HamsterEvent,
  typeof HamsterContextSchema
>({
  id: "hamsterWheel",
  context: HamsterContextSchema,
  initialContext: { wheelRotation: 0, electricityLevel: 0 },
  initialState: HamsterState.Idle(),

  states: {
    Idle: {
      on: {
        Toggle: (_ctx, _event, { goto }) =>
          goto(HamsterState.Running(new Date()), { electricityLevel: 100 }),
      },
    },

    Running: {
      run: tickStream,
      on: {
        Toggle: (_ctx, _event, { goto }) =>
          goto(HamsterState.Stopping(new Date())),
        HamsterTick: (ctx, event, { update }) =>
          update({ wheelRotation: (ctx.wheelRotation + event.delta) % 360 }),
      },
    },

    Stopping: {
      run: stopDelayStream,
      on: {
        Toggle: (_ctx, _event, { goto }) =>
          goto(HamsterState.Running(new Date()), { electricityLevel: 100 }),
        StopComplete: (_ctx, _event, { goto }) =>
          goto(HamsterState.Idle(), { electricityLevel: 0 }),
      },
    },
  },
});

// ============================================================================
// Types
// ============================================================================

export type HamsterWheelActor = MachineActor<HamsterState, HamsterContext, HamsterEvent>;
export type HamsterWheelSnapshot = MachineSnapshot<HamsterState, HamsterContext>;

// ============================================================================
// Helpers
// ============================================================================

export function getHamsterStateLabel(state: HamsterState): string {
  switch (state._tag) {
    case "Idle": return "Resting";
    case "Running": return "Running!";
    case "Stopping": return "Slowing down...";
  }
}

export function getHamsterButtonLabel(state: HamsterState): string {
  switch (state._tag) {
    case "Idle": return "Wake Up Hamster";
    case "Running": return "Stop Hamster";
    case "Stopping": return "Start Running Again";
  }
}
