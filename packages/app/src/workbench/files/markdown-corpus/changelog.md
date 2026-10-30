# Changelog

## v0.0.24 — 2026-10-22

- [`1ee7807`](https://github.com/interfaces-lab/nyte/commit/1ee78070bab0a7b8ee262e1a1a2b0265cdacc1c1) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - The chat stays at its newest message while a reply streams, and stays put while you read: a clicked toggle, an open message editor or a text selection no longer jumps away when rows above them resize. The Files Changed footer keeps one height, Review opens the Changes tab, and Escape cancels a message edit.
  
  Nightly builds and update channels: switch an installation to nightly updates, and back to stable with `nyte update <version>`. Remote hosts outside development require HTTPS.
  
  Breaking: `nyte serve` and the desktop's This Mac only remote access option are removed.

## v0.0.23 — 2026-10-21

- [#11](https://github.com/interfaces-lab/nyte/pull/11) [`ad65018`](https://github.com/interfaces-lab/nyte/commit/ad65018b1c7b03bae110c3cb6b013c38a5b113dd) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - A chat does far less rendering work while several agents run. An agent's update redraws only its own card instead of the whole conversation and composer, and streamed output reaches the screen at most once a frame. A lone agent's card keeps its spinner when a second agent joins, the Agents tray shows its frame before the agent's transcript loads, and closing a tray no longer makes the Agents pill jump.
- [#12](https://github.com/interfaces-lab/nyte/pull/12) [`b52f54a`](https://github.com/interfaces-lab/nyte/commit/b52f54aeb7dc5cd035d08306d07899b9f6085249) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - Skills whose `description` is a folded or literal YAML block (`>` or `|`) now show their text instead of the symbol, and skill directories that are symlinks are discovered; links that are broken, point at a file or loop are skipped, and two links to one directory load it once. A running command's preview now updates at most every 80 ms while output streams, instead of on every chunk, and still shows the first output and the final tail at once. The session list sends only the rows that changed after its first frame, so `sessions.watch` on the wire is now a frame that clients read through the SDK. The iOS inbox's relative times stop updating while the inbox is hidden or the app is in the background, and refresh as soon as you return.

## v0.0.22 — 2026-10-21

- [#8](https://github.com/interfaces-lab/nyte/pull/8) [`e24b1e8`](https://github.com/interfaces-lab/nyte/commit/e24b1e8c93964f762ce13c9d8b88068d1ae0616a) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - Signing in to a Nyte account through the browser no longer reloads the desktop window and drops the link it was finishing. Settings → Environments shows a link or sign-in as soon as it happens, even while Nyte is in the background, and the hosted web app's desktop list refreshes when you return to its tab.

## v0.0.21 — 2026-10-21

- [#6](https://github.com/interfaces-lab/nyte/pull/6) [`d8467fb`](https://github.com/interfaces-lab/nyte/commit/d8467fbc7275dad7c1853da9fc4cc0e291e2466d) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - Closing a host waits for its MCP servers to exit, and an MCP server's tool-call timeout no longer cuts its startup short. Shutting down a driver no longer leaves a turn running that nothing can stop. When a lease drops only devices this host already refused, other devices' requests keep going. Closing a host under Bun releases its database files at once, so Windows can delete them. On Windows, an `@` mention of a file reads as the file's name in the composer.

## v0.0.20 — 2026-10-21

- [#4](https://github.com/interfaces-lab/nyte/pull/4) [`4e734dd`](https://github.com/interfaces-lab/nyte/commit/4e734ddc8e479059899bfed983d12a4f0fe5c95b) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - Chats that share a folder no longer count each other's edits. An edit is charged only the file it names, and a shell command that changed files while another chat was working in the folder is marked unattributed instead of charged. A chat's file list, review and patches show only the files its own calls changed.
  
  Agent shell commands run as jobs owned by their chat, so they show in the desktop Terminals pill, Claude Code chats included. `bash` takes `background: true` for servers and watchers, a running command can be moved to the background from its step or the Terminals pill, the chat is told when a background command exits, and the new `job` tool reads a job's output or stops it.

## v0.0.19 — 2026-10-20

- [`84cebae`](https://github.com/interfaces-lab/nyte/commit/84cebae52bb260a12232d3911fa13146684b3d11) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - Processes share one store without an owner lock: `nyte` and Nyte.app open the same chats at once, a process that stops beating is judged dead only while this process's own beats land, and a run, timer or job that a dead process held is taken over by a live one. Chats that source runs create live in `nyte-dev.db`.
  
  The desktop app streams faster and holds less memory:
  
  - A streamed token re-renders one transcript row instead of the whole conversation, code blocks highlight once they close, and text streams in by word.
  - Each pane keeps its three most recent chats mounted, so switching back is instant, and hovering a chat starts its live stream before the click.
  - A chat's history leaves memory when nothing watches it.
  - Typing writes one draft after a pause instead of every draft on each keystroke, and pressed buttons react at once.
  
  `@nyte-ai/sdk`: `pagedViews` reuses its merged arrays when a frame keeps the same messages and turns.

## v0.0.18 — 2026-10-18

- First release cut by Changesets, and the first npm release of the SDK packages: `@nyte-ai/schema`, `ai`, `core`, `plugin`, `protocol`, `host` and `sdk` ship compiled JavaScript and declarations, at the same version as the `nyte` CLI, its `nyte-ai` launcher and the desktop app.

  Since 0.0.16-dev.4 the SDK surface changed in breaking ways, among them:

  - `workspace.commands` is now `workspace.catalog`, which returns the commands and skills a new chat offers before its first message.
  - The host serves the GitHub CLI login apart from each workspace.
  - ACP agents run their JSON-RPC over a lossless stdio stream.
  - `@nyte-ai/core` splits its public surface into `.`, `./store` and `./server`, and `sessions.create` is gone.
