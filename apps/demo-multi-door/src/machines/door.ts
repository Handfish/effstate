/**
 * Simplified Garage Door Machine
 * Demonstrates multiple actors without parent-child relationships
 */

import { Data, Duration, Schedule, Stream } from "effect";
import { defineMachine, type MachineActor, type MachineSnapshot } from "effstate/v3";

// ============================================================================
// State
// ============================================================================

export type DoorState =
  | { readonly _tag: "Closed" }
  | { readonly _tag: "Opening" }
  | { readonly _tag: "Open" }
  | { readonly _tag: "Closing" };

export const DoorState = {
  Closed: (): DoorState => ({ _tag: "Closed" }),
  Opening: (): DoorState => ({ _tag: "Opening" }),
  Open: (): DoorState => ({ _tag: "Open" }),
  Closing: (): DoorState => ({ _tag: "Closing" }),
};

// ============================================================================
// Context
// ============================================================================

export interface DoorContext {
  readonly position: number;
  readonly message: string | null; // For receiving external messages
  readonly [key: string]: unknown;
}

// ============================================================================
// Events
// ============================================================================

export class Click extends Data.TaggedClass("Click")<{}> {}
export class Tick extends Data.TaggedClass("Tick")<{ readonly delta: number }> {}
export class ReceiveMessage extends Data.TaggedClass("ReceiveMessage")<{ readonly text: string }> {}
export class ClearMessage extends Data.TaggedClass("ClearMessage")<{}> {}

export type DoorEvent = Click | Tick | ReceiveMessage | ClearMessage;

// ============================================================================
// Machine
// ============================================================================

const tickStream = (delta: number) =>
  Stream.fromSchedule(Schedule.spaced(Duration.millis(16))).pipe(
    Stream.map(() => new Tick({ delta: delta * 0.16 })),
  );

export const doorMachine = defineMachine<DoorState, DoorContext, DoorEvent>({
  id: "door",
  initialContext: { position: 0, message: null },
  initialState: DoorState.Closed(),

  // Global handler for messages - works in any state
  global: {
    ReceiveMessage: (_ctx, event) => ({
      update: { message: event.text },
      actions: [() => console.log(`Door received: "${event.text}"`)],
    }),
    ClearMessage: () => ({ update: { message: null } }),
  },

  states: {
    Closed: {
      on: {
        Click: () => ({ goto: DoorState.Opening() }),
      },
    },

    Opening: {
      run: tickStream(1),
      on: {
        Click: () => ({ goto: DoorState.Closing() }),
        Tick: (ctx, event) => {
          const newPos = Math.min(100, ctx.position + event.delta);
          return newPos >= 100
            ? { goto: DoorState.Open(), update: { position: 100 } }
            : { update: { position: newPos } };
        },
      },
    },

    Open: {
      on: {
        Click: () => ({ goto: DoorState.Closing() }),
      },
    },

    Closing: {
      run: tickStream(-1),
      on: {
        Click: () => ({ goto: DoorState.Opening() }),
        Tick: (ctx, event) => {
          const newPos = Math.max(0, ctx.position + event.delta);
          return newPos <= 0
            ? { goto: DoorState.Closed(), update: { position: 0 } }
            : { update: { position: newPos } };
        },
      },
    },
  },
});

// ============================================================================
// Types
// ============================================================================

export type DoorActor = MachineActor<DoorState, DoorContext, DoorEvent>;
export type DoorSnapshot = MachineSnapshot<DoorState, DoorContext>;

// ============================================================================
// Helpers
// ============================================================================

export function getStateLabel(state: DoorState): string {
  switch (state._tag) {
    case "Closed":
      return "Closed";
    case "Opening":
      return "Opening...";
    case "Open":
      return "Open";
    case "Closing":
      return "Closing...";
  }
}

export function getButtonLabel(state: DoorState): string {
  switch (state._tag) {
    case "Closed":
      return "Open";
    case "Opening":
      return "Reverse";
    case "Open":
      return "Close";
    case "Closing":
      return "Reverse";
  }
}
