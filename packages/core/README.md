# @nyte-ai/core

Core owns durable session state and execution. You use it directly only to build a host. Clients use `@nyte-ai/sdk`, whose types come from core and `@nyte-ai/schema`.

## Quick start

`composeHost` builds a host from a `Store`, a `Models` from `@nyte-ai/ai`, core plugins and a default workspace:

```ts
import { createModels } from "@nyte-ai/ai/models";
import { InMemoryCredentialStore } from "@nyte-ai/ai/auth/credential-store";
import { composeHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import { chatOnlyProvider } from "@nyte-ai/host/providers";

const host = await composeHost({
  store: memoryStore(),
  models: createModels({ credentials: new InMemoryCredentialStore() }),
  plugins: [{ id: "chat-only", environment: chatOnlyProvider() }],
  workspace: { kind: "chat-only", locator: null },
  home: null,
  description: { name: "my-host", platform: "node", version: "0.1.0" },
});
```

On a machine, `openHost` in [`@nyte-ai/host`](../host/README.md) calls `composeHost` with that machine's store, models and workspace. The sdk's Node `sdk.open` is `openHost`.

## Entry points

| Entry | What it holds |
| --- | --- |
| `@nyte-ai/core` | The client and plugin contract, and the `Store` interface that store backends implement |
| `@nyte-ai/core/store` | `memoryStore`, and the record decoders, ref names and migrations that store backends share |
| `@nyte-ai/core/server` | `composeHost`, and the `ServerHost` interface that a listener serves a composed host through |
| `@nyte-ai/core/testing` | The kernel under a composed host, the steps other packages' tests drive by hand, and the scripted-turn helpers core's tests share. It is outside the SDK contract. |

## How it works

A store holds two kinds of data. Objects are immutable and content-addressed, and core writes them before any publish. Refs are the only mutable state, and core publishes them in one all-or-nothing `refs.set` batch. `memoryStore` keeps both in process. The SQLite, PostgreSQL and Durable Object stores live in `@nyte-ai/host`.

Core folds a session's log into its current state. `Head.view()` answers one `SessionView` from that fold. Clients in another process read rows and apply change events instead, as the [host protocol](../../docs/host-protocol/README.md) describes.

Core imports no `node:*` module, so the sdk's browser and React Native entry can load it.

## Development

```sh
pnpm --dir packages/core test
pnpm --dir packages/core typecheck
```

Read [AGENTS.md](AGENTS.md) before changing persistence or execution.
