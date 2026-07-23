/**
 * Garage Door Machine - effstate v4 (schema-first)
 *
 * The door animates via a `run` tick stream while opening/closing, and fetches
 * weather via a one-shot `run` stream when it reaches the Open state. Both
 * streams auto-cancel when the machine leaves their state.
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
} from "@handfish/effstate-v4";
import { fetchWeather } from "@/lib/weather";

// ============================================================================
// State (Schema-First Discriminated Union)
// ============================================================================

export const Closed = State("Closed", {});
export const Opening = State("Opening", { startedAt: Schema.DateFromSelf });
export const PausedOpening = State("PausedOpening", { pausedAt: Schema.DateFromSelf });
export const Open = State("Open", { openedAt: Schema.DateFromSelf });
export const Closing = State("Closing", { startedAt: Schema.DateFromSelf });
export const PausedClosing = State("PausedClosing", { pausedAt: Schema.DateFromSelf });

export const DoorStateSchema = Union(Closed, Opening, PausedOpening, Open, Closing, PausedClosing);
export type DoorState =
  | StateType<typeof Closed>
  | StateType<typeof Opening>
  | StateType<typeof PausedOpening>
  | StateType<typeof Open>
  | StateType<typeof Closing>
  | StateType<typeof PausedClosing>;

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

// ============================================================================
// Events (Schema-First)
// ============================================================================

export const Click = Event("Click", {});
export const DoorTick = Event("DoorTick", { delta: Schema.Number });
export const PowerOn = Event("PowerOn", {});
export const PowerOff = Event("PowerOff", {});
export const WeatherLoaded = Event("WeatherLoaded", {
  temp: Schema.Number,
  desc: Schema.String,
  icon: Schema.String,
});
export const WeatherError = Event("WeatherError", { message: Schema.String });

export const DoorEventSchema = Union(Click, DoorTick, PowerOn, PowerOff, WeatherLoaded, WeatherError);
export type DoorEvent =
  | EventType<typeof Click>
  | EventType<typeof DoorTick>
  | EventType<typeof PowerOn>
  | EventType<typeof PowerOff>
  | EventType<typeof WeatherLoaded>
  | EventType<typeof WeatherError>;

// ============================================================================
// Machine Definition
// ============================================================================

const tickStream = (delta: number) =>
  Stream.fromSchedule(Schedule.spaced(Duration.millis(16))).pipe(
    Stream.map(() => DoorTick.make({ delta: delta * 0.16 })),
  );

const weatherFetchStream: Stream.Stream<DoorEvent> = Stream.fromEffect(
  Effect.tryPromise({
    try: () => fetchWeather(),
    catch: (e) => e as Error,
  }).pipe(
    Effect.map(
      (w) => WeatherLoaded.make({ temp: w.temperature, desc: w.description, icon: w.icon }) as DoorEvent,
    ),
    Effect.catchAll((e: Error) =>
      Effect.succeed(WeatherError.make({ message: e.message }) as DoorEvent),
    ),
  ),
);

export const garageDoorMachine = defineMachine<DoorState, DoorContext, DoorEvent>({
  id: "garageDoor",
  initialContext: { position: 0, isPowered: false, weather: Weather.idle() },
  initialState: Closed.make(),

  global: {
    PowerOn: () => ({ update: { isPowered: true } }),
    PowerOff: () => ({ update: { isPowered: false } }),
  },

  states: {
    Closed: {
      on: {
        Click: (ctx) => (ctx.isPowered ? { goto: Opening.make({ startedAt: new Date() }) } : null),
      },
    },

    Opening: {
      run: tickStream(1),
      on: {
        Click: () => ({ goto: PausedOpening.make({ pausedAt: new Date() }) }),
        DoorTick: (ctx, event) => {
          const newPos = Math.min(100, ctx.position + event.delta);
          return newPos >= 100
            ? { goto: Open.make({ openedAt: new Date() }), update: { position: 100, weather: Weather.loading() } }
            : { update: { position: newPos } };
        },
        PowerOff: () => ({ goto: PausedOpening.make({ pausedAt: new Date() }), update: { isPowered: false } }),
      },
    },

    PausedOpening: {
      on: {
        Click: (ctx) => (ctx.isPowered ? { goto: Closing.make({ startedAt: new Date() }) } : null),
        PowerOn: () => ({ goto: Opening.make({ startedAt: new Date() }), update: { isPowered: true } }),
      },
    },

    Open: {
      run: (snap) => (snap.context.weather.status === "loading" ? weatherFetchStream : Stream.empty),
      on: {
        Click: (ctx) =>
          ctx.isPowered
            ? { goto: Closing.make({ startedAt: new Date() }), update: { weather: Weather.idle() } }
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
        Click: () => ({ goto: PausedClosing.make({ pausedAt: new Date() }) }),
        DoorTick: (ctx, event) => {
          const newPos = Math.max(0, ctx.position + event.delta);
          return newPos <= 0
            ? { goto: Closed.make(), update: { position: 0 } }
            : { update: { position: newPos } };
        },
        PowerOff: () => ({ goto: PausedClosing.make({ pausedAt: new Date() }), update: { isPowered: false } }),
      },
    },

    PausedClosing: {
      on: {
        Click: (ctx) => (ctx.isPowered ? { goto: Opening.make({ startedAt: new Date() }) } : null),
        PowerOn: () => ({ goto: Closing.make({ startedAt: new Date() }), update: { isPowered: true } }),
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
