# @nyte-ai/host

## 0.0.20

### Patch Changes

- [#4](https://github.com/interfaces-lab/nyte/pull/4) [`4e734dd`](https://github.com/interfaces-lab/nyte/commit/4e734ddc8e479059899bfed983d12a4f0fe5c95b) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - Chats that share a folder no longer count each other's edits. An edit is charged only the file it names, and a shell command that changed files while another chat was working in the folder is marked unattributed instead of charged. A chat's file list, review and patches show only the files its own calls changed.
  
  Agent shell commands run as jobs owned by their chat, so they show in the desktop Terminals pill, Claude Code chats included. `bash` takes `background: true` for servers and watchers, a running command can be moved to the background from its step or the Terminals pill, the chat is told when a background command exits, and the new `job` tool reads a job's output or stops it.
- Updated dependencies [[`4e734dd`](https://github.com/interfaces-lab/nyte/commit/4e734ddc8e479059899bfed983d12a4f0fe5c95b)]:
  - @nyte-ai/schema@0.0.20
  - @nyte-ai/ai@0.0.20
  - @nyte-ai/core@0.0.20
  - @nyte-ai/plugin@0.0.20
  - @nyte-ai/protocol@0.0.20

## 0.0.19

### Patch Changes

- [`84cebae`](https://github.com/interfaces-lab/nyte/commit/84cebae52bb260a12232d3911fa13146684b3d11) Thanks [@Itsnotaka](https://github.com/Itsnotaka)! - Processes share one store without an owner lock: `nyte` and Nyte.app open the same chats at once, a process that stops beating is judged dead only while this process's own beats land, and a run, timer or job that a dead process held is taken over by a live one. Chats that source runs create live in `nyte-dev.db`.
  
  The desktop app streams faster and holds less memory:
  
  - A streamed token re-renders one transcript row instead of the whole conversation, code blocks highlight once they close, and text streams in by word.
  - Each pane keeps its three most recent chats mounted, so switching back is instant, and hovering a chat starts its live stream before the click.
  - A chat's history leaves memory when nothing watches it.
  - Typing writes one draft after a pause instead of every draft on each keystroke, and pressed buttons react at once.
  
  `@nyte-ai/sdk`: `pagedViews` reuses its merged arrays when a frame keeps the same messages and turns.
- Updated dependencies [[`84cebae`](https://github.com/interfaces-lab/nyte/commit/84cebae52bb260a12232d3911fa13146684b3d11)]:
  - @nyte-ai/schema@0.0.19
  - @nyte-ai/ai@0.0.19
  - @nyte-ai/core@0.0.19
  - @nyte-ai/plugin@0.0.19
  - @nyte-ai/protocol@0.0.19

## 0.0.18

### Patch Changes

- First release cut by Changesets, and the first npm release of the SDK packages: `@nyte-ai/schema`, `ai`, `core`, `plugin`, `protocol`, `host` and `sdk` ship compiled JavaScript and declarations, at the same version as the `nyte` CLI, its `nyte-ai` launcher and the desktop app.

  Since 0.0.16-dev.4 the SDK surface changed in breaking ways, among them:

  - `workspace.commands` is now `workspace.catalog`, which returns the commands and skills a new chat offers before its first message.
  - The host serves the GitHub CLI login apart from each workspace.
  - ACP agents run their JSON-RPC over a lossless stdio stream.
  - `@nyte-ai/core` splits its public surface into `.`, `./store` and `./server`, and `sessions.create` is gone.
