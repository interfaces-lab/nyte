# Machine server

Nyte runs in three tiers on a machine: one server, the hosts it supervises, and the clients that use them.

```
clients: desktop app, TUI, phone, CLI, MCP agents
            │  the host protocol (README.md), unchanged
            ▼
server: nyte-server, Go, one per user per machine, the launchd agent
   ├─ front door: the local unix socket, the tailnet node (tsnet), later the Connect relay
   ├─ processes: terminals (PTYs) and agent jobs, with their output buffers
   └─ supervision: starts the host, restarts it, routes clients to it
            │  unix socket in the state directory, server ↔ host frames
            ▼
host: the TypeScript engine: store, sessions, fold, agent loop, plugins, the protocol
```

## Why three tiers

Each tier changes at a different rate, and each owns what must survive the tier above it restarting.

- **Clients** come and go all the time. Nothing they hold is authoritative; they resume from a seq.
- **The host** is updated often, with every Nyte release, and may crash. A host restart must not kill a terminal, a dev server an agent started, or the tailnet node a phone is connected through. That is the failure the two-tier shape has: whatever holds a PTY or a child process takes it down when it exits, because the kernel hangs up the PTY and the process group goes with it.
- **The server** holds those things and is updated rarely. It is small, so it rarely needs to be. When it does update, it waits until no terminal or job is running, as Rex's account servers keep their old version until their sessions end.

Rex runs this shape: its server is a Go process separate from the app, owning sessions, terminals and the tailnet node. opencode is moving the same way: its experimental `opencode-pty` daemon holds terminals so they survive a server restart.

## What each tier owns

| Fact or resource | Owner | Survives |
| --- | --- | --- |
| Sessions, the log, the fold, agent runs | host (store on disk) | everything, through the store |
| Terminals and agent jobs (processes, PTYs, output buffers) | server | host restarts and updates |
| The tailnet node and its identity | server | host restarts and updates |
| The local socket clients dial | server | host restarts and updates |
| The Connect relay | server, later | host restarts and updates |
| Which host is running, its health | server | host restarts |
| Rows a client shows | client, from the host | nothing; resumed by seq |

## The front door

Clients connect to the server's socket and tailnet address, never to a host directly. The server forwards each HTTP request and WebSocket to the host with the caller's principal in one header the host trusts only on the server's socket, as the tailnet sidecar does today. When the host is restarting, the server holds new connections for up to 10 s, then refuses them with `unavailable`; the SDK's supervisor retries. `local` operations stay local: the server marks requests from its unix socket as local and nothing else.

## Processes

The host asks the server for a terminal or a job over its socket: `open { kind: pty | pipe, argv, cwd, env, size }` returns an id; `write`, `resize`, `signal`, `close`; `read { id, from: offset }` streams output from a byte offset, so a host that restarted resumes where it was. The server reads a PTY only while its buffer has room, so a flood the host does not read blocks the program, as node-pty's pause did. Exit codes and signals are reported as frames. Processes belong to the server, not to a host instance; a job outlives the host that started it, and the next host adopts it by id from the server's list.

## Supervision

launchd runs the server (on macOS through `SMAppService` and Electron's `agentService` login item). The server starts the host as a child, restarts it with backoff when it exits, and reports its state as the menubar's status: Running, Running with Issues, Stopped. Updating Nyte replaces the host binary and asks the server to restart the host; the server itself updates only when it has no running processes, or when the user chooses to.

## Migration

1. **Server front door.** The Go sidecar becomes `nyte-server`: it owns the local socket and the tailnet node in-process, starts and supervises the host, and forwards traffic to it. launchd runs the server, not the host.
2. **Terminals in the server.** creack/pty behind the process frames above; the host's PTY jobs move there and `@lydell/node-pty` is deleted. The TUI gets terminals.
3. **Agent jobs in the server.** Non-PTY jobs move too; the invariant "jobs belong to the instance that started them" becomes "jobs belong to the server".
4. **TUI as a client.** A TUI connects to the machine's host through the server instead of running a host in-process; the relay election in `@nyte-ai/service` goes once only the server carries the relay.
5. **Windows.** Named pipes and ConPTY, after the CLI ships there.
