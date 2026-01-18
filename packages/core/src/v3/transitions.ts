/**
 * Transition Graph Utilities
 *
 * Extract and analyze the transition graph from a machine definition.
 * Useful for:
 * - Server-side transition validation
 * - Visualization
 * - Documentation generation
 */

import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineConfig,
  MachineDefinition,
} from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Map from state tag to list of possible target state tags.
 * Uses string keys and values for simpler runtime usage.
 */
export type TransitionGraph = Readonly<Record<string, readonly string[]>>;

/**
 * Detailed transition information including which event triggers it.
 */
export interface TransitionEdge {
  readonly from: string;
  readonly to: string;
  readonly event: string;
}

/**
 * Full transition analysis result
 */
export interface TransitionAnalysis {
  /** Simple graph: state -> possible next states */
  readonly graph: TransitionGraph;
  /** Detailed edges with event information */
  readonly edges: readonly TransitionEdge[];
  /** States with no outgoing transitions (terminal states) */
  readonly terminalStates: readonly string[];
  /** States reachable from initial state */
  readonly reachableStates: readonly string[];
  /** Check if a transition is valid */
  isValidTransition(from: string, to: string): boolean;
  /** Get events that can trigger a transition from a state */
  getEventsForState(state: string): readonly string[];
  /** Get possible next states from a given state */
  getNextStates(state: string): readonly string[];
}

// ============================================================================
// Internal helpers
// ============================================================================

interface TransitionResult {
  goto?: { _tag: string };
}

function isTransitionResult(value: unknown): value is TransitionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "goto" in value &&
    typeof (value as TransitionResult).goto === "object" &&
    (value as TransitionResult).goto !== null &&
    "_tag" in ((value as TransitionResult).goto as object)
  );
}

function tryCallHandler(
  handler: unknown,
  context: unknown,
  eventTag: string
): string | null {
  if (typeof handler !== "function") return null;

  try {
    const result = (handler as (ctx: unknown, event: { _tag: string }) => unknown)(
      context,
      { _tag: eventTag }
    );
    if (isTransitionResult(result) && result.goto) {
      return result.goto._tag;
    }
  } catch {
    // Handler threw - might need specific event data, skip
  }
  return null;
}

// ============================================================================
// Extraction
// ============================================================================

/**
 * Extract the transition graph from a machine configuration.
 *
 * This analyzes the machine's state handlers to determine which state
 * transitions are possible. It works by:
 * 1. Iterating over each state's event handlers
 * 2. Calling each handler with dummy context/event to see what it returns
 * 3. Collecting `goto` targets from the results
 *
 * Note: This uses runtime analysis, so handlers with conditional logic
 * may not reveal all possible transitions.
 *
 * @example
 * ```ts
 * const graph = getTransitionGraph(orderMachine.config);
 * // { Cart: ["Checkout", "Cancelled"], Checkout: ["Cart", "Processing", "Cancelled"], ... }
 *
 * if (!graph["Cart"]?.includes("Checkout")) {
 *   throw new Error("Invalid transition");
 * }
 * ```
 */
export function getTransitionGraph<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(config: MachineConfig<S, C, E>): TransitionGraph {
  const graph: Record<string, string[]> = {};

  for (const stateTag of Object.keys(config.states)) {
    graph[stateTag] = [];
  }

  for (const [stateTag, stateConfig] of Object.entries(config.states)) {
    const targets = new Set<string>();
    const handlers = (stateConfig as { on?: Record<string, unknown> }).on;

    if (handlers) {
      for (const handler of Object.values(handlers)) {
        const target = tryCallHandler(handler, config.initialContext, "probe");
        if (target) targets.add(target);
      }
    }

    graph[stateTag] = Array.from(targets);
  }

  return graph;
}

/**
 * Get detailed transition analysis from a machine definition.
 *
 * @example
 * ```ts
 * const analysis = analyzeTransitions(machine);
 *
 * if (analysis.isValidTransition("Cart", "Processing")) { ... }
 * analysis.terminalStates // ["Delivered", "Cancelled"]
 * analysis.getEventsForState("Cart") // ["ProceedToCheckout", "CancelOrder", ...]
 * ```
 */
export function analyzeTransitions<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(definition: MachineDefinition<S, C, E>): TransitionAnalysis {
  const config = definition.config;
  const edges: TransitionEdge[] = [];
  const graph: Record<string, Set<string>> = {};
  const eventsByState: Record<string, Set<string>> = {};

  for (const stateTag of Object.keys(config.states)) {
    graph[stateTag] = new Set();
    eventsByState[stateTag] = new Set();
  }

  for (const [stateTag, stateConfig] of Object.entries(config.states)) {
    const handlers = (stateConfig as { on?: Record<string, unknown> }).on;

    if (handlers) {
      for (const [eventTag, handler] of Object.entries(handlers)) {
        const stateEvents = eventsByState[stateTag];
        if (stateEvents) stateEvents.add(eventTag);

        const target = tryCallHandler(handler, config.initialContext, eventTag);
        if (target) {
          const stateTargets = graph[stateTag];
          if (stateTargets) stateTargets.add(target);
          edges.push({ from: stateTag, to: target, event: eventTag });
        }
      }
    }
  }

  const terminalStates = Object.entries(graph)
    .filter(([, targets]) => targets.size === 0)
    .map(([state]) => state);

  const initialTag = config.initialState._tag;
  const reachable = new Set<string>([initialTag]);
  const queue = [initialTag];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const targets = graph[current];
    if (targets) {
      for (const target of targets) {
        if (!reachable.has(target)) {
          reachable.add(target);
          queue.push(target);
        }
      }
    }
  }

  const finalGraph: Record<string, string[]> = {};
  for (const [state, targets] of Object.entries(graph)) {
    finalGraph[state] = Array.from(targets);
  }

  return {
    graph: finalGraph,
    edges,
    terminalStates,
    reachableStates: Array.from(reachable),

    isValidTransition(from: string, to: string): boolean {
      return finalGraph[from]?.includes(to) ?? false;
    },

    getEventsForState(state: string): readonly string[] {
      const events = eventsByState[state];
      return events ? Array.from(events) : [];
    },

    getNextStates(state: string): readonly string[] {
      return finalGraph[state] ?? [];
    },
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Create a transition validator function from a machine definition.
 *
 * @example
 * ```ts
 * const isValidTransition = createTransitionValidator(orderMachine);
 *
 * // In server mutation:
 * if (!isValidTransition(currentState._tag, newState._tag)) {
 *   throw new Error("Invalid state transition");
 * }
 * ```
 */
export function createTransitionValidator<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(definition: MachineDefinition<S, C, E>): (from: string, to: string) => boolean {
  const graph = getTransitionGraph(definition.config);
  return (from, to) => graph[from]?.includes(to) ?? false;
}

/**
 * Extract terminal (final) states from a machine.
 *
 * @example
 * ```ts
 * const terminals = getTerminalStates(orderMachine);
 * // ["Delivered", "Cancelled"]
 * ```
 */
export function getTerminalStates<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(definition: MachineDefinition<S, C, E>): readonly string[] {
  const graph = getTransitionGraph(definition.config);
  return Object.entries(graph)
    .filter(([, targets]) => targets.length === 0)
    .map(([state]) => state);
}

/**
 * Check if a state is terminal (has no outgoing transitions).
 */
export function isTerminalState<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
>(definition: MachineDefinition<S, C, E>, stateTag: string): boolean {
  const graph = getTransitionGraph(definition.config);
  return (graph[stateTag]?.length ?? 0) === 0;
}
