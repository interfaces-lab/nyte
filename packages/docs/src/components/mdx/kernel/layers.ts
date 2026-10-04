import type { Layer } from "./figures";

export const LAYERS: readonly Layer[] = [
  {
    name: "Client",
    icon: "computer",
    files: "@nyte-ai/client",
    role: "Sends messages, stops runs, answers parked calls. Folds the event log into session state.",
    href: "/kernel/events",
  },
  {
    name: "SDK",
    icon: "code-brackets",
    files: "sdk/nyte.ts, sdk/session-pool.ts",
    role: "`createNyte`. Queues input, reads state, and keeps one runner per attached session.",
    href: "/kernel/life-of-a-message",
  },
  {
    name: "Runner",
    icon: "refresh",
    files: "sdk/runner.ts, sdk/advance.ts",
    role: "One loop per session per host. A ref event that names a head wakes it, and a wake drives the head until it rests.",
    href: "/kernel/runner",
  },
  {
    name: "Step",
    icon: "arrow-right",
    files: "step.ts, admission.ts, queue.ts",
    role: "Holds the head lease. Reads the refs, advances the run by one phase, publishes by CAS.",
    href: "/kernel/step",
  },
  {
    name: "Turn",
    icon: "sparkle",
    files: "turn.ts, effects.ts, loop/",
    role: "One model request or one tool batch: prompt declaration, checkpoints, retries, durable tool effects.",
    href: "/kernel/respond",
  },
  {
    name: "Plugins",
    icon: "apps",
    files: "../plugins/, sdk/activation.ts",
    role: "Beside the turn. Tools it can call, hooks that intercept it on a wall-clock budget, and the providers that open workspaces.",
    href: "/kernel/plugins",
  },
  {
    name: "Store",
    icon: "server",
    files: "store.ts, sqlite.ts, postgres/",
    role: "Objects, refs, leases, events. The only state two hosts share.",
    href: "/kernel/store",
  },
];
