// Types
export type {
  Action,
  ActionEnqueuer,
  ActivityConfig,
  AnyMachineDefinition,
  AssignAction,
  CancelAction,
  EffectAction,
  EmitAction,
  EmittedEvent,
  EnqueueActionsAction,
  EnqueueActionsParams,
  ErrorByTag,
  EventByTag,
  ForwardToAction,
  Guard,
  InvokeConfig,
  InvokeDefectEvent,
  InvokeDoneEvent,
  InvokeErrorEvent,
  InvokeFailureEvent,
  InvokeInterruptEvent,
  InvokeSuccessEvent,
  MachineConfig,
  MachineContext,
  MachineDefinition,
  MachineDefinitionE,
  MachineDefinitionR,
  MachineEvent,
  MachineSnapshot,
  NarrowedTransitionConfig,
  RaiseAction,
  SendParentAction,
  SendToAction,
  SpawnChildAction,
  StateNodeConfig,
  StateMachineError,
  StopChildAction,
  TaggedError,
  TransitionConfig,
} from "./types.js";

// Error types (Effect TaggedErrors)
export {
  EffectActionError,
  ActivityError,
} from "./types.js";

// Machine creation
export { createMachine, interpret, interpretSync, type MachineActor } from "./machine.js";

// Actions
export { assign, assignOnDefect, assignOnFailure, assignOnSuccess, cancel, effect, emit, enqueueActions, forwardTo, log, raise, sendParent, sendTo, spawnChild, stopChild } from "./actions.js";

// Guards
export { and, guard, not, or } from "./guards.js";

// Serialization (Schema-based context)
export {
  createSnapshotSchema,
  decodeSnapshot,
  decodeSnapshotSync,
  encodeSnapshot,
  encodeSnapshotSync,
} from "./serialization.js";

// Atom integration
export {
  createUseChildMachineHook,
  createUseMachineHook,
  selectContext,
  selectState,
  type UseMachineResult,
} from "./atom.js";

// Machine service type utilities (for automatic R channel composition)
export {
  type MachineServiceR,
  type MachineServiceE,
  type MachineServiceState,
  type MachineServiceContext,
  type MachineServiceEvent,
  type ChildrenServicesR,
} from "./service.js";

// Machine registry (for managing actor instances)
export {
  MachineRegistry,
  type ActorInstance,
  type MachineRegistryService,
} from "./registry.js";
