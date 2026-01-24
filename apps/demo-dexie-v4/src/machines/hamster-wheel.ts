/**
 * Hamster Wheel Machine - v4 Schema-First API
 *
 * Uses State/Event helpers for schema-first definitions.
 */

import { Duration, Effect, Schedule, Schema, Stream } from "effect";
import {
  State,
  Event,
  Union,
  defineMachine,
  type MachineActor,
  type MachineSnapshot,
  type StateType,
  type EventType,
} from "effstate/v4";

// ============================================================================
// State (Schema-First Discriminated Union)
// ============================================================================

export const Idle = State("Idle", {});
export const Running = State("Running", { startedAt: Schema.DateFromSelf });
export const Stopping = State("Stopping", { stoppingAt: Schema.DateFromSelf });

export const HamsterStateSchema = Union(Idle, Running, Stopping);
export type HamsterState = StateType<typeof Idle> | StateType<typeof Running> | StateType<typeof Stopping>;

// ============================================================================
// Context
// ============================================================================

export interface HamsterContext {
  readonly wheelRotation: number;
  readonly electricityLevel: number;
}

const HamsterContextSchema = Schema.Struct({
  wheelRotation: Schema.Number,
  electricityLevel: Schema.Number,
});

// ============================================================================
// Events (Schema-First)
// ============================================================================

export const Toggle = Event("Toggle", {});
export const HamsterTick = Event("HamsterTick", { delta: Schema.Number });
export const StopComplete = Event("StopComplete", {});

export const HamsterEventSchema = Union(Toggle, HamsterTick, StopComplete);
export type HamsterEvent = EventType<typeof Toggle> | EventType<typeof HamsterTick> | EventType<typeof StopComplete>;

// ============================================================================
// Machine Definition
// ============================================================================

const tickStream = Stream.fromSchedule(Schedule.spaced(Duration.millis(16))).pipe(
  Stream.map(() => HamsterTick.make({ delta: 5 }))
);

const stopDelayStream = Stream.fromEffect(Effect.sleep(Duration.seconds(2))).pipe(
  Stream.map(() => StopComplete.make())
);

export const hamsterWheelMachine = defineMachine<HamsterState, HamsterContext, HamsterEvent>({
  id: "hamsterWheel",
  context: HamsterContextSchema,
  initialContext: { wheelRotation: 0, electricityLevel: 0 },
  initialState: Idle.make(),

  states: {
    Idle: {
      on: {
        Toggle: () => ({ goto: Running.make({ startedAt: new Date() }), update: { electricityLevel: 100 } }),
      },
    },

    Running: {
      run: tickStream,
      on: {
        Toggle: () => ({ goto: Stopping.make({ stoppingAt: new Date() }) }),
        HamsterTick: (ctx, event) => ({ update: { wheelRotation: (ctx.wheelRotation + event.delta) % 360 } }),
      },
    },

    Stopping: {
      run: stopDelayStream,
      on: {
        Toggle: () => ({ goto: Running.make({ startedAt: new Date() }), update: { electricityLevel: 100 } }),
        StopComplete: () => ({ goto: Idle.make(), update: { electricityLevel: 0 } }),
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
