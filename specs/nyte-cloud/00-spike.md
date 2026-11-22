# 00 Spike: is a remote environment fast enough?

Build this before anything else. It decides between this design and the fallback, which runs the whole host inside the Boat machine.

## Question

With the loop on a cloud host and the tools on a Boat worker, do tool calls and wake-ups stay fast enough that a cloud chat feels like a local one?

## Setup

- **Cloud host.** One Boat `small` machine, auto-stop off (`ttlSeconds: null`), serving `https://<id>-<port>.on.boat.dev`. For the spike, a SQLite store on that machine is fine.
- **Worker.** One Boat `default` machine, created from a saved snapshot with `nyte` installed and this repository cloned. Created with `noEnv: true`.
- **Relay.** The worker dials the host with `RelayConnection` (`packages/connect/src/host/relay.ts`). The host terminates the relay with a minimal server built from the frame types in `@nyte-ai/connect/relay`.
- **Remote provider.** It implements only `files.read` and `exec`, through `connection.workspace(id).files()` and `jobs.start` / `job.output` on the relayed connection.
- **Agent.** A scripted model from `@nyte-ai/bench` that calls `read` and `bash`, so model latency stays out of the numbers.

Both machines are in Boat's EU regions. Boat doesn't let you pick the region.

## Measurements

Record every sample. Report the median and the 95th percentile with the count.

| Id | What | Samples |
| --- | --- | --- |
| M1 | `read` of a 4 KB file, from the tool call to its result | 200 |
| M2 | `bash` running `true`, from the tool call to the exit code | 100 |
| M3 | `bash` running `rg -l TODO` across this repository, to the exit code | 30 |
| M4 | Cold wake: from a message to a stopped machine until the worker's relay is connected | 10, each after more than 10 minutes stopped |
| M5 | Warm wake: the same, within 10 minutes of the stop (Boat keeps the machine warm then) | 10 |
| M6 | The same as M1 and M2 with a local provider on the same machine, as the baseline | 200 / 100 |

## Pass and kill

| | Pass | Kill |
| --- | --- | --- |
| M1 median | under 150 ms | over 300 ms |
| M2 median | under 250 ms | over 500 ms |
| M3 | within 1.5× of M6's equivalent | over 3× |
| M4 median | under 10 s | over 30 s |
| M5 median | under 4 s | over 10 s |
| Relay after a resume | reconnects every time, despite the new IP | any run that never reconnects |

Between pass and kill, the next step is to find what limits the number (the relay hop, Boat's network, or the host) before deciding.

If the spike passes, continue with this design. If it fails on M1 to M3, the fallback is the linked-host shape: the whole `nyte host` runs on the machine. If it fails on M4 or M5, Boat is the problem and the same test runs on another provider.

## Out of scope

Auth, Postgres, worktrees, git push, Macs, billing. Throw the spike code away. Keep the measurement script and its output.
