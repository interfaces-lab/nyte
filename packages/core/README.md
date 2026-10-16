# @nyte-ai/core

Core owns durable session state and execution. `composeHost` (`@nyte-ai/core/server`) builds a host from a `Store`, the `@nyte-ai/ai` models, core plugins and a default workspace; [host](../host/README.md)'s `openHost`, which the sdk's Node `sdk.open` is, calls it with what a machine supplies. Clients do not import core: they use `@nyte-ai/sdk`, whose types are core's and schema's.

The package has four entries: [src/index.ts](src/index.ts) (`.`), the client and plugin contract; [src/store.ts](src/store.ts) (`./store`), the store-backend SPI host's stores implement; [src/server.ts](src/server.ts) (`./server`), composition and the `ServerHost` port a listener serves a composed host through; and [src/testing.ts](src/testing.ts) (`./testing`), the kernel under a composed host and the steps the tests of other packages drive by hand, outside the SDK contract. Each export's JSDoc is its contract, and the surface it implements is the baseline in [packages/lab/sdk-shape.ts](../lab/sdk-shape.ts).

A store is two primitives: immutable content-addressed objects, written before any publish, and refs, the only mutable state, published as one all-or-nothing `refs.set` batch. `memoryStore` (`./store`) is the in-process one; sqlite, postgres and Durable Object storage live in host. A head's `watch()` folds the session into one `SessionView` per change, and the sdk folds the wire's deltas with the same code, so no client derives what the view carries.

Core imports no `node:*` module, so the sdk's browser and React Native entry can load it.

## Verification

From the repository root:

```sh
pnpm --dir packages/core test
pnpm --dir packages/core typecheck
```

Read [AGENTS.md](AGENTS.md) before changing persistence or execution.
