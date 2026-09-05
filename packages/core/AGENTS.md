# Core

- Own session state and execution here; clients consume this behavior.
- Before changing durable behavior, read [src/kernel/README.md](src/kernel/README.md).
- Keep shared code compatible with Node and Bun; do not introduce Bun-only APIs.
- Test against real temporary SQLite stores with scripted providers. Assert persisted
  state and observable events, including cancellation and recovery when affected.
