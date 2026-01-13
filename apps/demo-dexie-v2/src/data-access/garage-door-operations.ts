/**
 * GarageDoor Machine - v2 API with Dexie persistence
 *
 * Demonstrates:
 * - Discriminated union states (Data.TaggedEnum)
 * - Exhaustive event handling with Match
 * - Fluent transition builders (goto, update, stay) received via typed builders
 * - Unified `run` for effects and streams
 * - Effect.Service pattern for dependencies
 */

import { Machine, update as updateTransition } from "effstate/v2";
import type { MachineSnapshot, MachineActor } from "effstate/v2";
import {
  WeatherService,
  type Weather,
} from "@/lib/services/weather-service";
import { Data, Duration, Effect, Match, Schedule, Schema, Scope, Stream } from "effect";

// ============================================================================
// States (Discriminated Union with Data)
// ============================================================================

export type GarageDoorState = Data.TaggedEnum<{
  Closed: {};
  Opening: { readonly startedAt: Date };
  PausedWhileOpening: { readonly pausedAt: Date; readonly pausedPosition: number };
  Open: { readonly openedAt: Date };
  Closing: { readonly startedAt: Date };
  PausedWhileClosing: { readonly pausedAt: Date; readonly pausedPosition: number };
}>;

export const GarageDoorState = Data.taggedEnum<GarageDoorState>();

// ============================================================================
// Events
// ============================================================================

export class Click extends Data.TaggedClass("Click")<{}> {}
export class Tick extends Data.TaggedClass("Tick")<{ readonly delta: number }> {}
export class AnimationComplete extends Data.TaggedClass("AnimationComplete")<{}> {}
export class PowerOn extends Data.TaggedClass("PowerOn")<{}> {}
export class PowerOff extends Data.TaggedClass("PowerOff")<{}> {}
export class BangHammer extends Data.TaggedClass("BangHammer")<{}> {}

export type GarageDoorEvent = Click | Tick | AnimationComplete | PowerOn | PowerOff | BangHammer;

// Event sent to parent when hammer is banged
export class WakeHamster extends Data.TaggedClass("WakeHamster")<{}> {}

// ============================================================================
// Weather Status
// ============================================================================

export type WeatherStatus =
  | { readonly _tag: "idle" }
  | { readonly _tag: "loading" }
  | { readonly _tag: "loaded"; readonly weather: Weather }
  | { readonly _tag: "error"; readonly error: string };

const WeatherDataSchema = Schema.Struct({
  status: Schema.Literal("idle", "loading", "loaded", "error"),
  temp: Schema.optional(Schema.Number),
  desc: Schema.optional(Schema.String),
  icon: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});

// ============================================================================
// Context Schema
// ============================================================================

export const GarageDoorContextSchema = Schema.Struct({
  position: Schema.Number,
  lastUpdated: Schema.DateFromString,
  weather: WeatherDataSchema,
  isPowered: Schema.Boolean,
});

export type GarageDoorContext = typeof GarageDoorContextSchema.Type;

// ============================================================================
// Animation Constants
// ============================================================================

const CYCLE_MS = 10_000;
const TICK_MS = 16;
const DELTA = 100 / (CYCLE_MS / TICK_MS);

const tickStream = (direction: 1 | -1): Stream.Stream<Tick> =>
  Stream.fromSchedule(Schedule.spaced(Duration.millis(TICK_MS))).pipe(
    Stream.map(() => new Tick({ delta: direction * DELTA })),
  );

// ============================================================================
// Initial Snapshot
// ============================================================================

export type GarageDoorSnapshot = MachineSnapshot<GarageDoorState, GarageDoorContext>;

export const initialSnapshot: GarageDoorSnapshot = {
  state: GarageDoorState.Closed(),
  context: {
    position: 0,
    lastUpdated: new Date(),
    weather: { status: "idle" },
    isPowered: false,
  },
  event: null,
};

// ============================================================================
// Default Location
// ============================================================================

const DEFAULT_LAT = 37.7749;
const DEFAULT_LON = -122.4194;

// ============================================================================
// Garage Door Machine Service
// ============================================================================

/**
 * GarageDoor machine as an Effect.Service using v2 API.
 *
 * The machine captures WeatherService at creation time via closure.
 * Uses discriminated union states and exhaustive event handling.
 */
export class GarageDoorMachineService extends Effect.Service<GarageDoorMachineService>()(
  "GarageDoorMachineService",
  {
    effect: Effect.gen(function* () {
      // Capture WeatherService at service creation time
      const weatherService = yield* WeatherService;

      // Machine definition with v2 API - explicit type parameters for proper inference
      const machine = Machine.define<
        GarageDoorState,
        GarageDoorContext,
        GarageDoorEvent,
        typeof GarageDoorContextSchema,
        WakeHamster
      >({
        id: "garageDoor",
        context: GarageDoorContextSchema,
        initialContext: {
          position: 0,
          lastUpdated: new Date(),
          weather: { status: "idle" },
          isPowered: false,
        },
        initialState: GarageDoorState.Closed(),

        // Global handlers - apply to all states
        global: (_ctx, event, { update, stay }) =>
          Match.value(event).pipe(
            Match.tag("PowerOn", () => update({ isPowered: true })),
            Match.tag("PowerOff", () => update({ isPowered: false })),
            Match.tag("BangHammer", () => stay.emit(new WakeHamster())),
            Match.orElse(() => null), // Pass to state handler
          ),

        states: {
          // ========================================================================
          // Closed
          // ========================================================================
          Closed: {
            entry: () =>
              Effect.log("Door is closed").pipe(
                Effect.as(undefined)
              ),

            on: (ctx, _state, { goto, stay }) => (event) =>
              Match.value(event).pipe(
                Match.tag("Click", () =>
                  ctx.isPowered
                    ? goto(GarageDoorState.Opening({ startedAt: new Date() }))
                        .update({ position: 0, lastUpdated: new Date(), weather: { status: "idle" } })
                    : stay
                ),
                Match.orElse(() => stay),
              ),
          },

          // ========================================================================
          // Opening
          // ========================================================================
          Opening: {
            entry: ({ startedAt }) =>
              Effect.log(`Opening started at ${startedAt.toISOString()}`),

            // Stream runs while in this state
            run: tickStream(1),

            on: (ctx, _state, { goto, update, stay }) => (event) =>
              Match.value(event).pipe(
                Match.tag("Click", () =>
                  ctx.isPowered
                    ? goto(
                        GarageDoorState.PausedWhileOpening({
                          pausedAt: new Date(),
                          pausedPosition: ctx.position,
                        })
                      )
                    : stay
                ),
                Match.tag("Tick", ({ delta }) => {
                  if (!ctx.isPowered) return stay;
                  const newPosition = Math.min(100, ctx.position + delta);
                  return update({ position: newPosition, lastUpdated: new Date() });
                }),
                Match.tag("AnimationComplete", () =>
                  ctx.isPowered
                    ? goto(GarageDoorState.Open({ openedAt: new Date() }))
                        .update({ position: 100, lastUpdated: new Date(), weather: { status: "loading" } })
                    : stay
                ),
                Match.orElse(() => stay),
              ),
          },

          // ========================================================================
          // PausedWhileOpening
          // ========================================================================
          PausedWhileOpening: {
            entry: ({ pausedPosition }) =>
              Effect.log(`Paused at ${pausedPosition.toFixed(1)}%`),

            on: (ctx, state, { goto, stay }) => (event) =>
              Match.value(event).pipe(
                Match.tag("Click", () =>
                  ctx.isPowered
                    ? goto(GarageDoorState.Closing({ startedAt: new Date() }))
                        .effect(Effect.log(`Paused for ${Date.now() - state.pausedAt.getTime()}ms`))
                    : stay
                ),
                Match.orElse(() => stay),
              ),
          },

          // ========================================================================
          // Open
          // ========================================================================
          Open: {
            entry: ({ openedAt }) =>
              Effect.log(`Door opened at ${openedAt.toISOString()}`),

            // Effect runs once when entering state - fetches weather
            run: weatherService.getWeather(DEFAULT_LAT, DEFAULT_LON).pipe(
              Effect.map(({ temperature, description, icon }) =>
                updateTransition({
                  weather: { status: "loaded" as const, temp: temperature, desc: description, icon },
                })
              ),
              Effect.catchTags({
                WeatherNetworkError: ({ message }) =>
                  Effect.succeed(
                    updateTransition({
                      weather: { status: "error" as const, error: `Network: ${message}` },
                    })
                  ),
                WeatherParseError: ({ message }) =>
                  Effect.succeed(
                    updateTransition({
                      weather: { status: "error" as const, error: `Parse: ${message}` },
                    })
                  ),
              }),
              Effect.catchAllDefect((defect) =>
                Effect.succeed(
                  updateTransition({
                    weather: { status: "error" as const, error: `Unexpected: ${String(defect)}` },
                  })
                )
              ),
            ),

            on: (ctx, state, { goto, stay }) => (event) =>
              Match.value(event).pipe(
                Match.tag("Click", () =>
                  ctx.isPowered
                    ? goto(GarageDoorState.Closing({ startedAt: new Date() }))
                        .update({ weather: { status: "idle" } })
                        .effect(Effect.log(`Door was open for ${Date.now() - state.openedAt.getTime()}ms`))
                    : stay
                ),
                Match.orElse(() => stay),
              ),
          },

          // ========================================================================
          // Closing
          // ========================================================================
          Closing: {
            entry: ({ startedAt }) =>
              Effect.log(`Closing started at ${startedAt.toISOString()}`),

            run: tickStream(-1),

            on: (ctx, state, { goto, update, stay }) => (event) =>
              Match.value(event).pipe(
                Match.tag("Click", () =>
                  ctx.isPowered
                    ? goto(
                        GarageDoorState.PausedWhileClosing({
                          pausedAt: new Date(),
                          pausedPosition: ctx.position,
                        })
                      )
                    : stay
                ),
                Match.tag("Tick", ({ delta }) => {
                  if (!ctx.isPowered) return stay;
                  const newPosition = Math.max(0, ctx.position + delta);
                  return update({ position: newPosition, lastUpdated: new Date() });
                }),
                Match.tag("AnimationComplete", () =>
                  ctx.isPowered
                    ? goto(GarageDoorState.Closed())
                        .update({ position: 0, lastUpdated: new Date() })
                        .effect(Effect.log(`Closed in ${Date.now() - state.startedAt.getTime()}ms`))
                    : stay
                ),
                Match.orElse(() => stay),
              ),
          },

          // ========================================================================
          // PausedWhileClosing
          // ========================================================================
          PausedWhileClosing: {
            entry: ({ pausedPosition }) =>
              Effect.log(`Paused while closing at ${pausedPosition.toFixed(1)}%`),

            on: (ctx, state, { goto, stay }) => (event) =>
              Match.value(event).pipe(
                Match.tag("Click", () =>
                  ctx.isPowered
                    ? goto(GarageDoorState.Opening({ startedAt: new Date() }))
                        .effect(Effect.log(`Paused for ${Date.now() - state.pausedAt.getTime()}ms`))
                    : stay
                ),
                Match.orElse(() => stay),
              ),
          },
        },
      });

      return {
        /** The machine definition - use with spawnChild in parent machines */
        definition: machine,
        /** Create a new actor instance */
        createActor: (): Effect.Effect<
          MachineActor<GarageDoorState, GarageDoorContext, GarageDoorEvent, {}>,
          never,
          Scope.Scope
        > => machine.interpret(),
      };
    }),
    // WeatherService is automatically provided via dependencies
    dependencies: [WeatherService.Default],
  }
) {}

// ============================================================================
// Status Helpers
// ============================================================================

export interface GarageDoorStatus {
  readonly state: GarageDoorState;
  readonly stateTag: GarageDoorState["_tag"];
  readonly position: number;
  readonly weather: WeatherStatus;
}

export const getWeatherStatus = (context: GarageDoorContext): WeatherStatus => {
  switch (context.weather.status) {
    case "loading":
      return { _tag: "loading" };
    case "loaded":
      return {
        _tag: "loaded",
        weather: {
          temperature: context.weather.temp!,
          description: context.weather.desc!,
          icon: context.weather.icon!,
        },
      };
    case "error":
      return { _tag: "error", error: context.weather.error! };
    default:
      return { _tag: "idle" };
  }
};

// ============================================================================
// UI Helpers
// ============================================================================

export const getStateLabel = (state: GarageDoorState): string =>
  Match.value(state).pipe(
    Match.tag("Closed", () => "Closed"),
    Match.tag("Opening", () => "Opening..."),
    Match.tag("PausedWhileOpening", () => "Paused (was opening)"),
    Match.tag("Open", () => "Open"),
    Match.tag("Closing", () => "Closing..."),
    Match.tag("PausedWhileClosing", () => "Paused (was closing)"),
    Match.exhaustive,
  );

export const getButtonLabel = (state: GarageDoorState): string =>
  Match.value(state).pipe(
    Match.tag("Closed", () => "Open Door"),
    Match.tag("Opening", () => "Pause"),
    Match.tag("PausedWhileOpening", () => "Close Door"),
    Match.tag("Open", () => "Close Door"),
    Match.tag("Closing", () => "Pause"),
    Match.tag("PausedWhileClosing", () => "Open Door"),
    Match.exhaustive,
  );

export const isAnimating = (state: GarageDoorState): boolean =>
  Match.value(state).pipe(
    Match.tag("Opening", () => true),
    Match.tag("Closing", () => true),
    Match.orElse(() => false),
  );
