# App structure

`packages/app/src` is the Nyte interface. Each folder owns one concept. A folder may import folders in its own layer or below, never above, and `pnpm layers` fails otherwise. The app's entry in `scripts/check-layers.mjs` sets the order, lowest first. Add a new folder there and to the table below. Tests sit beside the file they cover.

## Folders

| Folder | Owns | Start at |
| --- | --- | --- |
| `index.ts`, `app.tsx` | What the desktop imports, and the providers around the shell | `index.ts` |
| `contract/` | Types and tables that the desktop main, host and preload processes share with the app, including the desktop settings. No React. | `bridge.ts` |
| `boot/` | Renderer startup, the first frame and the startup failure screen | `startup.ts` |
| `data/` | The host connection, the chat and session-list stores over its rows, live watches and every query, one file per domain | `chat-store.ts`, `sessions.ts` |
| `lib/` | Helpers with no domain, such as number and time formats, deferred chunks and small hooks | `format.ts`, `deferred.tsx` |
| `theme/` | Tokens, fonts, appearance and the global stylesheet | `schema.stylex.ts` |
| `preferences/` | Stored preferences | `index.ts` |
| `components/` | App-wide pieces with no feature, such as the chat card, the task mark, overlay occlusion and the app icon | `task-mark.tsx` |
| `chats/` | The directory of chats, the state each chat is in, and the tasks each chat started, meaning its subagents and jobs | `index.ts`, the only import |
| `diff/` | Diff rendering and patch loading, shared by the transcript and Changes | `diff-view.tsx` |
| `references/` | The mentions and references a message carries, and "Add to chat" | `message-references.ts` |
| `chat/` | One open chat | `session-conversation.tsx` |
| `chat/composer/` | The composer, its editor, suggestions, model picker and drafts | `composer.tsx`, `blank-conversation.tsx` |
| `chat/transcript/` | The transcript, with its rows, turns, thinking groups and scroll | `timeline.tsx`, `transcript.tsx`, `turn-view.tsx` |
| `chat/tools/` | Tool call rows, such as shell, edit and subagent | `tool-call.tsx` |
| `chat/markdown/` | Prose, code blocks, highlighting and Mermaid | `prose.tsx` |
| `chat/images/` | The shared chat image viewer, image-pixel marks and PNG flattening | `image-viewer.tsx`, `markup.ts` |
| `chat/trays/` | Trays above the composer for agents, questions, terminals and approvals | `tray.tsx` |
| `canvas/` | The canvas frame, its panel and plugin renderers | `canvas-frame.tsx` |
| `workbench/` | The workbench beside the chats, with its rail, tab strip, kind table, view reducer, store and commands | `workbench.tsx`, `model.ts`, `commands.ts` |
| `workbench/browser/` `changes/` `editor/` `terminal/` | One folder per workbench tool | `*-panel.tsx` |
| `sidebar/` | The sidebar, chat lists and search palette | `sidebar.tsx` |
| `settings/` | Settings pages, including server, notifications, developer, models, profile and usage. `previews/` holds the live previews on the cards. | `pages.ts` |
| `environments/` | The groups of Settings › Server: sharing this Mac, its devices, the Nyte account and a remote host | `server-settings.tsx` |
| `customize/` | The Customize page for plugins, skills and MCP | `customize.tsx` |
| `account/` | Sign-in, the account footer and the GitHub account | `account-footer.tsx` |
| `panes/` | A window tab's layout of panes, the kinds of tab a pane shows and their views, the workspace stage and opening a workspace | `layout.ts`, `pane-kinds.ts`, `layout-view.tsx`, `pane-context.tsx` |
| `projects/` | The dialog that creates and edits a project, the project's page, starting its first chat, and the project section of the workbench rail. The sidebar's Projects section is in `sidebar/`, the project list in `data/projects.ts` | `project-dialog.tsx` |
| `tabs/` | Window tabs, places and routes, and page and overlay state | `window-tabs.ts`, `shell-state.ts` |
| `window/` | Which chats are on screen, and whether each is read or unread | `index.ts`, the only import |
| `commands/` | Window commands from menus and shortcuts | `window-commands.ts` |
| `shell/` | The window frame, titlebar, routes and host events | `shell.tsx`, `routes.tsx` |
| `web/` | The browser client and its account flows | `entry.tsx` |

Outside `src/`, `dev/` holds the account-footer test page, served at `/dev/account-footer.html` on the dev server. `test/` holds shared test helpers.

## How to find things

- The composer is `chat/composer/composer.tsx`. A blank pane's screen is `chat/composer/blank-conversation.tsx`.
- A chat's view is `chat/session-conversation.tsx`. The transcript is `chat/transcript/transcript.tsx`, and one turn is `chat/transcript/turn-view.tsx`.
- A chat reads its own folder, not the window's. `ChatScope` in `chat/chat-scope.tsx` provides the folder and a reference opener for that folder's workbench. Read the folder with `useChatFolder` from `chat/chat-folder.ts`.
- Tool rows are in `chat/tools/`. A subagent row is `chat/tools/subagent-call.tsx`.
- A chat's tasks are its view's background items, joined to the chats and jobs they name, in `chats/tasks.ts`. Read them through `useChatTasks` and `useTask`. The trays list them with `listAgents` and `listTerminals`.
- In `data/`, session reads are `sessions.ts`, session actions `session-actions.ts`, a chat's rows `chat-store.ts`, the session list `directory.ts`, other live watches `watches.ts` and cache keys `query-client.ts`.
- Git reads are `data/vcs.ts`, file reads `data/files.ts`, the model catalog `data/catalog.ts` and usage `data/usage.ts`.
- In `workbench/`, the kind table and tab types are `model.ts`, the pure transitions `view-reducer.ts`, the store `store.ts`, selectors and the rail model `selectors.ts`, the path rule `paths.ts` and the width `width.ts`. `persistence.ts` holds what the workbench saves and the persistence helper. `commands.ts` holds the actions that touch several stores and the reference opener. The rail is `rail.tsx`.
- The Editor panel is `workbench/editor/editor-panel.tsx`. Its file tree is `files-explorer.tsx`, and `file-store.ts` owns open documents and their drafts.
- The Changes panel is `workbench/changes/changes-panel.tsx`, and its derivations are `workbench/changes/changes-model.ts`. The diff it draws is `diff/diff-view.tsx`.
- The sidebar is `sidebar/sidebar.tsx`, the titlebar `shell/titlebar.tsx` and the routes `shell/routes.tsx`.
- `shell/host-events.ts` handles host events. `commands/window-commands.ts` handles keyboard and menu commands.
- A kind of pane tab keeps its rules and its view in its own folder, as the chat does in `chat/chat-pane-kind.ts` and `chat/chat-pane-view.tsx`. `panes/pane-kinds.ts` lists the rules, and `panes/pane-views.tsx` lists the views. The window saves each tab's layout through `tabs/stored-strip.ts`.
- `chat/composer/drafts.ts` saves composer drafts. Per-pane view state is `panes/session-view-state.ts`.
- A popup that may cover a browser page registers in `components/overlay-occlusion.ts`.

## Desktop

`packages/desktop/src` is split by the process that runs each file. Electron main and the host process meet only through `shared/`. The root `oxlint.config.ts` enforces these import rules:

- `main` may not import `workers` or `preload`.
- `host` may not import `main` or `preload`.
- `workers` and `preload` may not import any other process folder.
- `shared` imports none of them.

| Folder | Runs in | Holds |
| --- | --- | --- |
| `main/` | Electron main | Startup, the host link and runtime, the app menu and tray, canvas preview and the renderer protocol. Subfolders: `account/`, `browser/` for the workbench browser's pages, picker, agent tools and adblock, `native/` for CLI install, the context menu, external links and fonts, and `updates/`. |
| `host/` | Electron main | `DesktopHost`, main's handle on the host, with desktop settings. `connections/` holds the Cloudflare tunnel, remote access and server settings. |
| `workers/` | The host process and worker threads | `nyte-host.ts`, the host process entry, the host thread, and the code mode, image and usage workers |
| `shared/` | Both | IPC and host message types, settings shapes and the account protocol |
| `preload/` | Preload scripts | The window bridge, and the browser page and canvas preview preloads |
| `renderer/` | The window | The entry that mounts the app and installs the bridge |

## Package boundary

Other packages import the app only through the `exports` in `packages/app/package.json`. These are `.` for startup and `App`, `./contract/*` for the desktop main and preload processes, and a list of individual module entries. A new deep import needs an entry there.
