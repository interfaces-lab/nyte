# OpenTUI rectangle clipping

OpenTUI 0.5.10 passes negative rectangle origins to the unsigned native
`bufferFillRect` API, losing the visible portion. The patch clips to the buffer
in both Bun and Node bundles; native viewport clipping still applies.
This replaces Nyte's scroll-time diff color filtering.

Remove the patch when [upstream](https://github.com/anomalyco/opentui/blob/main/packages/core/src/buffer.ts)
handles offscreen rectangles and these native tests pass without it:

```sh
pnpm --dir packages/tui exec vitest run test/render-clipping.test.ts --execArgv=--experimental-ffi
```
