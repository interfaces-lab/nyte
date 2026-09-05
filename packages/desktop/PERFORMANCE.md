# Desktop performance

The desktop app treats startup and thread navigation as paint problems. It shows the right page
first, then fills that page with local data. Local storage is fast, but waiting for every local read,
React module, and formatter before changing the screen still feels slow.

This note records the design after the 2026-09-03 first-shell pass. It supplements the core
[design record](../docs/content/docs/design.mdx). That record still owns SDK and storage contracts.

## Result

Seven isolated cold launches before the shell-first start-page revision produced these median
timings on the development machine:

| Milestone | Median |
| --- | ---: |
| First contentful paint | 463.8 ms |
| React ready | 487.1 ms |

Those timings are historical rather than a current startup measure. The renderer no longer paints
a substitute HTML shell, so they do not describe the current first React frame.

The current production build emits:

| Entry | Size |
| --- | ---: |
| Electron main | 3.3 KiB |
| Preload | 2.6 KiB |
| Renderer entry | 791.9 KiB |

These numbers are a dated result, not a promise across machines. The temporary timing harness was
removed after the measurements. `scripts/check-startup-bundle.mjs` remains because it is a build
guard, not a benchmark. It fails a normal desktop build if a startup entry crosses its size budget.

## Startup path

The startup path has three phases.

1. Electron creates the window.
2. React mounts the permanent titlebar, sidebar, stage, and New Chat input.
3. The router and local queries fill data into that mounted app.

`src/renderer/index.html` contains only the React root. Electron's native background color and the
root CSS background cover the short interval before JavaScript runs without duplicating app chrome.
The renderer mounts React without awaiting TanStack Router. The shell lives outside route matches,
so route validation can only hold the center's dynamic destination, never the window chrome.

The workspace stage imports the normal conversation screen eagerly. New Chat therefore paints its
real textarea and fixed controls with the shell. Host state keeps the input disabled until the
workspace identity is known, while models, sessions, workspaces, and VCS data fill their reserved
places. The model trigger remains mounted and disabled while its catalog loads.

The Electron entry also stays narrow. `src/main/index.ts` creates the window and registers IPC, but
it imports the desktop host and IPC decoders only when the renderer makes its first call. Opening the
window therefore does not open a workspace, compose plugins, initialize the SDK, or load input
validation code.

The preload exposes the typed SDK bridge and writes the platform marker used by first-frame chrome.
Startup profiling, measurement events, and benchmark-only environment switches are not shipped.

Queries start independently with the first React commit. The shell renders while host state,
workspaces, sessions, and models cross local IPC. A workspace change refills related caches in
parallel and commits host state last, so the mounted workspace shell does not observe a
half-switched cache.

## Thread navigation

A thread click changes the route immediately. It never waits for a snapshot.

The React shell keeps the titlebar, sidebar, pane controller, and conversation stage mounted outside
route resolution. The stage is eager, while transcript presentation remains deferred. Blank/session
route markers update the active pane without an async screen boundary, so a click cannot expose a
route fallback or recreate pane and workbench owners.

Pointer intent uses `warmThread` to read the coherent session snapshot into TanStack Query.

A 50 ms hover delay avoids work while the pointer crosses the list. Pointer down and keyboard focus
skip the delay. The click still navigates if either warm operation is unfinished or fails.

The thread page reads one `SessionSnapshot`. That snapshot carries the transcript, pending messages,
context, session metadata, and its sequence cursor. Cached data paints immediately. Data older than
one second refreshes behind the page. The composer remains disabled until a valid snapshot arrives,
which avoids accepting input for an unverified route id.

Pane hosts are keyed by stable `PaneId` values, never by `SessionId`. The desktop pane controller
restores each session's composer, scroll, and workbench state when a host selects it again. Route
strings become branded `SessionId` values at the route boundary. IPC payloads enter as `unknown` and
are narrowed in the preload or renderer boundary. Event switches use exhaustive `never` cases.

## Live updates

The initial snapshot sequence is the watch cursor. Events committed after that sequence cannot fall
between the snapshot and subscription.

Durable events request another coherent snapshot. Refreshes for one session are coalesced into one
read in flight and at most one trailing read. If an event names a newer sequence, refresh continues
until the snapshot reaches it. This avoids both refresh storms and stale final state.

Streaming text, reasoning, and tool progress remain an in-memory overlay keyed by stable part
identity. The overlay stays visible until a settled snapshot contains the entry, so a stream does not
blink out between its final delta and the local database read. Store notifications are grouped into
one animation frame.

## Work deferred from thread clicks

The pane frame and composer are eager. Markdown, reasoning, and tool-turn presentation load only
when a session has content to render; the session composer stays mounted while that module arrives.

Syntax highlighting was the largest avoidable thread cost. The Shiki grammar and theme module is
about 2.6 MiB, so it remains outside the renderer entry.

Code fences first render as escaped plain text. A block within 300 px of the viewport queues syntax
highlighting during idle time. The shared queue processes one job per frame. If the highlighter cannot
load, the plain code remains usable.

Workbench data follows the same rule. The rail geometry appears with the thread, but change lists,
repository status, and individual diffs load only after the snapshot is ready or the user opens the
panel.

We did not add transcript virtualization. It changes browser find, text selection, accessibility,
scroll anchoring, and component state. The measured costs came from route code, blocking reads, and
syntax grammars. Adding virtualization without evidence would trade known behavior for speculative
speed.

## Rules that keep it fast

- The visible shell must not wait for local data.
- Navigation must not await warming or snapshots.
- Boot HTML must not duplicate React chrome.
- Heavy formatters and secondary panels load on visibility or intent.
- One coherent snapshot is the settled source of truth. Live data is a disposable overlay.
- New startup imports must fit the build budgets in `scripts/check-startup-bundle.mjs`.
- Measure a suspected regression with a purpose-built trace, fix it, record the result here, then
  remove the temporary measurement path.
