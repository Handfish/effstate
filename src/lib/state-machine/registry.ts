import { Context, Effect, HashMap, Option, Ref, Scope } from "effect";
import type { MachineContext, MachineDefinition, MachineEvent } from "./types.js";
import { interpret, type MachineActor } from "./machine.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a spawned actor instance in the registry.
 */
export interface ActorInstance<
  TStateValue extends string = string,
  TContext extends MachineContext = MachineContext,
  TEvent extends MachineEvent = MachineEvent,
> {
  /** Unique instance ID */
  readonly id: string;
  /** The machine definition's ID */
  readonly machineId: string;
  /** The spawned actor */
  readonly actor: MachineActor<TStateValue, TContext, TEvent>;
  /** Parent instance ID (null for root actors) */
  readonly parentId: string | null;
}

/**
 * Minimal machine definition shape for service constraints.
 * Uses structural typing to avoid contravariance issues while preserving type inference.
 */
type MachineDefinitionShape<
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
> = MachineDefinition<string, TStateValue, TContext, TEvent, R, E, unknown>;

/**
 * Service interface for the machine registry.
 */
export interface MachineRegistryService {
  /**
   * Spawn a new actor from a machine service.
   *
   * The R channel flows from the machine service's requirements, ensuring
   * type-safe dependency injection.
   *
   * @param machineService - The machine service tag to spawn from
   * @param instanceId - Unique identifier for this actor instance
   * @param parentId - Optional parent instance ID for child actors
   * @returns Effect that produces the spawned actor
   *
   * @example
   * ```ts
   * const actor = yield* registry.spawn(
   *   GarageDoorMachineService,
   *   "garage-1",
   *   "parent-id" // optional
   * );
   * ```
   */
  readonly spawn: <
    TStateValue extends string,
    TContext extends MachineContext,
    TEvent extends MachineEvent,
    R,
    E,
  >(
    // Note: The `unknown` for Context.Tag's first type parameter is intentional.
    // Effect's Tag type uses the first parameter for service identification (a phantom type).
    // We don't constrain it because we accept any service tag that provides a MachineDefinition.
    machineService: Context.Tag<
      unknown,
      MachineDefinitionShape<TStateValue, TContext, TEvent, R, E>
    >,
    instanceId: string,
    parentId?: string,
  ) => Effect.Effect<MachineActor<TStateValue, TContext, TEvent>, never, R | Scope.Scope>;

  /**
   * Get an actor instance by its ID.
   *
   * @param instanceId - The instance ID to look up
   * @returns The actor instance or undefined if not found
   */
  readonly get: (instanceId: string) => Effect.Effect<ActorInstance | undefined>;

  /**
   * Get all child instances of a parent actor.
   *
   * @param parentId - The parent instance ID
   * @returns Array of child actor instances
   */
  readonly getChildren: (parentId: string) => Effect.Effect<ReadonlyArray<ActorInstance>>;

  /**
   * Stop and remove an actor from the registry.
   *
   * @param instanceId - The instance ID to stop
   */
  readonly stop: (instanceId: string) => Effect.Effect<void>;

  /**
   * Stop all actors in the registry.
   * Useful for cleanup during shutdown.
   */
  readonly stopAll: Effect.Effect<void>;
}

// ============================================================================
// Registry Service Implementation
// ============================================================================

/**
 * Central registry for managing machine actor instances.
 *
 * The MachineRegistry provides:
 * - Spawning actors from machine services with proper R channel flow
 * - Tracking parent-child relationships between actors
 * - Instance lookup by ID
 * - Cleanup and lifecycle management
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const registry = yield* MachineRegistry;
 *
 *   // Spawn a root actor
 *   const hamsterActor = yield* registry.spawn(
 *     HamsterWheelMachineService,
 *     "hamster-main"
 *   );
 *
 *   // Spawn a child actor
 *   const garageActor = yield* registry.spawn(
 *     GarageDoorMachineService,
 *     "garage-1",
 *     "hamster-main" // parent ID
 *   );
 *
 *   // Get children
 *   const children = yield* registry.getChildren("hamster-main");
 * });
 * ```
 */
export class MachineRegistry extends Effect.Service<MachineRegistry>()("MachineRegistry", {
  effect: Effect.gen(function* () {
    // Internal state: map of instance ID -> ActorInstance
    const actors = yield* Ref.make(
      HashMap.empty<string, ActorInstance<string, MachineContext, MachineEvent>>()
    );

    const spawn: MachineRegistryService["spawn"] = <
      TStateValue extends string,
      TContext extends MachineContext,
      TEvent extends MachineEvent,
      R,
      E,
    >(
      machineService: Context.Tag<
        unknown,
        MachineDefinitionShape<TStateValue, TContext, TEvent, R, E>
      >,
      instanceId: string,
      parentId?: string,
    ): Effect.Effect<MachineActor<TStateValue, TContext, TEvent>, never, R | Scope.Scope> => {
      // Implementation that spawns actor and registers it
      // Note: The cast is needed because TypeScript's structural typing loses the R type
      // through the Context.Tag -> MachineDefinition -> interpret chain.
      // The R channel is actually preserved at runtime through Effect's dependency injection.
      const impl = Effect.gen(function* () {
        const definition = yield* machineService;
        const actor = yield* interpret(definition);

        const instance: ActorInstance<TStateValue, TContext, TEvent> = {
          id: instanceId,
          machineId: definition.id,
          actor,
          parentId: parentId ?? null,
        };

        yield* Ref.update(actors, HashMap.set(instanceId, instance as unknown as ActorInstance));
        yield* Effect.addFinalizer(() => Ref.update(actors, HashMap.remove(instanceId)));

        return actor;
      });

      return impl as Effect.Effect<MachineActor<TStateValue, TContext, TEvent>, never, R | Scope.Scope>;
    };

    const get: MachineRegistryService["get"] = (instanceId) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(actors);
        const result = HashMap.get(map, instanceId);
        return Option.isSome(result) ? result.value : undefined;
      });

    const getChildren: MachineRegistryService["getChildren"] = (parentId) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(actors);
        const allInstances = [...HashMap.values(map)];
        return allInstances.filter((instance) => instance.parentId === parentId);
      });

    const stop: MachineRegistryService["stop"] = (instanceId) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(actors);
        const instance = HashMap.get(map, instanceId);
        if (Option.isSome(instance)) {
          instance.value.actor.stop();
          yield* Ref.update(actors, HashMap.remove(instanceId));
        }
      });

    const stopAll = Effect.gen(function* () {
      const map = yield* Ref.get(actors);
      HashMap.forEach(map, (instance) => {
        instance.actor.stop();
      });
      yield* Ref.set(actors, HashMap.empty());
    });

    return {
      spawn,
      get,
      getChildren,
      stop,
      stopAll,
    } satisfies MachineRegistryService;
  }),
}) {}
