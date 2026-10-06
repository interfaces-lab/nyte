# Inline canvas lab

Run `pnpm --dir packages/lab dev`, then open `/canvas`.
The page starts in Demo. Replay plays two scripted turns, each with a canvas
above its final reply. Demo compiles its TSX through the lab server and never
opens core or calls a model. These routes exist only in the dev server, not in
the static build.

Turn Demo off and send a message for a live session. Sign in with `nyte` first.
Canvas sessions are named `canvas …` and explicitly configured with
`openai-codex/gpt-6-luna`. Set `NYTE_LAB_CANVAS_MODEL=provider/id` before starting
the server to override it. The Review host's `NYTE_LAB_MODEL` selection and
review run configurations are unchanged.

## Milestones

1. **SDK, runtime and compiler.** `sdk.tsx` provides dependency-free SVG charts:
   BarChart, LineChart with area and points, and PieChart with a pixel donut
   radius. `runtime.tsx` bundles React 19, ReactDOM, SDK and mount/error handling
   into one production classic IIFE. `server/canvas.ts` builds and caches that
   runtime in memory. It transforms TSX with Vite's Oxc wrapper and bundles
   the module as an IIFE with runtime globals. The bundler's parser checks
   original imports, including type-only imports. Invalid imports, syntax,
   dynamic imports and missing default exports return repair instructions
   with line information.
2. **Plugin.** `server/canvas-plugin.ts` receives `compile` and `store` from its
   host. It contributes a short prompt nudge and the safe-replay `canvas` tool.
   `labPlugins` routes `canvas ` names before the author/reviewer branches,
   installing the filesystem tools and canvas tool. The reviewer prompt and
   tool definitions remain byte-identical.
3. **Routes and snapshots.** Successful publications are stored atomically as
   `{id,title,code,runtime:1}` at `CACHE_DIR/canvases/<sha256>.json`. Tool output
   starts with `canvas:<id>` because projected tool parts expose neither args
   nor details. Plugin resources list skills, not arbitrary payloads, and
   plugin storage has no client read API. `/core/canvas/runtime.js`, `/compile`
   and `/<id>` do not open core. `/session` opens real core, resolves the canvas
   model and pins the session before a message is sent. The client sends and
   watches through `/core/nyte`.
4. **Frame.** `frame.tsx` uses `sandbox="allow-scripts"`, without same-origin
   rights. Its srcdoc loads the classic runtime by absolute script URL, so no
   null-origin CORS exception is needed. CSP blocks connections, external
   images, forms and other resources. The runtime inserts the compiled code
   as an inline script. A hidden token-styled probe supplies resolved colours
   and font through validated postMessages. Appearance mutations and system
   appearance changes update these variables. Height and render-error reports
   are accepted only from that iframe's contentWindow and validated before
   use. The SDK and frame document use CSS variables outside host StyleX.
5. **Transcript.** `turn.tsx` recognises successful Canvas tool parts by label
   and output marker. It splits trailing assistant parts from the working
   parts, rendering TurnView, canvases, then TurnView for the final reply.
   Both TurnViews receive `continuations`. `demo.ts` creates projected turns
   with IDs returned by the same compile/store route that serves live output.
   The live composer, session snapshot and event watch use real app/client
   components and APIs.

## Checks

Deleted throwaway scripts built the runtime, compiled valid TSX and rejected
invalid examples, checked runtime caching and snapshot retrieval without
opening core, and rendered compiled bar, line and donut modules through the
real SDK with `react-dom/server`. Demo reveal steps and ID markers were also
checked. A byte comparison checked the unchanged reviewer definitions.

The lab production build passes. Canvas UI and server files pass typechecking
and lint. The full lab typecheck still has the existing Review and router
errors; root lint has unrelated errors. No dev server was started.

Live inference, browser sandbox loading, iframe resize/error handling,
appearance changes and visual placement still need a browser check. Publication
currently checks compilation, not server-side rendering; runtime errors are
reported by the frame. Live session IDs survive in core but the page does not
restore a session after switching modes or reloading.

## Moving to desktop

- Register `canvasPlugin({compile,store})` in desktop `extraPlugins`, with a
  desktop compiler and durable snapshot store. The plugin has no Vite dependency.
- Serve the bundled runtime and snapshots through a desktop-owned route or
  custom scheme. Keep the frame opaque and do not add null-origin access to
  the authenticated core wire.
- Add an inline artefact slot to app TurnBody immediately before ResponseView,
  outside StepGroupView. The app should resolve Canvas tool markers and render
  frames there, including continuation turns, instead of splitting a turn into
  two TurnViews as the lab does. No core/protocol change is needed.
