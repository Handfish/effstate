/**
 * EffState v3 API Design - Pure TypeScript (no Effect dependency)
 *
 * This demonstrates the API shape, not a working implementation.
 * Focus: Maximum type safety with minimum ceremony.
 */

// ============================================================================
// CORE: Discriminated Unions (same as v2, this is the good part)
// ============================================================================

type HamsterState =
  | { _tag: "Idle" }
  | { _tag: "Running"; startedAt: Date }
  | { _tag: "Stopping"; stoppingAt: Date };

const HamsterState = {
  Idle: (): HamsterState => ({ _tag: "Idle" }),
  Running: (data: { startedAt: Date }): HamsterState => ({ _tag: "Running", ...data }),
  Stopping: (data: { stoppingAt: Date }): HamsterState => ({ _tag: "Stopping", ...data }),
};

// ============================================================================
// CONTEXT & EVENTS
// ============================================================================

interface HamsterContext {
  wheelRotation: number;
  electricityLevel: number;
}

type HamsterEvent =
  | { _tag: "Toggle" }
  | { _tag: "Tick"; delta: number }
  | { _tag: "StopComplete" };

// ============================================================================
// TRANSITION BUILDERS (simplified)
// ============================================================================

type Transition<S, C> =
  | { type: "goto"; state: S; updates?: Partial<C> }
  | { type: "update"; updates: Partial<C> }
  | { type: "stay" }
  | null; // null = stay (shorthand)

// goto can transition to ANY state in the machine (not just current)
const goto = <S, C>(state: S, updates?: Partial<C>): Transition<S, C> =>
  ({ type: "goto", state, updates });

const update = <S, C>(updates: Partial<C>): Transition<S, C> =>
  ({ type: "update", updates });

// ============================================================================
// HANDLER TYPE (key insight: S is the FULL state union, not current state)
// ============================================================================

/**
 * Handler receives current state, can transition to ANY state in union S
 */
type EventHandler<S, C, E> = (ctx: C, event: E) => Transition<S, C> | null;

/**
 * Maps event tags to handlers. TypeScript ensures ALL tags are handled.
 */
type Handlers<S, C, E extends { _tag: string }> = {
  [K in E["_tag"]]: EventHandler<S, C, Extract<E, { _tag: K }>>;
};

/**
 * Partial handlers - unhandled = stay. Still type-checked!
 */
type PartialHandlers<S, C, E extends { _tag: string }> = Partial<Handlers<S, C, E>>;

// ============================================================================
// V3 MACHINE DEFINITION
// ============================================================================

interface StateConfig<S, C, E extends { _tag: string }> {
  on: PartialHandlers<S, C, E>;
}

type MachineStates<S extends { _tag: string }, C, E extends { _tag: string }> = {
  [K in S["_tag"]]: StateConfig<S, C, E>;
};

interface MachineConfig<S extends { _tag: string }, C, E extends { _tag: string }> {
  id: string;
  initial: S;
  context: C;
  global?: PartialHandlers<S, C, E>;
  states: MachineStates<S, C, E>;
}

function defineMachine<S extends { _tag: string }, C, E extends { _tag: string }>(
  config: MachineConfig<S, C, E>
) {
  return config;
}

// ============================================================================
// V3 HAMSTER MACHINE (THE PAYOFF - look how clean!)
// ============================================================================

const hamsterMachine = defineMachine<HamsterState, HamsterContext, HamsterEvent>({
  id: "hamster",
  initial: HamsterState.Idle(),
  context: { wheelRotation: 0, electricityLevel: 0 },

  states: {
    Idle: {
      on: {
        Toggle: () => goto(
          HamsterState.Running({ startedAt: new Date() }),
          { electricityLevel: 100 }
        ),
        // Tick, StopComplete: not listed = stay
      },
    },

    Running: {
      on: {
        Toggle: () => goto(HamsterState.Stopping({ stoppingAt: new Date() })),
        Tick: (ctx) => update<HamsterState, HamsterContext>({ wheelRotation: (ctx.wheelRotation + 5) % 360 }),
        // StopComplete: implicit stay
      },
    },

    Stopping: {
      on: {
        Toggle: () => goto(
          HamsterState.Running({ startedAt: new Date() }),
          { electricityLevel: 100 }
        ),
        StopComplete: () => goto(HamsterState.Idle(), { electricityLevel: 0 }),
        // Tick: implicit stay
      },
    },
  },
});

// ============================================================================
// COMPARISON: V2 vs V3 for SAME state
// ============================================================================

/*
V2 Running state handler:
─────────────────────────
on: (ctx, _state, { goto, update, stay }) => (event) =>
  Match.value(event).pipe(
    Match.tag("Toggle", () =>
      goto(HamsterWheelState.Stopping({ stoppingAt: new Date() }))
    ),
    Match.tag("Tick", ({ delta }) =>
      update({ wheelRotation: (ctx.wheelRotation + delta) % 360 })
    ),
    Match.tag("StopComplete", () => stay),
    Match.tag("WakeHamster", () => stay),
    Match.orElse(() => stay),
  )

Lines: 12
────────────────────────────────────────────────────────────────

V3 Running state handler:
─────────────────────────
on: {
  Toggle: () => goto(HamsterState.Stopping({ stoppingAt: new Date() })),
  Tick: (ctx) => update({ wheelRotation: (ctx.wheelRotation + 5) % 360 }),
}

Lines: 4
────────────────────────────────────────────────────────────────

Reduction: 67%
*/

// ============================================================================
// TYPE SAFETY PRESERVED
// ============================================================================

// Correct - type-safe state construction
const goodTransition = goto(HamsterState.Running({ startedAt: new Date() }));
console.log(goodTransition); // use it

// Would error if uncommented:
// const _bad1 = HamsterState.Running({ wrongField: 123 }); // wrong field
// const _bad2 = HamsterState.Running({}); // missing field

// ============================================================================
// TOTAL LOC ESTIMATE
// ============================================================================

/*
Component                    v2 LOC    v3 LOC    Reduction
─────────────────────────────────────────────────────────
Hamster machine def          ~200      ~60       -70%
Garage door machine def      ~250      ~80       -68%
Services (weather, etc)      ~450      ~450      0%
Components (UI)              ~500      ~500      0%
─────────────────────────────────────────────────────────
TOTAL                        ~1,400    ~1,090    -22%

Note: Services stay the same because they're Effect-based,
not machine-related. The savings are in machine definitions.

If we also simplify the service layer:
─────────────────────────────────────────────────────────
TOTAL                        ~2,148    ~1,400    -35%
*/

export { hamsterMachine };
