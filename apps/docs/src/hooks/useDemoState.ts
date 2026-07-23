/**
 * Demo state hook — effstate v4 + @handfish/effstate-react.
 *
 * Owns three actors (one hamster wheel, two garage doors), wires the hamster's
 * electricity to the doors' power with `useActorBridge`, and keeps everything in
 * sync across browser tabs with `useActorSync` + a localStorage leader election.
 */

import { useCallback } from "react";
import { useActor, useActorBridge, useActorSync } from "@handfish/effstate-react";
import {
  hamsterWheelMachine,
  garageDoorMachine,
  Toggle,
  Click,
  PowerOn,
  PowerOff,
  getHamsterStateLabel,
  getHamsterButtonLabel,
  getDoorStateLabel,
  getDoorButtonLabel,
} from "@/machines";
import {
  serializeHamster,
  deserializeHamster,
  serializeDoor,
  deserializeDoor,
} from "@/lib/persistence";
import { useIsLeader, useStorageValue, readSnapshot } from "@/lib/cross-tab";

// Re-export UI helpers so components can import them from one place.
export { getHamsterStateLabel, getHamsterButtonLabel, getDoorStateLabel, getDoorButtonLabel };

const NS = "effstate-demo";
const HAMSTER_KEY = `${NS}:hamster`;
const LEFT_KEY = `${NS}:leftDoor`;
const RIGHT_KEY = `${NS}:rightDoor`;

function restore<T>(key: string, deserialize: (v: any) => T): T | undefined {
  const raw = readSnapshot(key);
  if (!raw) return undefined;
  try {
    return deserialize(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function useDemoState() {
  const isLeader = useIsLeader(NS);

  // Restore initial snapshots synchronously (localStorage is available in the
  // browser-only demo, so there's no loading flicker).
  const hamster = useActor(hamsterWheelMachine, {
    initialSnapshot: restore(HAMSTER_KEY, deserializeHamster),
  });
  const leftDoor = useActor(garageDoorMachine, {
    initialSnapshot: restore(LEFT_KEY, deserializeDoor),
  });
  const rightDoor = useActor(garageDoorMachine, {
    initialSnapshot: restore(RIGHT_KEY, deserializeDoor),
  });

  // Hamster electricity powers both doors (idiomatic cross-actor wiring).
  const toPower = (isPowered: boolean) => (isPowered ? PowerOn.make() : PowerOff.make());
  const hasPower = (snap: { context: { electricityLevel: number } }) => snap.context.electricityLevel > 0;
  useActorBridge(hamster.actor, leftDoor.actor, hasPower, toPower);
  useActorBridge(hamster.actor, rightDoor.actor, hasPower, toPower);

  // Cross-tab sync: the leader saves, followers apply.
  useActorSync(hamster.actor, useStorageValue(HAMSTER_KEY), {
    isLeader,
    serialize: (snap) => JSON.stringify(serializeHamster(snap)),
    deserialize: (saved) => deserializeHamster(JSON.parse(saved)),
    onSave: (saved) => localStorage.setItem(HAMSTER_KEY, saved),
  });
  useActorSync(leftDoor.actor, useStorageValue(LEFT_KEY), {
    isLeader,
    serialize: (snap) => JSON.stringify(serializeDoor(snap)),
    deserialize: (saved) => deserializeDoor(JSON.parse(saved)),
    onSave: (saved) => localStorage.setItem(LEFT_KEY, saved),
  });
  useActorSync(rightDoor.actor, useStorageValue(RIGHT_KEY), {
    isLeader,
    serialize: (snap) => JSON.stringify(serializeDoor(snap)),
    deserialize: (saved) => deserializeDoor(JSON.parse(saved)),
    onSave: (saved) => localStorage.setItem(RIGHT_KEY, saved),
  });

  const toggleHamster = useCallback(() => hamster.send(Toggle.make()), [hamster]);
  const clickDoor = useCallback(
    (door: "left" | "right") => (door === "left" ? leftDoor : rightDoor).send(Click.make()),
    [leftDoor, rightDoor],
  );

  return {
    isLeader,
    hamster: { state: hamster.state, context: hamster.context },
    leftDoor: { state: leftDoor.state, context: leftDoor.context },
    rightDoor: { state: rightDoor.state, context: rightDoor.context },
    toggleHamster,
    clickDoor,
  };
}
