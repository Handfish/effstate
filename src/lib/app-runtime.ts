import { Atom } from "@effect-atom/atom-react";
import { Layer, Logger } from "effect";
import { MessagesClient } from "@/lib/api/messages-client";
import { NetworkMonitor } from "@/lib/services/network-monitor";
import { WeatherService } from "@/lib/services/weather-service";
import { MachineRegistry } from "@/lib/state-machine";

// Base services layer
const ServicesLayer = Layer.mergeAll(
  Logger.pretty,
  MessagesClient.layer,
  NetworkMonitor.Default,
  WeatherService.Default,
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
