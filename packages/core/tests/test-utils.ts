/**
 * Test utilities for effstate tests.
 *
 * Provides helpers that wrap the Effect-based interpret() for easier testing.
 */

import { Effect, Scope } from "effect";
import { interpret, type MachineActor } from "../src/machine.js";
import type { MachineContext, MachineDefinition, MachineEvent, MachineSnapshot } from "../src/types.js";

/**
 * Create a test actor from a machine definition.
 *
 * This is a test helper that wraps interpret() for synchronous-style testing.
 * It creates a managed scope and returns the actor.
 *
 * @example
 * ```ts
 * const actor = await testActor(machine);
 * actor.send(new MyEvent());
 * expect(actor.getSnapshot().value).toBe("done");
 * ```
 */
export async function testActor<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
  TContextEncoded,
>(
  machine: MachineDefinition<TId, TStateValue, TContext, TEvent, R, E, TContextEncoded>,
  options?: {
    /** Initial snapshot to restore from */
    snapshot?: MachineSnapshot<TStateValue, TContext>;
    /** Child snapshots to restore (keyed by child ID) */
    childSnapshots?: ReadonlyMap<string, MachineSnapshot<string, MachineContext>>;
  },
): Promise<MachineActor<TStateValue, TContext, TEvent>> {
  // Create a scope that lives for the duration of the test
  const scope = Effect.runSync(Scope.make());

  const actor = await Effect.runPromise(
    interpret(machine, options).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
  );

  return actor;
}

/**
 * Create a test actor synchronously (for tests that don't need async).
 *
 * Note: This still uses Effect internally but blocks on the result.
 * Use testActor() for async tests.
 */
export function testActorSync<
  TId extends string,
  TStateValue extends string,
  TContext extends MachineContext,
  TEvent extends MachineEvent,
  R,
  E,
  TContextEncoded,
>(
  machine: MachineDefinition<TId, TStateValue, TContext, TEvent, R, E, TContextEncoded>,
  options?: {
    /** Initial snapshot to restore from */
    snapshot?: MachineSnapshot<TStateValue, TContext>;
    /** Child snapshots to restore (keyed by child ID) */
    childSnapshots?: ReadonlyMap<string, MachineSnapshot<string, MachineContext>>;
  },
): MachineActor<TStateValue, TContext, TEvent> {
  // Create a scope that lives for the duration of the test
  const scope = Effect.runSync(Scope.make());

  const actor = Effect.runSync(
    interpret(machine, options).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
  );

  return actor;
}
