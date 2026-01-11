import { Atom } from "@effect-atom/atom-react";
import { Layer, Logger } from "effect";
import { WeatherService } from "@/lib/services/weather-service";
import { DexieService } from "@/lib/services/dexie";
import { StatePersistence } from "@/lib/services/state-persistence";
import { MachineRegistry } from "effstate";

// Base services layer
const ServicesLayer = Layer.mergeAll(
  Logger.pretty,
  WeatherService.Default,
  DexieService.Default,
  StatePersistence.Default,
);

// Machine registry layer (for service-based spawning)
const MachineLayer = MachineRegistry.Default;

// Combined app layer
// Note: Machine services (GarageDoorMachineService, HamsterWheelMachineService)
// are provided inline where needed to avoid circular imports
const AppLayer = Layer.mergeAll(
  ServicesLayer,
  MachineLayer,
);

export const appRuntime = Atom.runtime(AppLayer);
