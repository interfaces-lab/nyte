/**
 * The server as one lifecycle, the way the redesign proposes the host report it: off, or running
 * since a moment with an address that resolves on its own. Reach is a preference beside it, not a
 * second switch, so there is no "turn the other one off first".
 */

export type Reach = "tailnet" | "cloudflare";

export type Address =
  | { readonly kind: "resolving" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "failed"; readonly message: string };

export type Server =
  | { readonly kind: "off" }
  | { readonly kind: "running"; readonly since: number; readonly address: Address };

/** What the simulated network does when an address resolves. */
export type Scenario = "healthy" | "unreachable";

export interface World {
  readonly reach: Reach;
  readonly server: Server;
}

export type Action =
  | { readonly kind: "start"; readonly now: number }
  | { readonly kind: "stop" }
  | { readonly kind: "retry" }
  | { readonly kind: "resolve"; readonly scenario: Scenario }
  | { readonly kind: "reach"; readonly reach: Reach; readonly now: number }
  | { readonly kind: "reset"; readonly world: World };

export const REACHES = [
  { value: "tailnet", label: "Tailscale" },
  { value: "cloudflare", label: "Cloudflare Tunnel" },
] as const satisfies readonly { readonly value: Reach; readonly label: string }[];

const ADDRESSES = {
  tailnet: "https://studio.tail4e2a.ts.net",
  cloudflare: "https://nyte.example.com",
} as const satisfies Record<Reach, string>;

const FAILURES = {
  tailnet: "Tailscale isn't running on this Mac. Open it, then try again.",
  cloudflare: "cloudflared stopped and didn't come back.",
} as const satisfies Record<Reach, string>;

const RESOLVING: Address = { kind: "resolving" };

/** Each reach listens with its own auth, so switching reach restarts a running server. */
export function reduce(world: World, action: Action): World {
  switch (action.kind) {
    case "start":
      if (world.server.kind === "running") return world;

      return { ...world, server: { kind: "running", since: action.now, address: RESOLVING } };
    case "stop":
      return { ...world, server: { kind: "off" } };
    case "retry":
      if (world.server.kind !== "running") return world;

      return { ...world, server: { ...world.server, address: RESOLVING } };
    case "resolve":
      if (world.server.kind !== "running" || world.server.address.kind !== "resolving")
        return world;

      return {
        ...world,
        server: {
          ...world.server,
          address:
            action.scenario === "healthy"
              ? { kind: "ready", url: ADDRESSES[world.reach] }
              : { kind: "failed", message: FAILURES[world.reach] },
        },
      };
    case "reach":
      if (action.reach === world.reach) return world;

      return {
        reach: action.reach,
        server:
          world.server.kind === "running"
            ? { kind: "running", since: action.now, address: RESOLVING }
            : world.server,
      };
    case "reset":
      return action.world;
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}

/** The poster: a server that has been up a while, its address ready to pair. */
export function poster(): World {
  const now = Date.now();

  return {
    reach: "tailnet",
    server: {
      kind: "running",
      since: now - (2 * 60 + 14) * 60_000,
      address: { kind: "ready", url: ADDRESSES.tailnet },
    },
  };
}

export const OFF: World = { reach: "tailnet", server: { kind: "off" } };

export function reachLabel(reach: Reach): string {
  return reach === "tailnet" ? "Tailscale" : "Cloudflare Tunnel";
}

/** "less than a minute", "3 minutes", "2 hours", "4 days". */
export function uptime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);

  if (minutes < 1) return "less than a minute";

  if (minutes < 60) return count(minutes, "minute");

  const hours = Math.floor(minutes / 60);

  return hours < 24 ? count(hours, "hour") : count(Math.floor(hours / 24), "day");
}

function count(value: number, unit: string): string {
  return `${String(value)} ${unit}${value === 1 ? "" : "s"}`;
}
