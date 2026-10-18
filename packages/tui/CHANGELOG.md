# @nyte-ai/tui

## 0.0.18

### Patch Changes

- First release cut by Changesets, and the first npm release of the SDK packages: `@nyte-ai/schema`, `ai`, `core`, `plugin`, `protocol`, `host` and `sdk` ship compiled JavaScript and declarations, at the same version as the `nyte` CLI, its `nyte-ai` launcher and the desktop app.

  Since 0.0.16-dev.4 the SDK surface changed in breaking ways, among them:

  - `workspace.commands` is now `workspace.catalog`, which returns the commands and skills a new chat offers before its first message.
  - The host serves the GitHub CLI login apart from each workspace.
  - ACP agents run their JSON-RPC over a lossless stdio stream.
  - `@nyte-ai/core` splits its public surface into `.`, `./store` and `./server`, and `sessions.create` is gone.
