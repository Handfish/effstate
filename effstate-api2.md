
  // ============================================================================
  // garage-door.ts - Full Implementation with Rich State Types
  // ============================================================================

  import { Data, Duration, Effect, Match, Schema, Stream, Schedule } from "effect";
  import { Machine, goto, update, stay } from "effstate";

  // ============================================================================
  // Events
  // ============================================================================

  export class Click extends Data.TaggedClass("Click")<{}> {}
  export class Tick extends Data.TaggedClass("Tick")<{ readonly delta: number }> {}
  export class PowerOn extends Data.TaggedClass("PowerOn")<{}> {}
  export class PowerOff extends Data.TaggedClass("PowerOff")<{}> {}
  export class WeatherReceived extends Data.TaggedClass("WeatherReceived")<{
    readonly temp: number;
    readonly description: string;
    readonly icon: string;
  }> {}
  export class WeatherFailed extends Data.TaggedClass("WeatherFailed")<{
    readonly error: string;
  }> {}

  export type GarageDoorEvent =
    | Click
    | Tick
    | PowerOn
    | PowerOff
    | WeatherReceived
    | WeatherFailed;

  // ============================================================================
  // States as Discriminated Union (Rust-style enums with data)
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

  // Type helpers for external use
  export type StateTag = GarageDoorState["_tag"];

  // ============================================================================
  // Context Schema (shared data across all states)
  // ============================================================================

  const WeatherSchema = Schema.Union(
    Schema.Struct({ _tag: Schema.Literal("idle") }),
    Schema.Struct({ _tag: Schema.Literal("loading") }),
    Schema.Struct({
      _tag: Schema.Literal("loaded"),
      temp: Schema.Number,
      description: Schema.String,
      icon: Schema.String,
    }),
    Schema.Struct({
      _tag: Schema.Literal("error"),
      message: Schema.String,
    }),
  );

  export type Weather = typeof WeatherSchema.Type;

  export const ContextSchema = Schema.Struct({
    position: Schema.Number,
    isPowered: Schema.Boolean,
    weather: WeatherSchema,
  });

  export type Context = typeof ContextSchema.Type;

  // ============================================================================
  // Snapshot type (state + context)
  // ============================================================================

  export type GarageDoorSnapshot = {
    readonly state: GarageDoorState;
    readonly context: Context;
  };

  // ============================================================================
  // Animation Constants
  // ============================================================================

  const CYCLE_MS = 10_000;
  const TICK_MS = 16;
  const DELTA = 100 / (CYCLE_MS / TICK_MS);

  const tickStream = (direction: 1 | -1) =>
    Stream.fromSchedule(Schedule.spaced(Duration.millis(TICK_MS))).pipe(
      Stream.map(() => new Tick({ delta: direction * DELTA })),
    );

  // ============================================================================
  // Weather Service
  // ============================================================================

  class WeatherNetworkError extends Data.TaggedError("WeatherNetworkError")<{
    readonly message: string;
  }> {}

  class WeatherParseError extends Data.TaggedError("WeatherParseError")<{
    readonly message: string;
  }> {}

  type WeatherError = WeatherNetworkError | WeatherParseError;

  export class WeatherService extends Effect.Service<WeatherService>()("WeatherService", {
    effect: Effect.succeed({
      fetch: (lat: number, lon: number): Effect.Effect<WeatherReceived, WeatherError> =>
        Effect.tryPromise({
          try: async () => {
            const res = await fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return new WeatherReceived({
              temp: data.current_weather.temperature,
              description: "Clear", // Simplified
              icon: "☀️ ",
            });
          },
          catch: (e) => new WeatherNetworkError({ message: String(e) }),
        }),
    }),
  }) {}

  // ============================================================================
  // Machine Definition
  // ============================================================================

  const DEFAULT_LAT = 37.7749;
  const DEFAULT_LON = -122.4194;

  export const GarageDoorMachine = Machine.define({
    id: "garageDoor",
    context: ContextSchema,
    initialContext: {
      position: 0,
      isPowered: false,
      weather: { _tag: "idle" },
    },
    initialState: GarageDoorState.Closed({}),

    // Global handlers - apply to all states
    global: (ctx, event) =>
      Match.value(event).pipe(
        Match.tag("PowerOn", () => update({ isPowered: true })),
        Match.tag("PowerOff", () => update({ isPowered: false })),
        Match.orElse(() => null), // null = pass to state handler
      ),

    states: {
      // ========================================================================
      // Closed
      // ========================================================================
      Closed: {
        entry: Effect.log("Door is closed"),

        on: (ctx, _state) => (event) =>
          Match.value(event).pipe(
            Match.tag("Click", () =>
              ctx.isPowered
                ? goto(GarageDoorState.Opening({ startedAt: new Date() }))
                : stay
            ),
            Match.tag("Tick", () => stay),
            Match.tag("WeatherReceived", () => stay),
            Match.tag("WeatherFailed", () => stay),
            Match.exhaustive,
          ),
      },

      // ========================================================================
      // Opening
      // ========================================================================
      Opening: {
        entry: (state) =>
          Effect.log(`Opening started at ${state.startedAt.toISOString()}`),

        run: tickStream(1),

        on: (ctx, state) => (event) =>
          Match.value(event).pipe(
            Match.tag("Click", () =>
              goto(
                GarageDoorState.PausedWhileOpening({
                  pausedAt: new Date(),
                  pausedPosition: ctx.position,
                })
              )
            ),
            Match.tag("Tick", ({ delta }) => {
              const newPosition = ctx.position + delta;
              const elapsed = Date.now() - state.startedAt.getTime();

              return newPosition >= 100
                ? goto(GarageDoorState.Open({ openedAt: new Date() }))
                    .update({ position: 100 })
                    .effect(Effect.log(`Opened in ${elapsed}ms`))
                : update({ position: newPosition });
            }),
            Match.tag("WeatherReceived", () => stay),
            Match.tag("WeatherFailed", () => stay),
            Match.exhaustive,
          ),
      },

      // ========================================================================
      // PausedWhileOpening
      // ========================================================================
      PausedWhileOpening: {
        entry: (state) =>
          Effect.log(`Paused at position ${state.pausedPosition.toFixed(1)}%`),

        on: (ctx, state) => (event) =>
          Match.value(event).pipe(
            Match.tag("Click", () => {
              const pauseDuration = Date.now() - state.pausedAt.getTime();
              return goto(GarageDoorState.Closing({ startedAt: new Date() }))
                .effect(Effect.log(`Was paused for ${pauseDuration}ms`));
            }),
            Match.tag("Tick", () => stay),
            Match.tag("WeatherReceived", () => stay),
            Match.tag("WeatherFailed", () => stay),
            Match.exhaustive,
          ),
      },

      // ========================================================================
      // Open
      // ========================================================================
      Open: {
        entry: (state) =>
          Effect.all([
            Effect.log(`Door opened at ${state.openedAt.toISOString()}`),
            Effect.succeed(update({ weather: { _tag: "loading" } })),
          ]),

        run: Effect.gen(function* () {
          const weatherService = yield* WeatherService;
          return yield* weatherService.fetch(DEFAULT_LAT, DEFAULT_LON).pipe(
            Effect.matchEffect({
              onSuccess: (weather) =>
                Effect.succeed(
                  update({
                    weather: {
                      _tag: "loaded",
                      temp: weather.temp,
                      description: weather.description,
                      icon: weather.icon,
                    },
                  })
                ),
              onFailure: (error) =>
                Match.value(error).pipe(
                  Match.tag("WeatherNetworkError", ({ message }) =>
                    Effect.succeed(
                      update({ weather: { _tag: "error", message: `Network: ${message}` } })
                    )
                  ),
                  Match.tag("WeatherParseError", ({ message }) =>
                    Effect.succeed(
                      update({ weather: { _tag: "error", message: `Parse: ${message}` } })
                    )
                  ),
                  Match.exhaustive,
                ),
            }),
          );
        }),

        on: (ctx, state) => (event) =>
          Match.value(event).pipe(
            Match.tag("Click", () => {
              const openDuration = Date.now() - state.openedAt.getTime();
              return goto(GarageDoorState.Closing({ startedAt: new Date() }))
                .update({ weather: { _tag: "idle" } })
                .effect(Effect.log(`Door was open for ${openDuration}ms`));
            }),
            Match.tag("Tick", () => stay),
            Match.tag("WeatherReceived", ({ temp, description, icon }) =>
              update({ weather: { _tag: "loaded", temp, description, icon } })
            ),
            Match.tag("WeatherFailed", ({ error }) =>
              update({ weather: { _tag: "error", message: error } })
            ),
            Match.exhaustive,
          ),
      },

      // ========================================================================
      // Closing
      // ========================================================================
      Closing: {
        entry: (state) =>
          Effect.log(`Closing started at ${state.startedAt.toISOString()}`),

        run: tickStream(-1),

        on: (ctx, state) => (event) =>
          Match.value(event).pipe(
            Match.tag("Click", () =>
              goto(
                GarageDoorState.PausedWhileClosing({
                  pausedAt: new Date(),
                  pausedPosition: ctx.position,
                })
              )
            ),
            Match.tag("Tick", ({ delta }) => {
              const newPosition = ctx.position + delta;
              const elapsed = Date.now() - state.startedAt.getTime();

              return newPosition <= 0
                ? goto(GarageDoorState.Closed({}))
                    .update({ position: 0 })
                    .effect(Effect.log(`Closed in ${elapsed}ms`))
                : update({ position: newPosition });
            }),
            Match.tag("WeatherReceived", () => stay),
            Match.tag("WeatherFailed", () => stay),
            Match.exhaustive,
          ),
      },

      // ========================================================================
      // PausedWhileClosing
      // ========================================================================
      PausedWhileClosing: {
        entry: (state) =>
          Effect.log(`Paused while closing at ${state.pausedPosition.toFixed(1)}%`),

        on: (ctx, state) => (event) =>
          Match.value(event).pipe(
            Match.tag("Click", () => {
              const pauseDuration = Date.now() - state.pausedAt.getTime();
              return goto(GarageDoorState.Opening({ startedAt: new Date() }))
                .effect(Effect.log(`Was paused for ${pauseDuration}ms`));
            }),
            Match.tag("Tick", () => stay),
            Match.tag("WeatherReceived", () => stay),
            Match.tag("WeatherFailed", () => stay),
            Match.exhaustive,
          ),
      },
    },
  });

  // ============================================================================
  // Service wrapper for DI
  // ============================================================================

  export class GarageDoorMachineService extends Effect.Service<GarageDoorMachineService>()(
    "GarageDoorMachineService",
    {
      effect: Effect.gen(function* () {
        return {
          machine: GarageDoorMachine,
          interpret: () => GarageDoorMachine.interpret(),
        };
      }),
      dependencies: [WeatherService.Default],
    }
  ) {}

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

  export const getStateData = (state: GarageDoorState) =>
    Match.value(state).pipe(
      Match.tag("Opening", ({ startedAt }) => ({ startedAt })),
      Match.tag("Closing", ({ startedAt }) => ({ startedAt })),
      Match.tag("Open", ({ openedAt }) => ({ openedAt })),
      Match.tag("PausedWhileOpening", ({ pausedAt, pausedPosition }) => ({
        pausedAt,
        pausedPosition,
      })),
      Match.tag("PausedWhileClosing", ({ pausedAt, pausedPosition }) => ({
        pausedAt,
        pausedPosition,
      })),
      Match.orElse(() => null),
    );

  // ============================================================================
  // garage-door.tsx - React Component
  // ============================================================================

  import { useCallback, useMemo } from "react";
  import { Match } from "effect";
  import { useActor } from "effstate/react";
  import {
    GarageDoorMachineService,
    GarageDoorState,
    Click,
    PowerOn,
    PowerOff,
    getStateLabel,
    getButtonLabel,
    isAnimating,
    type GarageDoorSnapshot,
    type Weather,
  } from "./garage-door";

  // ============================================================================
  // Hooks
  // ============================================================================

  export function useGarageDoor() {
    const { snapshot, send } = useActor(GarageDoorMachineService);

    const handleClick = useCallback(() => send(new Click()), [send]);
    const handlePowerOn = useCallback(() => send(new PowerOn()), [send]);
    const handlePowerOff = useCallback(() => send(new PowerOff()), [send]);

    const stateInfo = useMemo(() => {
      const { state, context } = snapshot;
      return {
        tag: state._tag,
        label: getStateLabel(state),
        buttonLabel: getButtonLabel(state),
        isAnimating: isAnimating(state),
        position: context.position,
        isPowered: context.isPowered,
        weather: context.weather,
        // Rich state data (only available for certain states)
        stateData: Match.value(state).pipe(
          Match.tag("Opening", ({ startedAt }) => ({
            type: "opening" as const,
            startedAt,
            elapsed: Date.now() - startedAt.getTime(),
          })),
          Match.tag("Closing", ({ startedAt }) => ({
            type: "closing" as const,
            startedAt,
            elapsed: Date.now() - startedAt.getTime(),
          })),
          Match.tag("Open", ({ openedAt }) => ({
            type: "open" as const,
            openedAt,
            duration: Date.now() - openedAt.getTime(),
          })),
          Match.tag("PausedWhileOpening", ({ pausedAt, pausedPosition }) => ({
            type: "paused" as const,
            pausedAt,
            pausedPosition,
            direction: "opening" as const,
          })),
          Match.tag("PausedWhileClosing", ({ pausedAt, pausedPosition }) => ({
            type: "paused" as const,
            pausedAt,
            pausedPosition,
            direction: "closing" as const,
          })),
          Match.orElse(() => null),
        ),
      };
    }, [snapshot]);

    return {
      ...stateInfo,
      send,
      handleClick,
      handlePowerOn,
      handlePowerOff,
    };
  }

  // ============================================================================
  // Components
  // ============================================================================

  export function GarageDoor() {
    const {
      tag,
      label,
      buttonLabel,
      isAnimating,
      position,
      isPowered,
      weather,
      stateData,
      handleClick,
      handlePowerOn,
      handlePowerOff,
    } = useGarageDoor();

    return (
      <div className="garage-door-container">
        {/* Power Switch */}
        <PowerSwitch isPowered={isPowered} onToggle={isPowered ? handlePowerOff : handlePowerOn} />

        {/* Door Visualization */}
        <DoorVisualization position={position} isAnimating={isAnimating} />

        {/* Status Display */}
        <StatusDisplay
          label={label}
          position={position}
          stateData={stateData}
        />

        {/* Weather (only shown when open) */}
        {tag === "Open" && <WeatherDisplay weather={weather} />}

        {/* Control Button */}
        <button
          onClick={handleClick}
          disabled={!isPowered}
          className={`control-button ${!isPowered ? "disabled" : ""}`}
        >
          {buttonLabel}
        </button>

        {/* Debug: State Data */}
        {stateData && <StateDataDebug data={stateData} />}
      </div>
    );
  }

  // ============================================================================
  // Sub-components
  // ============================================================================

  function PowerSwitch({
    isPowered,
    onToggle,
  }: {
    isPowered: boolean;
    onToggle: () => void;
  }) {
    return (
      <div className="power-switch">
        <label>
          <input type="checkbox" checked={isPowered} onChange={onToggle} />
          Power {isPowered ? "ON" : "OFF"}
        </label>
      </div>
    );
  }

  function DoorVisualization({
    position,
    isAnimating,
  }: {
    position: number;
    isAnimating: boolean;
  }) {
    return (
      <div className="door-frame">
        <div
          className={`door-panel ${isAnimating ? "animating" : ""}`}
          style={{
            transform: `translateY(-${position}%)`,
          }}
        />
        <div className="door-opening" />
      </div>
    );
  }

  function StatusDisplay({
    label,
    position,
    stateData,
  }: {
    label: string;
    position: number;
    stateData: ReturnType<typeof useGarageDoor>["stateData"];
  }) {
    return (
      <div className="status-display">
        <div className="status-label">{label}</div>
        <div className="status-position">{position.toFixed(1)}%</div>

        {/* Show elapsed time for animating states */}
        {stateData?.type === "opening" || stateData?.type === "closing" ? (
          <div className="status-elapsed">
            Elapsed: {(stateData.elapsed / 1000).toFixed(1)}s
          </div>
        ) : null}

        {/* Show pause info for paused states */}
        {stateData?.type === "paused" ? (
          <div className="status-paused">
            Paused at {stateData.pausedPosition.toFixed(1)}% (was {stateData.direction})
          </div>
        ) : null}

        {/* Show open duration */}
        {stateData?.type === "open" ? (
          <div className="status-open-duration">
            Open for {(stateData.duration / 1000).toFixed(0)}s
          </div>
        ) : null}
      </div>
    );
  }

  function WeatherDisplay({ weather }: { weather: Weather }) {
    return (
      <div className="weather-display">
        {Match.value(weather).pipe(
          Match.when({ _tag: "idle" }, () => null),
          Match.when({ _tag: "loading" }, () => (
            <div className="weather-loading">Loading weather...</div>
          )),
          Match.when({ _tag: "loaded" }, ({ temp, description, icon }) => (
            <div className="weather-loaded">
              <span className="weather-icon">{icon}</span>
              <span className="weather-temp">{temp}°C</span>
              <span className="weather-desc">{description}</span>
            </div>
          )),
          Match.when({ _tag: "error" }, ({ message }) => (
            <div className="weather-error">Weather unavailable: {message}</div>
          )),
          Match.exhaustive,
        )}
      </div>
    );
  }

  function StateDataDebug({
    data,
  }: {
    data: NonNullable<ReturnType<typeof useGarageDoor>["stateData"]>;
  }) {
    return (
      <details className="state-debug">
        <summary>State Data (Debug)</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    );
  }

  // ============================================================================
  // app-runtime.ts - Effect Runtime Setup
  // ============================================================================

  import { Layer, Logger } from "effect";
  import { Atom } from "@effect-atom/atom-react";
  import { WeatherService, GarageDoorMachineService } from "./garage-door";

  const AppLayer = Layer.mergeAll(
    Logger.pretty,
    WeatherService.Default,
    GarageDoorMachineService.Default,
  );

  export const appRuntime = Atom.runtime(AppLayer);

  // ============================================================================
  // index.tsx - App Entry Point
  // ============================================================================

  import { StrictMode } from "react";
  import { createRoot } from "react-dom/client";
  import { AtomProvider } from "@effect-atom/atom-react";
  import { appRuntime } from "./app-runtime";
  import { GarageDoor } from "./garage-door";

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AtomProvider runtime={appRuntime}>
        <div className="app">
          <h1>Garage Door</h1>
          <GarageDoor />
        </div>
      </AtomProvider>
    </StrictMode>
  );

  ---
  Key Benefits of This Approach

  1. States Carry Meaningful Data

  // Instead of stuffing everything into context:
  context: {
    position: number,
    openedAt: Date | null,  // Only valid when open
    pausedAt: Date | null,  // Only valid when paused
    pausedPosition: number | null,  // Only valid when paused
  }

  // States carry their own data:
  GarageDoorState.Open({ openedAt: new Date() })
  GarageDoorState.PausedWhileOpening({ pausedAt: new Date(), pausedPosition: 45.5 })

  2. Type-Safe State Data Access

  // TypeScript KNOWS what data is available in each state
  Match.value(state).pipe(
    Match.tag("Open", ({ openedAt }) => {
      // openedAt is definitely a Date here
      const duration = Date.now() - openedAt.getTime();
    }),
    Match.tag("Closed", () => {
      // No openedAt here - it doesn't exist in Closed state
    }),
  )

  3. Exhaustive Matching Everywhere

  // Add a new state? TypeScript errors until you handle it everywhere:
  // - In event handlers (Match.exhaustive)
  // - In UI helpers (getStateLabel, getButtonLabel)
  // - In components (WeatherDisplay)

  4. Rich Debugging/Analytics

  // Can now track:
  // - How long the door was open
  // - How long each animation took
  // - Where it was paused
  // - All without polluting context

  5. Cleaner Context

  // Context is now just shared data that persists across states:
  context: {
    position: number,      // Current position
    isPowered: boolean,    // Power state
    weather: Weather,      // Weather data
  }

  // No more nullable fields for state-specific data!

  ---
  Does this give you a good picture of how the full implementation would look? Want me to explore any part in more detail?

