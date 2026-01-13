/**
 * Garage Door Machine - v3 API
 *
 * Compare to v2: ~250 lines -> ~100 lines
 */

import { Data, Duration, Effect, Schedule, Schema, Stream } from "effect";
import { defineMachine, type MachineActor, type MachineSnapshot } from "effstate/v3";
import { fetchWeather } from "@/lib/weather-service";

// ============================================================================
// State (Discriminated Union)
// ============================================================================

export type DoorState =
  | { readonly _tag: "Closed" }
  | { readonly _tag: "Opening"; readonly startedAt: Date }
  | { readonly _tag: "PausedOpening"; readonly pausedAt: Date }
  | { readonly _tag: "Open"; readonly openedAt: Date }
  | { readonly _tag: "Closing"; readonly startedAt: Date }
  | { readonly _tag: "PausedClosing"; readonly pausedAt: Date };

export const DoorState = {
  Closed: (): DoorState => ({ _tag: "Closed" }),
  Opening: (startedAt: Date): DoorState => ({ _tag: "Opening", startedAt }),
  PausedOpening: (pausedAt: Date): DoorState => ({ _tag: "PausedOpening", pausedAt }),
  Open: (openedAt: Date): DoorState => ({ _tag: "Open", openedAt }),
  Closing: (startedAt: Date): DoorState => ({ _tag: "Closing", startedAt }),
  PausedClosing: (pausedAt: Date): DoorState => ({ _tag: "PausedClosing", pausedAt }),
};

// ============================================================================
// Context
// ============================================================================

export type WeatherStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; temp: number; desc: string; icon: string }
  | { status: "error"; message: string };

export const Weather = {
  idle: (): WeatherStatus => ({ status: "idle" }),
  loading: (): WeatherStatus => ({ status: "loading" }),
  loaded: (temp: number, desc: string, icon: string): WeatherStatus => ({ status: "loaded", temp, desc, icon }),
  error: (message: string): WeatherStatus => ({ status: "error", message }),
};

export interface DoorContext {
  readonly position: number;
  readonly isPowered: boolean;
  readonly weather: WeatherStatus;
}

const DoorContextSchema = Schema.Struct({
  position: Schema.Number,
  isPowered: Schema.Boolean,
  weather: Schema.Union(
    Schema.Struct({ status: Schema.Literal("idle") }),
    Schema.Struct({ status: Schema.Literal("loading") }),
    Schema.Struct({
      status: Schema.Literal("loaded"),
      temp: Schema.Number,
      desc: Schema.String,
      icon: Schema.String,
    }),
    Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
  ),
});

// ============================================================================
// Events
// ============================================================================

export class Click extends Data.TaggedClass("Click")<{}> {}
export class DoorTick extends Data.TaggedClass("DoorTick")<{ readonly delta: number }> {}
export class PowerOn extends Data.TaggedClass("PowerOn")<{}> {}
export class PowerOff extends Data.TaggedClass("PowerOff")<{}> {}
export class WeatherLoaded extends Data.TaggedClass("WeatherLoaded")<{
  readonly temp: number;
  readonly desc: string;
  readonly icon: string;
}> {}
export class WeatherError extends Data.TaggedClass("WeatherError")<{ readonly message: string }> {}

export type DoorEvent = Click | DoorTick | PowerOn | PowerOff | WeatherLoaded | WeatherError;

// ============================================================================
// Machine Definition
// ============================================================================

const tickStream = (delta: number) =>
  Stream.fromSchedule(Schedule.spaced(Duration.millis(16))).pipe(
    Stream.map(() => new DoorTick({ delta: delta * 0.16 })),
  );

const weatherFetchStream: Stream.Stream<DoorEvent> = Stream.fromEffect(
  Effect.tryPromise({
    try: () => fetchWeather(),
    catch: (e) => e as Error,
  }).pipe(
    Effect.map(
      (w) =>
        new WeatherLoaded({ temp: w.temperature, desc: w.description, icon: w.icon }) as DoorEvent,
    ),
    Effect.catchAll((e: Error) =>
      Effect.succeed(new WeatherError({ message: e.message }) as DoorEvent),
    ),
  ),
);

export const garageDoorMachine = defineMachine<DoorState, DoorContext, DoorEvent>({
  id: "garageDoor",
  context: DoorContextSchema,
  initialContext: { position: 0, isPowered: false, weather: Weather.idle() },
  initialState: DoorState.Closed(),

  global: {
    PowerOn: () => ({ update: { isPowered: true } }),
    PowerOff: () => ({ update: { isPowered: false } }),
  },

  states: {
    Closed: {
      on: {
        Click: (ctx) => (ctx.isPowered ? { goto: DoorState.Opening(new Date()) } : null),
      },
    },

    Opening: {
      run: tickStream(1),
      on: {
        Click: () => ({ goto: DoorState.PausedOpening(new Date()) }),
        DoorTick: (ctx, event) => {
          const newPos = Math.min(100, ctx.position + event.delta);
          return newPos >= 100
            ? { goto: DoorState.Open(new Date()), update: { position: 100, weather: Weather.loading() } }
            : { update: { position: newPos } };
        },
        PowerOff: () => ({ goto: DoorState.PausedOpening(new Date()), update: { isPowered: false } }),
      },
    },

    PausedOpening: {
      on: {
        Click: (ctx) => (ctx.isPowered ? { goto: DoorState.Closing(new Date()) } : null),
        PowerOn: () => ({ goto: DoorState.Opening(new Date()), update: { isPowered: true } }),
      },
    },

    Open: {
      run: (snap) =>
        snap.context.weather.status === "loading" ? weatherFetchStream : Stream.empty,
      on: {
        Click: (ctx) =>
          ctx.isPowered
            ? { goto: DoorState.Closing(new Date()), update: { weather: Weather.idle() } }
            : null,
        WeatherLoaded: (_ctx, event) => ({
          update: { weather: Weather.loaded(event.temp, event.desc, event.icon) },
        }),
        WeatherError: (_ctx, event) => ({
          update: { weather: Weather.error(event.message) },
        }),
      },
    },

    Closing: {
      run: tickStream(-1),
      on: {
        Click: () => ({ goto: DoorState.PausedClosing(new Date()) }),
        DoorTick: (ctx, event) => {
          const newPos = Math.max(0, ctx.position + event.delta);
          return newPos <= 0
            ? { goto: DoorState.Closed(), update: { position: 0 } }
            : { update: { position: newPos } };
        },
        PowerOff: () => ({ goto: DoorState.PausedClosing(new Date()), update: { isPowered: false } }),
      },
    },

    PausedClosing: {
      on: {
        Click: (ctx) => (ctx.isPowered ? { goto: DoorState.Opening(new Date()) } : null),
        PowerOn: () => ({ goto: DoorState.Closing(new Date()), update: { isPowered: true } }),
      },
    },
  },
});

// ============================================================================
// Types
// ============================================================================

export type GarageDoorActor = MachineActor<DoorState, DoorContext, DoorEvent>;
export type GarageDoorSnapshot = MachineSnapshot<DoorState, DoorContext>;

// ============================================================================
// Helpers
// ============================================================================

export function getDoorStateLabel(state: DoorState): string {
  switch (state._tag) {
    case "Closed": return "Closed";
    case "Opening": return "Opening...";
    case "PausedOpening": return "Paused (Opening)";
    case "Open": return "Open";
    case "Closing": return "Closing...";
    case "PausedClosing": return "Paused (Closing)";
  }
}

export function getDoorButtonLabel(state: DoorState): string {
  switch (state._tag) {
    case "Closed": return "Open";
    case "Opening": return "Pause";
    case "PausedOpening": return "Close";
    case "Open": return "Close";
    case "Closing": return "Pause";
    case "PausedClosing": return "Open";
  }
}
