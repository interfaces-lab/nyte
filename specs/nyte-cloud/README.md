# Nyte Cloud

Status: draft. Nothing here has shipped.

## Goal

A chat keeps working with every laptop closed. Each cloud chat works in its own worktree on its own branch. The agent can run a command on the Mac of whoever sent the latest message. A teammate can take the chat over, and then commands go to their Mac.

## Shape

Cursor's cloud agents and Devin, built from Nyte's own parts. The agent loop runs in one always-on cloud host. Machines only run tools, and they dial out to the host.

```
phone / web / desktop ──HTTPS, Clerk JWT──► cloud host (one per org, always on)
                                             sessions in Postgres, agent loop, models
                                             remote environment provider
                     ▲ outbound WebSocket ───┤
  Boat machine: nyte worker                  │  a cloud chat's workspace
  (local provider: files, git, LSP, pty)     │  worktree + branch per chat
                     ▲ outbound WebSocket ───┘
  someone's Mac: nyte worker                     local_bash for that person's chats
```

There is no connect broker in this path. Clients reach the cloud host directly. Machines need no inbound port.

## Specs

| Spec | What it covers |
| --- | --- |
| [00-spike](00-spike.md) | The first experiment, its measurements and its kill thresholds. Build nothing else first. |
| [01-cloud-host](01-cloud-host.md) | The always-on host: process, store, auth, where it runs |
| [02-worker](02-worker.md) | The `nyte worker` process and the relay it dials |
| [03-remote-environment](03-remote-environment.md) | The environment provider that runs a chat's tools on a worker |
| [04-machine-pool](04-machine-pool.md) | Starting and stopping machines, and the Boat adapter |
| [05-local-hands](05-local-hands.md) | A person's Mac as a worker: pairing, routing, consent |

## Decisions

| Decision | Reason | Source |
| --- | --- | --- |
| The loop runs outside the machine | Sessions stay readable and steerable while every machine sleeps, and teammates share one host | Cursor: "Cursor runs the agent loop, inference, and planning. Your worker performs file edits and terminal commands" (cursor.com/docs/cloud-agent/self-hosted). Devin: the Brain runs in Cognition's cloud, the DevBox over an outbound WebSocket (docs.devin.ai/enterprise/vpc/overview) |
| Machines dial out | No inbound port on a Mac or a Boat machine, and no broker | Cursor: "opens a long-lived outbound HTTPS connection … Cursor never connects into your network" |
| One worker binary for Boat machines and Macs | One protocol, one test surface. A Mac is Devin's "second set of tools" | docs.devin.ai/work-with-devin/local-hands |
| The worker runs Nyte's local provider | Cloud chats keep worktrees, snapshots, pty jobs and language servers unchanged | `packages/host/src/local/provider.ts` |
| Tools go through the wire ops the host already serves | Files, git, language and jobs are already wire operations, and the SDK's `Workspace` already returns `FilesApi`, `GitApi`, `LanguageApi` and `Job` | `packages/core/src/contract/workspace.ts` (`Workspace`) |
| Boat first, behind a lifecycle-only interface | Boat is cheap and allows platforms. Daytona or Namespace later means one new adapter | docs.boat.dev/pricing; boat.dev/terms TOS-8 |
| Sessions in managed Postgres, not on a machine | Boat snapshots once a minute, so a machine failure loses the last minute. With the store off the machine, the host is stateless and moves freely | docs.boat.dev/limits; `postgresStore` |
| The host decides sleep and wake | The host knows when a run and its jobs end, so no in-VM guessing like t3boat's watchdog | paukraft/t3boat `machine/watchdog.mjs` |

## Package placement

- `@nyte-ai/cloud`, a new package, holds the remote environment provider, the machine pool interface, the Boat adapter, the relay server and the cloud host's composition. It depends on `@nyte-ai/sdk`. The provider needs the SDK's `Workspace`, and `sdk` depends on `host`, so it can't live in `host`.
- `nyte worker` is a CLI command. It wraps a headless host and `RelayConnection` from `@nyte-ai/connect/host`.
- No change to `core` beyond what [05-local-hands](05-local-hands.md) keeps from the `local_bash` work.

## The `local_bash` work already in this worktree

The staged change records the sender on every send receipt and adds `ToolInvocation.sender()`. Local hands needs both, so they stay.

The client-action path is replaced by the Mac worker:

- `packages/plugin/src/machine-bridge.ts`.
- The `principal` parameter on `ClientActions`.
- `findOffering` in the host's `clients.ts`.

Delete those once [05-local-hands](05-local-hands.md) lands.

## Milestones

1. **Spike** ([00-spike](00-spike.md)). Pass or kill.
2. **One person, one repo.** Cloud host on Boat. A chat starts a machine, works in a worktree, pushes its branch, and the machine sleeps after the run. Laptop closed throughout.
3. **Local hands.** `local_bash` to the sender's Mac worker.
4. **Teams.** Clerk organisations own a cloud host. Handoff routes `local_bash` to the new sender.
5. **Billing.** Plans through Clerk, metered from Boat's usage API.

## Open questions

- One machine per chat, or per person and repo with a worktree per chat? This spec picks per person and repo, because Boat caps starts per account per day (200 on the $20 plan, 2,400 on the $2,000 plan) and a shared machine keeps caches warm. Revisit after the spike.
- What happens to unpushed work when Boat drops a stopped disk after 14 days? Either push a work-in-progress branch before every stop, or resume machines with unpushed work every 12 days.
- When the sender's Mac is offline, does `local_bash` fail at once (the default here) or wait for it?
