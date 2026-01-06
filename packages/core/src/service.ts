import type { Context } from "effect";
import type { MachineContext, MachineDefinition, MachineEvent } from "./types.js";

// ============================================================================
// Type Utilities for Machine Services
// ============================================================================

/**
 * Minimal machine definition constraint for service type extraction.
 * Avoids contravariance issues while allowing type inference.
 */
type MachineDefinitionShape = MachineDefinition<
  string,
  string,
  MachineContext,
  MachineEvent,
  unknown,
  unknown,
  unknown
>;

/**
 * Extract the R channel (requirements) from a machine service tag.
 *
 * @example
 * ```ts
 * type GarageDoorR = MachineServiceR<typeof GarageDoorMachineService>;
 * // => WeatherService
 * ```
 */
export type MachineServiceR<T> = T extends Context.Tag<infer _Id, infer Service>
  ? Service extends { definition: infer Def }
    ? Def extends MachineDefinitionShape
      ? Def extends MachineDefinition<string, string, MachineContext, MachineEvent, infer R, unknown, unknown>
        ? R
        : never
      : never
    : never
  : never;

/**
 * Extract the E channel (errors) from a machine service tag.
 */
export type MachineServiceE<T> = T extends Context.Tag<infer _Id, infer Service>
  ? Service extends { definition: infer Def }
    ? Def extends MachineDefinitionShape
      ? Def extends MachineDefinition<string, string, MachineContext, MachineEvent, unknown, infer E, unknown>
        ? E
        : never
      : never
    : never
  : never;

/**
 * Extract the state value type from a machine service tag.
 */
export type MachineServiceState<T> = T extends Context.Tag<infer _Id, infer Service>
  ? Service extends { definition: infer Def }
    ? Def extends MachineDefinitionShape
      ? Def extends MachineDefinition<string, infer TState, MachineContext, MachineEvent, unknown, unknown, unknown>
        ? TState
        : never
      : never
    : never
  : never;

/**
 * Extract the context type from a machine service tag.
 */
export type MachineServiceContext<T> = T extends Context.Tag<infer _Id, infer Service>
  ? Service extends { definition: infer Def }
    ? Def extends MachineDefinitionShape
      ? Def extends MachineDefinition<string, string, infer TContext, MachineEvent, unknown, unknown, unknown>
        ? TContext
        : never
      : never
    : never
  : never;

/**
 * Extract the event type from a machine service tag.
 */
export type MachineServiceEvent<T> = T extends Context.Tag<infer _Id, infer Service>
  ? Service extends { definition: infer Def }
    ? Def extends MachineDefinitionShape
      ? Def extends MachineDefinition<string, string, MachineContext, infer TEvent, unknown, unknown, unknown>
        ? TEvent
        : never
      : never
    : never
  : never;

/**
 * Compute the combined R channel from a record of machine services.
 *
 * @example
 * ```ts
 * type ChildrenR = ChildrenServicesR<{
 *   garageDoor: typeof GarageDoorMachineService;
 *   other: typeof OtherMachineService;
 * }>;
 * // => WeatherService | OtherServiceR
 * ```
 */
export type ChildrenServicesR<T extends Record<string, Context.Tag<unknown, unknown>>> =
  T[keyof T] extends Context.Tag<unknown, unknown> ? MachineServiceR<T[keyof T]> : never;

// ============================================================================
// Machine Service Factory
// ============================================================================

// Note: The createMachineService factory has been removed in favor of directly
// extending Effect.Service. This provides better type safety and clearer syntax.
//
// Example:
// ```ts
// class GarageDoorMachineService extends Effect.Service<GarageDoorMachineService>()(
//   "GarageDoorMachineService",
//   {
//     effect: Effect.succeed({
//       definition: GarageDoorMachine,
//       createActor: () => interpret(GarageDoorMachine),
//     }),
//     dependencies: [WeatherService.Default],
//   }
// ) {}
// ```
