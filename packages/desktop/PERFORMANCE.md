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

Those timings are historical rather than a measure of the current startup shell or first React frame.

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

1. Electron creates the window and the inline HTML startup shell paints.
2. Local resources seed the query cache, TanStack Router resolves the initial stage route, and that
   route's chat snapshot is read into the cache.
3. `src/renderer/src/main.tsx` mounts the titlebar, sidebar, and pane owners once, replacing the
   startup shell with a frame that already shows every folder's chats and the last chat's transcript.

The startup shell is the loading state. Mounting React earlier would paint a sidebar reading
"Loading…" and an empty stage, then fill both in; holding the shell until the caches are full means
the first React frame is the finished one. The chat warm is bounded to 1.5 s so an unreadable or very
large transcript paints behind the mounted screen instead of holding it.

`src/renderer/index.html` carries a draggable titlebar strip and an ASCII moon with no visible loading
copy or wordmark. A visually hidden "Loading" provides screen-reader status. Twelve frames share one
CSS grid cell and switch every 100 ms, waxing from crescent to full and back without an empty phase.
The 23-column by 12-row disc uses 12 px system monospace at 1.15 line-height. Reduced motion pins the
first, near-quarter frame. The moon is amber `#a35f00` in light mode and yellow `#ffc663` in dark mode.
Inline CSS supplies fallback app colors until the theme tokens load; the OS color scheme applies
until the boot module reads the stored preference. No shell scripts, fonts, or external assets are
needed for this first paint.

If initial resource or router loading rejects, the startup shell shows one short error line and a Try
again button in place of the moon; nothing has mounted yet. Once resources load, TanStack Router
uses the seeded session directory for the configured last-chat redirect. The React shell lives
outside route matches, so route validation holds only the center's dynamic destination, not the
window chrome.

The workspace stage imports the conversation screen eagerly. Once the initial route resolves,
New Chat paints its real textarea and controls without another module load. Host state keeps the
input disabled until the workspace identity is known. The model trigger remains mounted and disabled
while its catalog loads.

The Electron entry also stays narrow. `src/main/index.ts` creates the window and registers IPC, but
it imports the desktop host and IPC decoders only when the renderer makes its first call. Opening the
window therefore does not open a workspace, compose plugins, initialize the SDK, or load input
validation code.

The preload exposes the typed SDK bridge and writes the platform marker used by first-frame chrome.
Startup profiling, measurement events, and benchmark-only environment switches are not shipped.

The initial resource load seeds query caches before the first route resolves. It waits for host
state, the workspace list, the model catalog, and the session directory; the plugin catalog, which
activates the folder's plugins on its first read, fills the composer's suggestions behind the
mounted screen instead.

The session directory read composes each folder's store under the host's lifecycle lock but lists
sessions outside it, so a 5 s poll never blocks a folder switch. Core keeps each session's directory
row keyed by its event cursor, so a poll over an unchanged store costs one cursor read per session
rather than a walk of every main branch; on a 1 GB store that is 1 ms instead of ~1 s, which is
what kept the store worker busy under a chat click. The first list after launch still walks every
branch, behind the startup shell. The connected server's list runs
beside the local reads with a 1.5 s budget; past it the directory answers with the last server list
and its last availability while the read continues for the next poll, so an unreachable server never
holds startup or the sidebar behind its request timeout.

A folder switch commits the host's answer to the query cache as soon as `openWorkspace` returns,
and only then selects the folder's pane and navigates. The `workspace_opened` event refills the
folder's caches in parallel behind the mounted screen and commits host state last, so a new chat in
another folder never waits on a directory read or a plugin activation. A folder the host opened on
its own, from Open folder… or a trust grant, has the current route applied to its controller once
those caches land.

## Thread navigation

A thread click changes the route immediately. It never waits for a snapshot.

The React shell keeps the titlebar, sidebar, pane controller, and conversation stage mounted outside
route resolution. The stage is eager, while transcript presentation remains deferred. Blank/session
route markers update the active pane without an async screen boundary, so a click cannot expose a
route fallback or recreate pane and workbench owners.

Pointer intent calls `router.preloadRoute`, so it runs the same session check and coherent snapshot
warm used by navigation. The session check reads through TanStack Query. Navigation reuses a
successful preload instead of issuing another SDK read.

A 50 ms hover delay avoids work while the pointer crosses the list. Pointer down and keyboard focus
skip the delay. The click still navigates if either warm operation is unfinished or fails.

The thread page reads one `SessionSnapshot`. That snapshot carries the transcript, pending messages,
context, session metadata, and its sequence cursor. Cached data paints immediately, and the page's
own observer re-reads behind it. The composer remains disabled until a valid snapshot arrives, which
avoids accepting input for an unverified route id.

A warm reads nothing while the cached snapshot still matches the session's directory row: same head
tip, same last activity, no run in progress. The 5 s directory poll and live observations keep that
row current, so hovering across unchanged chats, and the sidebar's neighbour preloads on every poll,
cost no IPC. A row that disagrees, for example a chat the TUI advanced, is read again on the next
intent; a session without a cached row falls back to a one-second freshness window.

Pane hosts are keyed by stable `PaneId` values, never by `SessionId`. The desktop pane controller
restores each session's composer, scroll, and workbench state when a host selects it again. Route
strings become branded `SessionId` values at the route boundary. IPC payloads enter as `unknown` and
are narrowed in the preload or renderer boundary. Event switches use exhaustive `never` cases.

## Live updates

The initial snapshot sequence is the watch cursor. Events committed after that sequence cannot fall
between the snapshot and subscription.

Snapshot refreshes share one read in flight and the highest required sequence. A snapshot covering
a head move also covers its same-sequence commits. Effect intents need no snapshot refresh. Tool
results and terminal runs refresh Git and filename data. Progress events leave the child-session
list alone. Manual refreshes still cover all of these reads.

Core's observer leaves the watch the moment its fold cannot apply an event, so that event and
anything queued behind it never reach a subscriber. The snapshot that repairs the state says what
the session holds, not what changed on the way, so it stands in for the reads those events would
have driven. Its cursor decides: a snapshot past the newest sequence the observation has seen owes
that work, while a retry that re-reads the same cursor owes nothing. Without that test a dropped
stream would rescan the workspace once a second, each scan cancelling the one before it.

Declared file changes are not among them. They are folded out of the snapshot the screen already
holds, with core's own `changesFromTurns`, so the transcript that paints a turn is the transcript
that counts its changed files. There is no second read to invalidate and nothing to go stale
between them.

Streaming text, reasoning, and tool progress remain an in-memory overlay keyed by stable part
identity. The overlay stays visible until a settled snapshot contains the entry, so a stream does not
blink out between its final delta and the local database read. Store notifications are grouped into
one animation frame.

A chat's snapshot is kept for an hour after its last reader leaves, rather than the five minutes
TanStack Query defaults to, so returning to a chat in the same sitting paints from cache. Only a
chat that was opened earns that: a hover warm writes the same key through `prefetchQuery` and keeps
the default, so speculative reads still expire.

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

`TranscriptPlane` isolates TanStack Virtual's mutable instance from its React Compiler parent.
Stable row keys preserve measurements. The virtualizer owns container height and row offsets through
`directDomUpdates` in `position` mode, preserving sticky prompts without React rewriting geometry.
Its container ref replaces the duplicate plane ref. React updates when content, the visible range,
or scrolling state changes.

## Rules that keep it fast

- The visible shell must not wait for local data.
- Navigation must not await warming or snapshots.
- Boot HTML must not duplicate React chrome.
- Heavy formatters and secondary panels load on visibility or intent.
- One coherent snapshot is the settled source of truth. Live data is a disposable overlay.
- New startup imports must fit the build budgets in `scripts/check-startup-bundle.mjs`.
- Measure a suspected regression with a purpose-built trace, fix it, record the result here, then
  remove the temporary measurement path.
