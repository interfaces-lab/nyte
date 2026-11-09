# Changelog

## v0.0.29 — 2026-11-09

### Fixes

- The SDK packages publish to npm again. `@nyte-ai/sdk` now depends on `typebox`, which its event validators' published types need, so the package build no longer fails. v0.0.28 reached GitHub but not npm, so this is the first npm release since v0.0.27 and it includes everything in v0.0.28.
- A folder dragged in from Finder or pasted into the composer now shows as a folder mention instead of a file.

## v0.0.27 — 2026-11-04

### The host runs on its own

- The desktop app now runs Nyte's host as a login agent. Quitting the app leaves chats and agents running, and reopening it reconnects to the same host.
- A menu bar item shows whether the host is running, along with the app and host versions. It also offers Check for Updates, Settings and a menu-bar-only mode.
- `nyte` in a terminal attaches to the same host instead of starting a private one. Quitting the TUI no longer stops its agent's turns or background jobs.

### Faster, lighter connections

- Clients attach to a chat and resume it over one WebSocket. Instead of whole views, they read only the rows that changed since they last looked.
- Measured on a copy of a real 5 GB store, over a 50 ms link: opening chats, sending, reconnecting and switching 20 chats takes 6.5 s instead of 7.4 s, and moves 2.4 MB instead of 4.4 MB. Reconnecting takes 139 ms instead of 416 ms.
- A client catches up within about half a second of the host coming back.
- Opening a chat that isn't in memory answers sooner, because the checkpoint is written after the answer.
- A chat's commands, skills and tools show right after a host restart, and chats with the same plugins share one stored copy.

### Remote access and outside agents

- Built-in Tailscale: the host joins your tailnet itself, without the Tailscale app, and knows who each caller is. Access is owner only or anyone on the tailnet.
- Outside agents such as Claude Code and Codex can connect over MCP at `/mcp` with OAuth. You grant them read-only access or a permission ceiling.
- `nyte api call` and `nyte events` call any host operation and print its events.
- The docs are served over MCP, so an agent can read them.
- `nyte skill setup` installs a Nyte skill and a session hook for Claude Code and Codex.
- The TUI reports the open chat's state to your terminal (OSC 7501), so terminals such as Rex can show it.

### Chats and the app

- Fork a chat from any reply. The fork starts in the same folder with the history up to that reply, and the original chat doesn't change.
- Side chats beside a chat.
- A question or failure in a chat you aren't looking at shows one alert per chat.
- Answers that arrive after a question stopped waiting are attached to the chat as answers. The TUI no longer marks such a chat as waiting.
- The terminal runs on Ghostty's libghostty-vt, with faster drawing, clickable links and macOS editing keys.
- Each chat opens in its own tab, and tabs and drafts are kept per window.
- A two-finger swipe toggles the sidebar.
- Source control settings, with worktree clean-up and a branch prefix.
- `nyte doctor`, `nyte triage` and `npx nyte-ai init`.
- Agents pause while the Mac sleeps, and cut-off responses continue.

### Fixes

- A client that resumed after the host restored a checkpoint could miss earlier messages.
- Background status that changed while a client was away now shows after it reconnects.
- Turning sharing on and off at the same moment could leave sharing on.
- Pending checkpoints are written when the host closes, and none after.
- A terminal whose loader failed tries again on the next start and says why.
- Adding a Tailscale host no longer tells you to fetch a token from Pair.

### For SDK users

- **API revision 12.** Clients below revision 12 are refused at the handshake.
- **`session.fork`.** Starts a new chat with a session's history up to a commit.
- **Turn line counts removed.** Turn info no longer carries `added` and `removed`.
- **Watch APIs removed.** The whole-view watch APIs (`head.watch`, `sessions.watch`, `part.watch` and `session.watch()`) are gone. Use `openHost` with its head and directory stores, and `headView`.
- **Catalogs.** A chat's catalog arrives as an id; read its content with `catalogs.read`.

### Known issues

- This release ships for Apple silicon macOS only. The Windows desktop app can't reach its host until the host listens on a named pipe.

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
