/**
 * Synced Actor Hook
 *
 * Higher-level hook that handles the common pattern of:
 * - Optimistic local updates (instant UI)
 * - Persisting to server
 * - Tracking sync status
 * - Handling external updates
 *
 * Works with any persistence backend (Convex, Dexie, REST API, etc.)
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Effect } from "effect";
import type {
  MachineState,
  MachineContext,
  MachineEvent,
  MachineActor,
  MachineSnapshot,
  MachineDefinition,
} from "effstate/v3";

// Helper to create a delay promise without direct setTimeout reference
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
    if (timer) timer(resolve, ms);
    else resolve();
  });

// ============================================================================
// Types
// ============================================================================

/**
 * Event in the sync timeline, useful for debugging/visualization.
 */
export interface SyncTimelineEvent {
  readonly id: string;
  readonly timestamp: Date;
  readonly type: "optimistic" | "server_confirmed" | "server_correction" | "external_update";
  readonly eventTag?: string;
  readonly fromState: string;
  readonly toState: string;
  readonly details?: string;
}

/**
 * Sync status information
 */
export interface SyncStatus {
  /** Whether there are pending mutations being sent to server */
  readonly isSyncing: boolean;
  /** Number of mutations waiting for server confirmation */
  readonly pendingMutations: number;
  /** When the last successful sync occurred */
  readonly lastSyncTime: Date | null;
  /** Recent sync events for timeline visualization */
  readonly timeline: readonly SyncTimelineEvent[];
  /** Last event type (for triggering visualizations) */
  readonly lastEventType: SyncTimelineEvent["type"] | null;
}

/**
 * Options for useSyncedActor hook
 */
export interface UseSyncedActorOptions<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TExternal,
> {
  /** The machine definition */
  machine: MachineDefinition<S, C, E>;

  /** Initial snapshot from server/database */
  initialSnapshot: MachineSnapshot<S, C>;

  /**
   * Called after each local state transition to persist to server.
   * Return a promise that resolves when persisted.
   * If it throws, the error is caught and logged.
   */
  persist?: (snapshot: MachineSnapshot<S, C>, event: E) => Promise<void>;

  /**
   * External snapshot from server (e.g., from Convex useQuery).
   * When this changes, local state is synced via _syncSnapshot.
   */
  externalSnapshot?: TExternal | null | undefined;

  /**
   * Convert external format to machine snapshot.
   * Required if externalSnapshot is provided.
   */
  deserializeExternal?: (external: TExternal) => MachineSnapshot<S, C>;

  /**
   * Compare external snapshots for equality (to avoid unnecessary syncs).
   * Default: JSON.stringify comparison.
   */
  externalEquals?: (a: TExternal, b: TExternal) => boolean;

  /**
   * Simulated network latency in ms (for demos/testing).
   * Default: 0
   */
  latency?: number;

  /**
   * Maximum timeline events to keep.
   * Default: 50
   */
  maxTimelineEvents?: number;

  /**
   * Called when an error occurs during persist.
   */
  onPersistError?: (error: unknown, event: E) => void;
}

/**
 * Result from useSyncedActor hook
 */
export interface UseSyncedActorResult<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
> {
  /** Current snapshot (state + context) */
  snapshot: MachineSnapshot<S, C>;
  /** Current state */
  state: S;
  /** Current context */
  context: C;
  /** Current state tag */
  stateTag: S["_tag"];
  /** Send an event (optimistic + persist) */
  send: (event: E) => void;
  /** The underlying actor */
  actor: MachineActor<S, C, E>;
  /** Sync status information */
  syncStatus: SyncStatus;
}

// ============================================================================
// Hook Implementation
// ============================================================================

let timelineIdCounter = 0;

/**
 * Hook that manages an actor with automatic server synchronization.
 *
 * @example
 * ```ts
 * // With Convex
 * const convexOrder = useQuery(api.orders.get, { orderId });
 * const updateOrder = useMutation(api.orders.update);
 *
 * const { snapshot, send, syncStatus } = useSyncedActor({
 *   machine: orderMachine,
 *   initialSnapshot: convexOrderToSnapshot(convexOrder),
 *   externalSnapshot: convexOrder,
 *   deserializeExternal: convexOrderToSnapshot,
 *   persist: async (snapshot, event) => {
 *     await updateOrder({ orderId, state: serializeState(snapshot.state) });
 *   },
 * });
 *
 * // With REST API
 * const { snapshot, send, syncStatus } = useSyncedActor({
 *   machine: orderMachine,
 *   initialSnapshot,
 *   persist: async (snapshot, event) => {
 *     await fetch(`/api/orders/${orderId}`, {
 *       method: "PATCH",
 *       body: JSON.stringify({ state: snapshot.state }),
 *     });
 *   },
 * });
 * ```
 */
export function useSyncedActor<
  S extends MachineState,
  C extends MachineContext,
  E extends MachineEvent,
  TExternal = unknown,
>(options: UseSyncedActorOptions<S, C, E, TExternal>): UseSyncedActorResult<S, C, E> {
  const {
    machine,
    initialSnapshot,
    persist,
    externalSnapshot,
    deserializeExternal,
    externalEquals = (a, b) => JSON.stringify(a) === JSON.stringify(b),
    latency = 0,
    maxTimelineEvents = 50,
    onPersistError,
  } = options;

  // ============================================================================
  // Actor Setup
  // ============================================================================

  const actorRef = useRef<MachineActor<S, C, E> | null>(null);

  if (actorRef.current === null) {
    const program = machine.interpret({ snapshot: initialSnapshot });
    actorRef.current = Effect.runSync(program);
  }

  const actor = actorRef.current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      actorRef.current?.stop();
      actorRef.current = null;
    };
  }, []);

  // Subscribe to actor for React updates
  const snapshot = useSyncExternalStore(actor.subscribe, actor.getSnapshot, actor.getSnapshot);

  // ============================================================================
  // Sync Status State
  // ============================================================================

  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [timeline, setTimeline] = useState<SyncTimelineEvent[]>([]);
  const [lastEventType, setLastEventType] = useState<SyncTimelineEvent["type"] | null>(null);

  // ============================================================================
  // Timeline Helper
  // ============================================================================

  const addTimelineEvent = useCallback(
    (event: Omit<SyncTimelineEvent, "id" | "timestamp">) => {
      const newEvent: SyncTimelineEvent = {
        ...event,
        id: `sync-${++timelineIdCounter}`,
        timestamp: new Date(),
      };
      setTimeline((prev) => [...prev.slice(-(maxTimelineEvents - 1)), newEvent]);
      setLastEventType(event.type);
    },
    [maxTimelineEvents]
  );

  // ============================================================================
  // External Snapshot Sync
  // ============================================================================

  const prevExternalRef = useRef<TExternal | null | undefined>(undefined);

  useEffect(() => {
    if (externalSnapshot === null || externalSnapshot === undefined || !deserializeExternal) {
      return;
    }

    // Skip if external hasn't changed
    if (
      prevExternalRef.current !== undefined &&
      prevExternalRef.current !== null &&
      externalEquals(prevExternalRef.current, externalSnapshot)
    ) {
      return;
    }

    const isFirstLoad = prevExternalRef.current === undefined;
    prevExternalRef.current = externalSnapshot;

    const newSnapshot = deserializeExternal(externalSnapshot);
    const currentSnapshot = actor.getSnapshot();

    // Check if this is a correction (server differs from local)
    const isCorrection = currentSnapshot.state._tag !== newSnapshot.state._tag;

    if (!isFirstLoad) {
      addTimelineEvent({
        type: isCorrection ? "server_correction" : "external_update",
        fromState: currentSnapshot.state._tag,
        toState: newSnapshot.state._tag,
        details: isCorrection ? "Server state differs - correcting via _syncSnapshot" : "External update received",
      });
    }

    actor._syncSnapshot(newSnapshot);
    setLastSyncTime(new Date());
  }, [externalSnapshot, deserializeExternal, externalEquals, actor, addTimelineEvent]);

  // ============================================================================
  // Wrapped Send with Persistence
  // ============================================================================

  const send = useCallback(
    async (event: E) => {
      const prevSnapshot = actor.getSnapshot();
      const prevState = prevSnapshot.state._tag;

      // Optimistic: update local state immediately
      actor.send(event);

      const newSnapshot = actor.getSnapshot();
      const newState = newSnapshot.state._tag;

      // Log optimistic update
      if (newState !== prevState) {
        addTimelineEvent({
          type: "optimistic",
          eventTag: event._tag,
          fromState: prevState,
          toState: newState,
          details: `Instant UI update`,
        });
      }

      // Persist to server if handler provided
      if (persist) {
        setIsSyncing(true);
        setPendingMutations((p) => p + 1);

        try {
          // Apply simulated latency
          if (latency > 0) {
            await delay(latency);
          }

          await persist(newSnapshot, event);

          // Log server confirmation
          addTimelineEvent({
            type: "server_confirmed",
            eventTag: event._tag,
            fromState: prevState,
            toState: newState,
            details: latency > 0 ? `Persisted after ${latency}ms` : "Persisted",
          });

          setLastSyncTime(new Date());
        } catch (error) {
          onPersistError?.(error, event);

          addTimelineEvent({
            type: "server_correction",
            eventTag: event._tag,
            fromState: newState,
            toState: prevState,
            details: `Persist failed: ${String(error)}`,
          });
        } finally {
          setIsSyncing(false);
          setPendingMutations((p) => Math.max(0, p - 1));
        }
      }
    },
    [actor, persist, latency, addTimelineEvent, onPersistError]
  );

  // ============================================================================
  // Result
  // ============================================================================

  const syncStatus: SyncStatus = {
    isSyncing,
    pendingMutations,
    lastSyncTime,
    timeline,
    lastEventType,
  };

  return {
    snapshot,
    state: snapshot.state,
    context: snapshot.context,
    stateTag: snapshot.state._tag,
    send,
    actor,
    syncStatus,
  };
}

// ============================================================================
// Utility: useSyncMetrics
// ============================================================================

/**
 * Metrics calculated from sync timeline
 */
export interface SyncMetrics {
  /** Total optimistic updates */
  optimisticCount: number;
  /** Total server confirmations */
  confirmedCount: number;
  /** Total corrections (server overrides) */
  correctionCount: number;
  /** Hit rate: confirmed / (confirmed + corrections) */
  hitRate: number;
  /** Average time between optimistic and confirm (if tracking timestamps) */
  avgLatency: number | null;
}

/**
 * Calculate metrics from a sync timeline.
 *
 * @example
 * ```ts
 * const { syncStatus } = useSyncedActor({ ... });
 * const metrics = useSyncMetrics(syncStatus.timeline);
 * // { optimisticCount: 10, confirmedCount: 9, correctionCount: 1, hitRate: 0.9 }
 * ```
 */
export function calculateSyncMetrics(timeline: readonly SyncTimelineEvent[]): SyncMetrics {
  let optimisticCount = 0;
  let confirmedCount = 0;
  let correctionCount = 0;

  for (const event of timeline) {
    switch (event.type) {
      case "optimistic":
        optimisticCount++;
        break;
      case "server_confirmed":
        confirmedCount++;
        break;
      case "server_correction":
        correctionCount++;
        break;
    }
  }

  const total = confirmedCount + correctionCount;
  const hitRate = total > 0 ? confirmedCount / total : 1;

  return {
    optimisticCount,
    confirmedCount,
    correctionCount,
    hitRate,
    avgLatency: null, // Would need timestamp pairing to calculate
  };
}

/**
 * Hook that calculates sync metrics from a timeline.
 */
export function useSyncMetrics(timeline: readonly SyncTimelineEvent[]): SyncMetrics {
  // Memoize based on timeline length (simple heuristic)
  const [metrics, setMetrics] = useState<SyncMetrics>(() => calculateSyncMetrics(timeline));

  useEffect(() => {
    setMetrics(calculateSyncMetrics(timeline));
  }, [timeline.length]);

  return metrics;
}
