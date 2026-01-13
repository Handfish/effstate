import { GarageDoor } from "@/components/GarageDoor";
import { HamsterWheel } from "@/components/HamsterWheel";

export default function App() {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Zustand Implementation</h1>
          <p className="text-gray-400">
            Same functionality as EffState v3, using Zustand
          </p>
        </div>

        {/* Demos */}
        <div className="grid md:grid-cols-2 gap-8 mb-12">
          <GarageDoor />
          <HamsterWheel />
        </div>

        {/* Code Comparison */}
        <div className="space-y-8">
          <h2 className="text-2xl font-bold text-center">Code Comparison</h2>

          {/* Hamster Wheel Comparison */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-amber-400 mb-3">
                Zustand Hamster (48 lines)
              </h3>
              <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
{`type HamsterState = "idle" | "running" | "stopping";

const useHamsterStore = create((set, get) => ({
  state: "idle",
  wheelRotation: 0,
  electricityLevel: 0,
  _stopTimer: null,

  toggle: () => {
    const { state, _stopTimer } = get();
    switch (state) {
      case "idle":
        set({ state: "running", electricityLevel: 100 });
        break;
      case "running":
        if (_stopTimer) clearTimeout(_stopTimer);
        const timer = setTimeout(() =>
          get()._completeStop(), 2000);
        set({ state: "stopping", _stopTimer: timer });
        break;
      case "stopping":
        if (_stopTimer) clearTimeout(_stopTimer);
        set({ state: "running", electricityLevel: 100 });
        break;
    }
  },

  tick: (delta) => {
    if (get().state === "running") {
      set(s => ({
        wheelRotation: (s.wheelRotation + delta) % 360
      }));
    }
  },

  _completeStop: () => set({
    state: "idle",
    electricityLevel: 0
  }),
}));

// Animation in component:
useEffect(() => {
  if (state === "running") {
    const interval = setInterval(() => tick(5), 16);
    return () => clearInterval(interval);
  }
}, [state]);`}
              </pre>
            </div>

            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-purple-400 mb-3">
                EffState v3 Hamster (45 lines)
              </h3>
              <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
{`type HamsterState =
  | { _tag: "Idle" }
  | { _tag: "Running"; startedAt: Date }
  | { _tag: "Stopping"; stoppingAt: Date };

class Toggle extends Data.TaggedClass("Toggle")<{}> {}
class HamsterTick extends Data.TaggedClass("HamsterTick")<{
  delta: number
}> {}
class StopComplete extends Data.TaggedClass("StopComplete")<{}> {}

const tickStream = Stream.fromSchedule(
  Schedule.spaced(Duration.millis(16))
).pipe(Stream.map(() => new HamsterTick({ delta: 5 })));

const stopDelayStream = Stream.fromEffect(
  Effect.sleep(Duration.seconds(2))
).pipe(Stream.map(() => new StopComplete()));

const hamsterMachine = defineMachine({
  initialState: HamsterState.Idle(),
  initialContext: { wheelRotation: 0, electricityLevel: 0 },

  states: {
    Idle: {
      on: {
        Toggle: () => ({
          goto: HamsterState.Running(new Date()),
          update: { electricityLevel: 100 }
        }),
      },
    },
    Running: {
      run: tickStream,  // Animation built-in!
      on: {
        Toggle: () => ({ goto: HamsterState.Stopping(new Date()) }),
        HamsterTick: (ctx, e) => ({
          update: { wheelRotation: (ctx.wheelRotation + e.delta) % 360 }
        }),
      },
    },
    Stopping: {
      run: stopDelayStream,  // Delay built-in!
      on: {
        Toggle: () => ({
          goto: HamsterState.Running(new Date()),
          update: { electricityLevel: 100 }
        }),
        StopComplete: () => ({
          goto: HamsterState.Idle(),
          update: { electricityLevel: 0 }
        }),
      },
    },
  },
});`}
              </pre>
            </div>
          </div>

          {/* Key Differences */}
          <div className="bg-gray-900 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Key Differences</h3>
            <div className="grid md:grid-cols-2 gap-6 text-sm">
              <div>
                <h4 className="font-medium text-amber-400 mb-2">Zustand Pros</h4>
                <ul className="space-y-1 text-gray-300">
                  <li>• Familiar React patterns</li>
                  <li>• No Effect dependency</li>
                  <li>• Simple get()/set() API</li>
                  <li>• Easy to learn</li>
                  <li>• Less ceremony for simple state</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-purple-400 mb-2">EffState v3 Pros</h4>
                <ul className="space-y-1 text-gray-300">
                  <li>• States with data (startedAt, stoppingAt)</li>
                  <li>• Animation/timers built into machine</li>
                  <li>• Prevents impossible transitions (compile-time)</li>
                  <li>• Visualizable state diagram</li>
                  <li>• Persistence adapters (Dexie, etc.)</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-700">
              <h4 className="font-medium text-gray-200 mb-2">The Real Trade-off</h4>
              <p className="text-gray-400 text-sm">
                Zustand: Animation loop lives in the component (useEffect).<br/>
                v3: Animation stream lives in the machine definition.<br/><br/>
                For UI-heavy apps with simple state → Zustand wins on simplicity.<br/>
                For complex flows with persistence needs → v3 wins on structure.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
