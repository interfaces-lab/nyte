import type { Capability, CapabilityWire } from "@nyte-ai/schema";

export function resolveCapability<T>(wire: CapabilityWire, bind: () => T): Capability<T> {
  return wire.kind === "available" ? { kind: "available", api: bind() } : wire;
}
