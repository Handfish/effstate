import {
  assign,
  assignOnDefect,
  assignOnFailure,
  assignOnSuccess,
  createMachine,
  effect,
  interpret,
  type MachineSnapshot,
  type MachineActor,
} from "@/lib/state-machine";
import {
  WeatherService,
  type Weather,
} from "@/lib/services/weather-service";
import { Data, Duration, Effect, Schedule, Schema, Scope, Stream } from "effect";

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

// Weather status for the UI
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

const GarageDoorContextSchema = Schema.Struct({
  position: Schema.Number,
  lastUpdated: Schema.DateFromString,
  weather: WeatherDataSchema,
  isPowered: Schema.Boolean,
});

class Click extends Data.TaggedClass("CLICK")<{}> {}
class Tick extends Data.TaggedClass("TICK")<{ readonly delta: number }> {}
class AnimationComplete extends Data.TaggedClass("ANIMATION_COMPLETE")<{}> {}
export class PowerOn extends Data.TaggedClass("POWER_ON")<{}> {}
export class PowerOff extends Data.TaggedClass("POWER_OFF")<{}> {}

export type GarageDoorEvent = Click | Tick | AnimationComplete | PowerOn | PowerOff;

// Type alias for snapshot
type GarageDoorContext = typeof GarageDoorContextSchema.Type;
type GarageDoorSnapshot = MachineSnapshot<GarageDoorState, GarageDoorContext>;

// Initial snapshot defined at module level (doesn't depend on services)
// Exported for use with createUseChildMachineHook
export const initialSnapshot: GarageDoorSnapshot = {
  value: "closed",
  context: {
    position: 0,
    lastUpdated: new Date(),
    weather: { status: "idle" },
    isPowered: false,
  },
  event: null,
};

// ============================================================================
// Animation Activity
// ============================================================================

const CYCLE_MS = 10_000;
const TICK_MS = 16;
const DELTA = 100 / (CYCLE_MS / TICK_MS);

const animation = (dir: 1 | -1) => ({
  id: `animation-${dir}`,
  src: ({ send }: { send: (e: GarageDoorEvent) => void }) =>
    Stream.fromSchedule(Schedule.spaced(Duration.millis(TICK_MS))).pipe(
      Stream.runForEach(() => Effect.sync(() => send(new Tick({ delta: dir * DELTA })))),
    ),
});

// ============================================================================
// Garage Door Machine Service
// ============================================================================

// Default location (San Francisco)
const DEFAULT_LAT = 37.7749;
const DEFAULT_LON = -122.4194;

/**
 * GarageDoor machine as an Effect.Service.
 *
 * The machine is defined inside the service, capturing WeatherService at creation time.
 * This provides:
 * - Clean types (no explicit R parameter needed)
 * - No type casts
 * - Automatic R channel composition via `dependencies`
 *
 * Parent machines should yield this service to access `.definition` for `spawnChild`.
 *
 * @example
 * ```ts
 * // Direct usage
 * const program = Effect.gen(function* () {
 *   const garageDoor = yield* GarageDoorMachineService;
 *   const actor = yield* garageDoor.createActor();
 *   actor.send(new Click());
 * });
 *
 * // As child machine (in parent service)
 * const parentService = Effect.gen(function* () {
 *   const garageDoorService = yield* GarageDoorMachineService;
 *   const parentMachine = createMachine({
 *     states: {
 *       idle: {
 *         entry: [spawnChild(garageDoorService.definition, { id: "garage" })],
 *       },
 *     },
 *   });
 *   return { definition: parentMachine };
 * });
 * ```
 */
export class GarageDoorMachineService extends Effect.Service<GarageDoorMachineService>()(
  "GarageDoorMachineService",
  {
    effect: Effect.gen(function* () {
      // Capture WeatherService at service creation time
      const weatherService = yield* WeatherService;

      // Machine definition with closure over weatherService
      // No R parameter needed - the service is already captured!
      const machine = createMachine<
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
          weather: { status: "idle" },
          isPowered: false,
        },
        states: {
          closed: {
            entry: [assign(() => ({ position: 0, lastUpdated: new Date(), weather: { status: "idle" } }))],
            on: {
              CLICK: { target: "opening", guard: ({ context }) => context.isPowered },
              POWER_ON: { actions: [assign(() => ({ isPowered: true }))] },
              POWER_OFF: { actions: [assign(() => ({ isPowered: false }))] },
            },
          },

          opening: {
            entry: [effect(() => Effect.log("Entering: opening"))],
            activities: [animation(1)],
            on: {
              CLICK: { target: "paused-while-opening", guard: ({ context }) => context.isPowered },
              TICK: {
                guard: ({ context }) => context.isPowered,
                actions: [
                  assign<GarageDoorContext, Tick>(({ context, event }) => ({
                    position: Math.min(100, context.position + event.delta),
                    lastUpdated: new Date(),
                  })),
                ],
              },
              ANIMATION_COMPLETE: { target: "open", guard: ({ context }) => context.isPowered },
              POWER_ON: { actions: [assign(() => ({ isPowered: true }))] },
              POWER_OFF: { actions: [assign(() => ({ isPowered: false }))] },
            },
          },

          "paused-while-opening": {
            entry: [effect(() => Effect.log("Entering: paused-while-opening"))],
            on: {
              CLICK: { target: "closing", guard: ({ context }) => context.isPowered },
              POWER_ON: { actions: [assign(() => ({ isPowered: true }))] },
              POWER_OFF: { actions: [assign(() => ({ isPowered: false }))] },
            },
          },

          open: {
            entry: [
              assign(() => ({ position: 100, lastUpdated: new Date(), weather: { status: "loading" } })),
              effect(() => Effect.log("Entering: open - fetching weather")),
            ],
            invoke: {
              id: "fetchWeather",
              // Closure over weatherService - returns Effect<Weather, WeatherError, never>
              src: () => weatherService.getWeather(DEFAULT_LAT, DEFAULT_LON),
              onSuccess: {
                actions: [
                  assignOnSuccess<GarageDoorContext, Weather>(({ output }) => ({
                    weather: {
                      status: "loaded",
                      temp: output.temperature,
                      desc: output.description,
                      icon: output.icon,
                    },
                  })),
                ],
              },
              catchTags: {
                WeatherNetworkError: {
                  actions: [
                    assignOnFailure<GarageDoorContext, { message: string }>(({ error }) => ({
                      weather: {
                        status: "error",
                        error: `Network error: ${error.message}`,
                      },
                    })),
                  ],
                },
                WeatherParseError: {
                  actions: [
                    assignOnFailure<GarageDoorContext, { message: string }>(({ error }) => ({
                      weather: {
                        status: "error",
                        error: `Data error: ${error.message}`,
                      },
                    })),
                  ],
                },
              },
              onDefect: {
                actions: [
                  assignOnDefect<GarageDoorContext>(({ defect }) => ({
                    weather: {
                      status: "error",
                      error: `Unexpected error: ${String(defect)}`,
                    },
                  })),
                ],
              },
            },
            on: {
              CLICK: { target: "closing", guard: ({ context }) => context.isPowered },
              POWER_ON: { actions: [assign(() => ({ isPowered: true }))] },
              POWER_OFF: { actions: [assign(() => ({ isPowered: false }))] },
            },
          },

          closing: {
            entry: [
              effect(() => Effect.log("Entering: closing")),
              assign(() => ({ weather: { status: "idle" } })),
            ],
            activities: [animation(-1)],
            on: {
              CLICK: { target: "paused-while-closing", guard: ({ context }) => context.isPowered },
              TICK: {
                guard: ({ context }) => context.isPowered,
                actions: [
                  assign<GarageDoorContext, Tick>(({ context, event }) => ({
                    position: Math.max(0, context.position + event.delta),
                    lastUpdated: new Date(),
                  })),
                ],
              },
              ANIMATION_COMPLETE: { target: "closed", guard: ({ context }) => context.isPowered },
              POWER_ON: { actions: [assign(() => ({ isPowered: true }))] },
              POWER_OFF: { actions: [assign(() => ({ isPowered: false }))] },
            },
          },

          "paused-while-closing": {
            entry: [effect(() => Effect.log("Entering: paused-while-closing"))],
            on: {
              CLICK: { target: "opening", guard: ({ context }) => context.isPowered },
              POWER_ON: { actions: [assign(() => ({ isPowered: true }))] },
              POWER_OFF: { actions: [assign(() => ({ isPowered: false }))] },
            },
          },
        },
      });

      return {
        /** The machine definition - use with spawnChild in parent machines */
        definition: machine,
        /** Create a new actor instance */
        createActor: (): Effect.Effect<
          MachineActor<GarageDoorState, GarageDoorContext, GarageDoorEvent>,
          never,
          Scope.Scope
        > => interpret(machine),
      };
    }),
    // WeatherService is automatically provided via dependencies
    dependencies: [WeatherService.Default],
  }
) {}

// ============================================================================
// Persistence
// ============================================================================

const STORAGE_KEY = "garageDoor:snapshot";

export const loadSnapshot = (): GarageDoorSnapshot | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const encoded = JSON.parse(stored);
    return {
      value: encoded.value as GarageDoorState,
      context: Schema.decodeSync(GarageDoorContextSchema)(encoded.context),
      event: null,
    };
  } catch {
    return null;
  }
};

// ============================================================================
// Exported Events (for component use)
// ============================================================================

export { Click, AnimationComplete };

// ============================================================================
// Status Helpers
// ============================================================================

export interface GarageDoorStatus {
  readonly state: GarageDoorState;
  readonly position: number;
  readonly weather: WeatherStatus;
}

export const getWeatherStatus = (context: { weather: { status: "idle" | "loading" | "loaded" | "error"; temp?: number | undefined; desc?: string | undefined; icon?: string | undefined; error?: string | undefined } }): WeatherStatus => {
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
