# Core

- Own session state and execution here; clients consume this behavior through `@nyte-ai/sdk`.
- Each export's JSDoc is its contract; the surface it implements is the baseline in [packages/lab/sdk-shape.ts](../lab/sdk-shape.ts).
- Keep core free of `node:*` imports so the sdk's browser and React Native entry can load it. Node code belongs in `@nyte-ai/host`.
- Keep shared code compatible with Node and Bun; do not introduce Bun-only APIs.
- Test against the memory store with scripted providers. Assert persisted
  state and observable views, including cancellation and recovery when affected.
