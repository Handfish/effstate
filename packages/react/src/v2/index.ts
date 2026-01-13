/**
 * EffState v2 React Integration
 *
 * React hooks for v2 machines with discriminated union states.
 *
 * @example
 * ```ts
 * import { createUseMachineHook, isState, getStateData } from "effstate-react/v2";
 * import { GarageDoorMachine, GarageDoorState } from "./garage-door";
 *
 * // Create hook
 * const useGarageDoor = createUseMachineHook(actorAtom, snapshotAtom, initialSnapshot);
 *
 * // Use in component
 * function GarageDoorUI() {
 *   const { state, matches, send, context } = useGarageDoor();
 *
 *   // Pattern 1: matches helper
 *   if (matches("Opening")) {
 *     return <div>Opening...</div>;
 *   }
 *
 *   // Pattern 2: isState type guard
 *   if (isState(state, "Open")) {
 *     return <div>Opened at: {state.openedAt.toISOString()}</div>;
 *   }
 *
 *   // Pattern 3: getStateData helper
 *   const pausedData = getStateData(state, "PausedWhileOpening");
 *   if (pausedData) {
 *     return <div>Paused at position: {pausedData.pausedPosition}%</div>;
 *   }
 *
 *   return <div>State: {state._tag}</div>;
 * }
 * ```
 *
 * @packageDocumentation
 */

export {
  createUseMachineHook,
  createUseChildMachineHook,
  selectContext,
  selectState,
  selectStateData,
  isState,
  getStateData,
  type UseMachineResult,
} from "./atom.js";
