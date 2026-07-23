
  ---
  Pain Points in Current APIs

  1. The { context, event } Object Everywhere

  // Current - destructure the same object 100 times
  assign(({ context, event }) => ({ count: context.count + event.delta }))
  guard: ({ context, event }) => context.isPowered && event.amount > 0
  effect(({ context, event }) => Effect.log(context.name))

  This is Redux/XState legacy. Why wrap two things in an object just to destructure them?

  2. Verbose Transition Objects

  // Current
  on: {
    CLICK: {
      target: "opening",
      guard: ({ context }) => context.isPowered,
      actions: [assign(...), effect(...)]
    },
  }

  Three levels of nesting for "if powered, go to opening and do stuff."

  3. invoke vs activities - Two Concepts for One Thing

  // Current - why two different APIs?
  invoke: invoke({
    src: () => fetchWeather(),
    onSuccess: { ... },
    catchTags: { ... },
  })

  activities: [{
    id: "animation",
    src: ({ send }) => Stream.fromSchedule(...).pipe(...),
  }]

  In Effect, these are both just Effects - one completes, one streams. Why force users to learn two patterns?

  4. Repeated Handlers Across States

  // Current - POWER_ON/POWER_OFF in EVERY state
  states: {
    closed: {
      on: {
        CLICK: ...,
        POWER_ON: { actions: [assign(() => ({ isPowered: true }))] },
        POWER_OFF: { actions: [assign(() => ({ isPowered: false }))] },
      }
    },
    opening: {
      on: {
        TICK: ...,
        POWER_ON: { actions: [assign(() => ({ isPowered: true }))] },  // repeated!
        POWER_OFF: { actions: [assign(() => ({ isPowered: false }))] }, // repeated!
      }
    },
    // ... 4 more states with same handlers
  }

  5. actions as Arrays

  // Current
  actions: [assign(...), effect(...), raise(...)]

  Why arrays? Effect has Effect.all, pipe, composition. This is XState's action queue model leaking through.

  6. Entry/Exit as Separate Concepts

  // Current
  entry: [effect(() => Effect.log("entering"))],
  exit: [effect(() => Effect.log("exiting"))],

  Effect has Effect.acquireRelease and Scope for this. Entry/exit are just acquire/release.

  7. The invoke() Wrapper

  // Current - extra wrapper function for type inference
  invoke: invoke({
    src: () => fetchWeather(),
    assignResult: { success: ... }
  })

  Why can't I just write the Effect directly?

  ---
  Dream API: First Principles

  Core Insight: States Are Effects with Different Lifetimes
  ┌──────────────┬───────────────────────┬───────────────────┐
  │   Concept    │   Effect Equivalent   │     Lifetime      │
  ├──────────────┼───────────────────────┼───────────────────┤
  │ Entry action │ Effect<void>          │ Once on enter     │
  ├──────────────┼───────────────────────┼───────────────────┤
  │ Exit action  │ Finalizer in Scope    │ Once on exit      │
  ├──────────────┼───────────────────────┼───────────────────┤
  │ Invoke       │ Effect<A, E, R>       │ Until completes   │
  ├──────────────┼───────────────────────┼───────────────────┤
  │ Activity     │ Stream<A>             │ Until state exits │
  ├──────────────┼───────────────────────┼───────────────────┤
  │ Guard        │ (ctx, evt) => boolean │ Sync check        │
  ├──────────────┼───────────────────────┼───────────────────┤
  │ Transition   │ State change          │ Immediate         │
  └──────────────┴───────────────────────┴───────────────────┘
  Dream API v1: Clean Syntax

  import { Machine } from "effstate";

  const GarageDoor = Machine.make({
    id: "garageDoor",
    context: GarageDoorContextSchema,
    initial: "closed",

    // Global handlers - apply to ALL states (no more repetition!)
    on: {
      PowerOn: () => ({ isPowered: true }),
      PowerOff: () => ({ isPowered: false }),
      BangHammer: () => Machine.sendParent(new WakeHamster()),
    },

    states: {
      closed: {
        entry: Effect.log("Door is closed"),

        on: {
          // Clean: event handler is just a function
          // Return string = goto, return object = update, return null = ignore
          Click: (ctx) => ctx.isPowered ? "opening" : null,
        },
      },

      opening: {
        // Unified "run" - library detects Effect vs Stream
        run: Stream.tick("16 millis").pipe(
          Stream.map(() => new Tick({ delta: DELTA })),
        ),

        on: {
          Click: () => "paused-while-opening",

          // Context and event as separate args (no destructuring!)
          Tick: (ctx, evt) =>
            ctx.position + evt.delta >= 100
              ? "open"
              : { position: ctx.position + evt.delta },
        },
      },

      open: {
        entry: Effect.log("Door is open, fetching weather"),

        // One-shot Effect - library handles success/failure
        run: WeatherService.pipe(
          Effect.flatMap((svc) => svc.getWeather(LAT, LON)),
          Effect.map((weather) => ({ weather: { status: "loaded", ...weather } })),
          Effect.catchTags({
            WeatherNetworkError: () => ({ weather: { status: "error", error: "Network" } }),
            WeatherParseError: () => ({ weather: { status: "error", error: "Parse" } }),
          }),
        ),

        on: {
          Click: () => "closing",
        },
      },

      closing: {
        run: Stream.tick("16 millis").pipe(
          Stream.map(() => new Tick({ delta: -DELTA })),
        ),

        on: {
          Click: () => "paused-while-closing",
          Tick: (ctx, evt) =>
            ctx.position + evt.delta <= 0
              ? "closed"
              : { position: ctx.position + evt.delta },
        },
      },

      "paused-while-opening": {
        on: { Click: () => "closing" },
      },

      "paused-while-closing": {
        on: { Click: () => "opening" },
      },
    },
  });

  What changed:
  - (ctx, evt) instead of ({ context, event })
  - Return "state" for goto, { ...updates } for assign, null for ignore
  - Unified run instead of invoke + activities
  - Global on handlers eliminate repetition
  - No actions: [...] arrays - just return what you want

  ---
  Dream API v2: Even Cleaner with Match

  import { Machine, Match } from "effstate";

  const GarageDoor = Machine.make({
    context: ContextSchema,
    initial: "closed",

    // Global handlers
    always: (ctx, evt) => Match.tag(evt, {
      PowerOn: () => ({ isPowered: true }),
      PowerOff: () => ({ isPowered: false }),
    }),

    states: {
      closed: (ctx) => ({
        on: {
          Click: () => ctx.isPowered && "opening",
        },
      }),

      opening: (ctx) => ({
        // Stream auto-detected, sends events to self
        run: tickStream(DELTA),

        on: {
          Click: () => "paused-while-opening",
          Tick: (_, evt) =>
            ctx.position + evt.delta >= 100
              ? "open"
              : { position: ctx.position + evt.delta },
        },
      }),

      open: (ctx) => ({
        // Effect auto-detected, result merged into context
        run: fetchWeather().pipe(
          Effect.mapBoth({
            onSuccess: (w) => ({ weather: loaded(w) }),
            onFailure: (e) => ({ weather: error(e) }),
          }),
        ),

        on: {
          Click: () => "closing",
        },
      }),

      // ...
    },
  });

  Key innovation: States as functions that receive context, return config. This means guards are just... code:

  // Instead of
  on: { Click: { target: "opening", guard: ({ context }) => context.isPowered } }

  // Just
  on: { Click: () => ctx.isPowered && "opening" }

  ---
  Dream API v3: Full Effect Integration

  What if transitions themselves were Effects?

  const GarageDoor = Machine.make({
    context: ContextSchema,
    initial: "closed",

    states: {
      closed: Machine.state({
        on: {
          Click: (ctx) => ctx.isPowered
            ? Machine.goto("opening")
            : Machine.stay(),
        },
      }),

      opening: Machine.state({
        // Run returns Effect that yields context updates or state changes
        run: Effect.gen(function* () {
          const fiber = yield* Stream.tick("16 millis").pipe(
            Stream.runForEach(() => Machine.update((ctx) => ({
              position: ctx.position + DELTA
            }))),
            Effect.fork,
          );

          // Wait for completion condition
          yield* Machine.waitFor((ctx) => ctx.position >= 100);
          yield* Fiber.interrupt(fiber);

          return Machine.goto("open");
        }),

        on: {
          Click: () => Machine.goto("paused-while-opening"),
        },
      }),

      open: Machine.state({
        run: Effect.gen(function* () {
          const weather = yield* WeatherService;
          const result = yield* weather.getWeather(LAT, LON).pipe(
            Effect.either,
          );

          return Either.match(result, {
            onLeft: (e) => Machine.update({ weather: error(e) }),
            onRight: (w) => Machine.update({ weather: loaded(w) }),
          });
        }),

        on: {
          Click: () => Machine.goto("closing"),
        },
      }),
    },
  });

  This is powerful but might be too flexible. The declarative config is valuable for visualization, debugging, etc.

  ---
  Dream API v4: The Sweet Spot

  After thinking through these options, here's what I think hits the sweet spot:

  import { Machine } from "effstate";

  const GarageDoor = Machine.define({
    context: ContextSchema,
    initial: "closed",

    // Handlers that apply to all states
    global: {
      PowerOn: () => update({ isPowered: true }),
      PowerOff: () => update({ isPowered: false }),
    },

    states: {
      closed: {
        entry: Effect.log("Closed"),

        Click: (ctx) => ctx.isPowered ? goto("opening") : stay,
      },

      opening: {
        // Unified: Effect completes once, Stream runs continuously
        while: tickStream(DELTA),

        Click: () => goto("paused-while-opening"),
        Tick: (ctx, { delta }) =>
          ctx.position + delta >= 100
            ? goto("open")
            : update({ position: ctx.position + delta }),
      },

      open: {
        // Effect that yields context updates
        while: fetchWeather().pipe(
          Effect.match({
            onSuccess: (w) => update({ weather: loaded(w) }),
            onFailure: (e) => update({ weather: error(e) }),
          }),
        ),

        Click: () => goto("closing"),
      },

      closing: {
        while: tickStream(-DELTA),

        Click: () => goto("paused-while-closing"),
        Tick: (ctx, { delta }) =>
          ctx.position + delta <= 0
            ? goto("closed")
            : update({ position: ctx.position + delta }),
      },

      "paused-while-opening": {
        Click: () => goto("closing"),
      },

      "paused-while-closing": {
        Click: () => goto("opening"),
      },
    },
  });

  // Type-safe, clean interpretation
  const actor = yield* GarageDoor.interpret();
  actor.send(new Click());

  ---
  Summary: What Makes This Better
  ┌──────────────────────────────────────────────────┬──────────────────────────────┬──────────────────┐
  │                     Current                      │            Dream             │   Improvement    │
  ├──────────────────────────────────────────────────┼──────────────────────────────┼──────────────────┤
  │ ({ context, event })                             │ (ctx, evt)                   │ Less boilerplate │
  ├──────────────────────────────────────────────────┼──────────────────────────────┼──────────────────┤
  │ on: { X: { target, guard, actions } }            │ X: (ctx) => goto/update/stay │ Flat, readable   │
  ├──────────────────────────────────────────────────┼──────────────────────────────┼──────────────────┤
  │ invoke + activities                              │ while: (auto-detects)        │ One concept      │
  ├──────────────────────────────────────────────────┼──────────────────────────────┼──────────────────┤
  │ actions: [...]                                   │ Return value                 │ No arrays        │
  ├──────────────────────────────────────────────────┼──────────────────────────────┼──────────────────┤
  │ Repeated handlers                                │ global:                      │ DRY              │
  ├──────────────────────────────────────────────────┼──────────────────────────────┼──────────────────┤
  │ invoke({ assignResult: { success, catchTags } }) │ Effect.match                 │ Effect-native    │
  ├──────────────────────────────────────────────────┼──────────────────────────────┼──────────────────┤
  │ entry: + exit: separate                          │ entry: with finalizer        │ Effect idiom     │
  └──────────────────────────────────────────────────┴──────────────────────────────┴──────────────────┘
  The philosophy:
  - Return what you want - goto("state"), update({ ... }), or stay
  - One concept for async - while: handles both one-shot and continuous
  - Global handlers - write once, apply everywhere
  - Context and event as args - no more destructuring objects
  - Effect-native error handling - use Effect.match, Effect.catchTags

  What aspects of this resonate? Should I explore any direction further?

 
