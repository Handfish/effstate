import { Chunk, Effect, Stream, SubscriptionRef } from "effect";

/**
 * TabActiveService provides Effect-based tracking of tab visibility.
 *
 * Uses a Latch to gate operations that should only happen when the tab is active:
 * - `yield* latch` or `yield* latch.await` blocks until the tab is active
 * - Operations can be cancelled when waiting for the latch
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const tabService = yield* TabActiveService;
 *
 *   // This will block if tab is inactive, and resume when active
 *   yield* tabService.latch;
 *
 *   // Now we know the tab is active, do work...
 * });
 * ```
 */
export class TabActiveService extends Effect.Service<TabActiveService>()("TabActiveService", {
  effect: Effect.gen(function* () {
    const isInitiallyActive = typeof document !== "undefined" ? !document.hidden : true;
    const latch = yield* Effect.makeLatch(isInitiallyActive);
    const ref = yield* SubscriptionRef.make<boolean>(isInitiallyActive);

    yield* Effect.log("TabActiveService: initialized", { isActive: isInitiallyActive });

    // Only set up listeners in browser environment
    if (typeof document !== "undefined") {
      yield* Stream.async<boolean>((emit) => {
        const handler = () => {
          const isActive = !document.hidden;
          emit(Effect.succeed(Chunk.of(isActive)));
        };
        document.addEventListener("visibilitychange", handler);
        // Return cleanup (though this stream runs forever in daemon mode)
        return Effect.sync(() => document.removeEventListener("visibilitychange", handler));
      }).pipe(
        Stream.tap((isActive) =>
          Effect.gen(function* () {
            if (isActive) {
              yield* latch.open;
            } else {
              yield* latch.close;
            }
            yield* SubscriptionRef.set(ref, isActive);
          }),
        ),
        Stream.tap((isActive) => Effect.log("TabActiveService: visibility changed", { isActive })),
        Stream.runDrain,
        Effect.forkDaemon,
      );
    }

    return {
      /** Latch that is open when tab is active, closed when inactive. Yield to wait for tab to be active. */
      latch,
      /** SubscriptionRef for reactive tab active state */
      ref,
      /** Get current tab active state synchronously */
      getIsActive: () => typeof document !== "undefined" ? !document.hidden : true,
    };
  }),
}) {}
