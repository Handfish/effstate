import { Atom } from "@effect-atom/atom-react";
import { appRuntime } from "@/lib/app-runtime";
import {
  assign,
  assignOnDefect,
  assignOnFailure,
  assignOnSuccess,
  createMachine,
  createUseMachineHook,
  effect,
  interpret,
  type MachineSnapshot,
} from "@/lib/state-machine";
import {
  WeatherService,
  type Weather,
} from "@/lib/services/weather-service";
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
});

class Click extends Data.TaggedClass("CLICK")<{}> {}
class Tick extends Data.TaggedClass("TICK")<{ readonly delta: number }> {}
class AnimationComplete extends Data.TaggedClass("ANIMATION_COMPLETE")<{}> {}

type GarageDoorEvent = Click | Tick | AnimationComplete;

// Type alias for snapshot
type GarageDoorContext = typeof GarageDoorContextSchema.Type;
type GarageDoorSnapshot = MachineSnapshot<GarageDoorState, GarageDoorContext>;

// Initial snapshot defined at module level (doesn't depend on services)
const initialSnapshot: GarageDoorSnapshot = {
  value: "closed",
  context: {
    position: 0,
    lastUpdated: new Date(),
    weather: { status: "idle" },
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
// Garage Door Machine
// ============================================================================

// Default location (San Francisco)
const DEFAULT_LAT = 37.7749;
const DEFAULT_LON = -122.4194;

// Machine definition wrapped in Effect.gen - services are captured in closure
// R (WeatherService) is inferred automatically and checked at compile time!
const GarageDoorMachine = Effect.gen(function* () {
  const weatherService = yield* WeatherService;

  return createMachine<GarageDoorState, GarageDoorEvent, typeof GarageDoorContextSchema>({
    id: "garageDoor",
    initial: "closed",
    context: GarageDoorContextSchema,
    initialContext: {
      position: 0,
      lastUpdated: new Date(),
      weather: { status: "idle" },
    },
    states: {
      closed: {
        entry: [assign(() => ({ position: 0, lastUpdated: new Date(), weather: { status: "idle" } }))],
        on: {
          CLICK: { target: "opening" },
        },
      },

      opening: {
        entry: [effect(() => Effect.log("Entering: opening"))],
        activities: [animation(1)],
        on: {
          CLICK: { target: "paused-while-opening" },
          TICK: {
            actions: [
              assign<GarageDoorContext, Tick>(({ context, event }) => ({
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
        entry: [
          assign(() => ({ position: 100, lastUpdated: new Date(), weather: { status: "loading" } })),
          effect(() => Effect.log("Entering: open - fetching weather")),
        ],
        invoke: {
          id: "fetchWeather",
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
          CLICK: { target: "closing" },
        },
      },

      closing: {
        entry: [
          effect(() => Effect.log("Entering: closing")),
          assign(() => ({ weather: { status: "idle" } })),
        ],
        activities: [animation(-1)],
        on: {
          CLICK: { target: "paused-while-closing" },
          TICK: {
            actions: [
              assign<GarageDoorContext, Tick>(({ context, event }) => ({
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
});

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

const saveSnapshot = (snapshot: GarageDoorSnapshot): void => {
  try {
    const encoded = {
      value: snapshot.value,
      context: Schema.encodeSync(GarageDoorContextSchema)(snapshot.context),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(encoded));
  } catch {
    // Ignore storage errors
  }
};

// ============================================================================
// Atom Integration
// ============================================================================

// GarageDoorMachine is Effect<MachineDefinition> - flatMap with interpret to get actor
const actorAtom = appRuntime
  .atom(Effect.flatMap(GarageDoorMachine, interpret))
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
  initialSnapshot,
);

// ============================================================================
// React Hook
// ============================================================================

export interface GarageDoorStatus {
  readonly state: GarageDoorState;
  readonly position: number;
  readonly weather: WeatherStatus;
}

const getWeatherStatus = (context: GarageDoorContext): WeatherStatus => {
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
    status: {
      state: snapshot.value,
      position: context.position,
      weather: getWeatherStatus(context),
    },
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
