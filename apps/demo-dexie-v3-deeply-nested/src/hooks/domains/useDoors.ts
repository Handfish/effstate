/**
 * Doors Domain Hook
 *
 * Manages both garage doors.
 * Exposes actors for persistence coordination.
 */

import { useCallback } from "react";
import { useActor } from "@effstate/react/v3";
import type { MachineSnapshot } from "effstate/v3";
import {
  garageDoorMachine,
  Click,
  PowerOn,
  PowerOff,
  type DoorState,
  type DoorContext,
  type GarageDoorActor,
} from "@/machines";

export type DoorSnapshot = MachineSnapshot<DoorState, DoorContext>;

export interface DoorsDomain {
  left: { state: DoorState; context: DoorContext; actor: GarageDoorActor };
  right: { state: DoorState; context: DoorContext; actor: GarageDoorActor };
  click: (door: "left" | "right") => void;
  setPower: (isPowered: boolean) => void;
}

export function useDoors(
  leftSnapshot: DoorSnapshot | null,
  rightSnapshot: DoorSnapshot | null
): DoorsDomain {
  const left = useActor(
    garageDoorMachine,
    leftSnapshot ? { initialSnapshot: leftSnapshot } : undefined
  );

  const right = useActor(
    garageDoorMachine,
    rightSnapshot ? { initialSnapshot: rightSnapshot } : undefined
  );

  const click = useCallback(
    (door: "left" | "right") => {
      (door === "left" ? left : right).send(new Click());
    },
    [left, right]
  );

  const setPower = useCallback(
    (isPowered: boolean) => {
      const event = isPowered ? new PowerOn() : new PowerOff();
      left.send(event);
      right.send(event);
    },
    [left, right]
  );

  return {
    left: { state: left.state, context: left.context, actor: left.actor },
    right: { state: right.state, context: right.context, actor: right.actor },
    click,
    setPower,
  };
}
