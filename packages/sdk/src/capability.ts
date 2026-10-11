import type { Capability, CapabilityWire } from "@nyte-ai/schema";

/** Rebuilds a capability from its wire answer (§40m): `available` gains the api `bind` returns, bound at once with no I/O; every other answer, with its reason and retry, is the capability as is. */
export function capabilityOf<T>(wire: CapabilityWire, bind: () => T): Capability<T> {
  return wire.kind === "available" ? { kind: "available", api: bind() } : wire;
}
