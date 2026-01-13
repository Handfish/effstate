import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { doorMachine, ReceiveMessage, ClearMessage, Click } from "@/machines/door";
import type { DoorActor } from "@/machines/door";
import { GarageDoor } from "@/components/GarageDoor";

/**
 * Multi-Door Demo
 *
 * Demonstrates that React's component tree IS the hierarchy.
 * No need for XState's spawn/sendParent pattern.
 *
 * Key patterns shown:
 * 1. items.map() - Dynamic children via array mapping
 * 2. actor.send() - Direct parent-to-child communication
 */

// Regular doors data
const DOORS = [
  { id: 1, label: "Door 1" },
  { id: 2, label: "Door 2" },
  { id: 3, label: "Door 3" },
  { id: 4, label: "Door 4" },
];

export default function App() {
  // Create actors for regular doors
  const doorsRef = useRef<Map<number, DoorActor>>(new Map());

  // Create actor for special door
  const specialDoorRef = useRef<DoorActor | null>(null);

  // Force re-render after actors are created
  const [ready, setReady] = useState(false);

  // Initialize actors once
  useEffect(() => {
    // Create regular door actors
    for (const door of DOORS) {
      if (!doorsRef.current.has(door.id)) {
        const actor = Effect.runSync(doorMachine.interpret());
        doorsRef.current.set(door.id, actor);
      }
    }

    // Create special door actor
    if (!specialDoorRef.current) {
      specialDoorRef.current = Effect.runSync(doorMachine.interpret());
    }

    setReady(true);

    // Cleanup
    return () => {
      doorsRef.current.forEach((actor) => actor.stop());
      doorsRef.current.clear();
      specialDoorRef.current?.stop();
      specialDoorRef.current = null;
    };
  }, []);

  // Message input state
  const [message, setMessage] = useState("");

  // Send message to special door - direct actor.send()!
  const sendToSpecialDoor = () => {
    if (specialDoorRef.current && message.trim()) {
      // This is the key pattern: direct actor.send() instead of sendTo/sendParent
      specialDoorRef.current.send(new ReceiveMessage({ text: message.trim() }));
      setMessage("");
    }
  };

  // Open all doors at once
  const openAllDoors = () => {
    doorsRef.current.forEach((actor) => {
      const state = actor.getSnapshot().state._tag;
      if (state !== "Open") {
        actor.send(new Click());
      }
    });
    if (specialDoorRef.current?.getSnapshot().state._tag !== "Open") {
      specialDoorRef.current?.send(new Click());
    }
  };

  // Close all doors at once
  const closeAllDoors = () => {
    doorsRef.current.forEach((actor) => {
      const state = actor.getSnapshot().state._tag;
      if (state !== "Closed") {
        actor.send(new Click());
      }
    });
    if (specialDoorRef.current?.getSnapshot().state._tag !== "Closed") {
      specialDoorRef.current?.send(new Click());
    }
  };

  if (!ready) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Multi-Door Demo</h1>
          <p className="text-gray-400">
            No parent-child actors needed. React components ARE the hierarchy.
          </p>
        </div>

        {/* Control Panel */}
        <div className="bg-gray-900 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">Parent Controls</h2>

          <div className="flex flex-wrap gap-4 items-end">
            {/* Message to special door */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm text-gray-400 mb-2">
                Send message to Special Door (via actor.send)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendToSpecialDoor()}
                  placeholder="Type a message..."
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 placeholder-gray-500"
                />
                <button
                  onClick={sendToSpecialDoor}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-medium"
                >
                  Send
                </button>
              </div>
            </div>

            {/* Bulk actions */}
            <div className="flex gap-2">
              <button
                onClick={openAllDoors}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-medium"
              >
                Open All
              </button>
              <button
                onClick={closeAllDoors}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded font-medium"
              >
                Close All
              </button>
              <button
                onClick={() => specialDoorRef.current?.send(new ClearMessage())}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium"
              >
                Clear Message
              </button>
            </div>
          </div>
        </div>

        {/* Doors Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* Regular doors via items.map() */}
          {DOORS.map((door) => (
            <GarageDoor key={door.id} actor={doorsRef.current.get(door.id)!} label={door.label} />
          ))}

          {/* Special door */}
          {specialDoorRef.current && (
            <GarageDoor actor={specialDoorRef.current} label="Special" isSpecial />
          )}
        </div>

        {/* Code Example */}
        <div className="mt-8 bg-gray-900 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            How it works (no spawn/sendParent needed)
          </h2>
          <pre className="text-sm text-gray-300 overflow-x-auto">
            {`// 1. items.map() for dynamic children
{DOORS.map((door) => (
  <GarageDoor
    key={door.id}
    actor={doorsRef.current.get(door.id)!}
  />
))}

// 2. Direct actor.send() for parent→child communication
const sendToSpecialDoor = () => {
  specialDoorRef.current.send(
    new ReceiveMessage({ text: message })
  );
};

// 3. Child→parent? Just use callbacks!
<GarageDoor
  actor={actor}
  onSomething={() => parentActor.send(new Event())}
/>`}
          </pre>
        </div>
      </div>
    </div>
  );
}
