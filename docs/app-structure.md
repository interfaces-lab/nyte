# App structure

`packages/app/src` is the Nyte interface. Each folder owns one concept. A folder may import folders in its own layer or below, never above; `pnpm layers` (`scripts/check-layers.mjs`) fails otherwise. Tests sit beside the file they cover.

## Layers, lowest first

| Layer | Folders |
| --- | --- |
| 0 | `contract` |
| 1 | `lib`, `data` |
| 2 | `theme`, `preferences`, `components`, `chats` |
| 3 | `diff`, `references` |
| 4 | `chat`, `canvas`, `workbench`, `sidebar`, `settings`, `environments`, `customize`, `account`, `panes`, `tabs`, `window` |
| 5 | `commands` |
| 6 | `shell` |
| 7 | `boot`, `web`, `app.tsx`, `index.ts` |

## Folders

| Folder | Owns | Start at |
| --- | --- | --- |
| `index.ts`, `app.tsx` | What the desktop imports; the providers around the shell | `index.ts` |
| `contract/` | Types and tables the desktop main, host and preload processes share with the app, including the desktop settings. No React | `bridge.ts` |
| `boot/` | Renderer startup, the first frame, the startup failure screen | `startup.ts` |
| `data/` | The host connection, live watches and every query, one file per domain | `watches.ts`, `sessions.ts` |
| `lib/` | Helpers with no domain: number and time formats, deferred chunks, small hooks | `format.ts`, `deferred.tsx` |
| `theme/` | Tokens, fonts, appearance and the global stylesheet | `schema.stylex.ts` |
| `preferences/` | Stored preferences | `index.ts` |
| `components/` | App-wide pieces with no feature: chat card, the task mark, overlay occlusion, the app icon | `task-mark.tsx` |
| `chats/` | The directory of chats, what state each is in, and the tasks (subagents and jobs) each started | `index.ts` (the only import) |
| `diff/` | Diff rendering and patch loading, shared by the transcript and Changes | `diff-view.tsx` |
| `references/` | Mentions and references a message carries, and "Add to chat" | `message-references.ts` |
| `chat/` | One open chat | `session-conversation.tsx` |
| `chat/composer/` | The composer, its editor, suggestions, model picker and drafts | `composer.tsx`, `new-chat-composer.tsx` |
| `chat/transcript/` | The transcript: rows, turns, thinking groups, scroll | `timeline.tsx`, `transcript.tsx`, `turn-view.tsx` |
| `chat/tools/` | Tool call rows: shell, edit, subagent | `tool-call.tsx` |
| `chat/markdown/` | Prose, code blocks, highlighting, Mermaid | `prose.tsx` |
| `chat/trays/` | Trays above the composer: agents, questions, terminals, approvals | `tray.tsx` |
| `canvas/` | The canvas frame, its panel and plugin renderers | `canvas-frame.tsx` |
| `workbench/` | The workbench beside the chats: rail, tab strip, kind table, view reducer, store and commands | `workbench.tsx`, `model.ts`, `commands.ts` |
| `workbench/browser/` `changes/` `files/` `terminal/` | One folder per workbench tool | `*-panel.tsx` |
| `sidebar/` | Sidebar, chat lists, search palette | `sidebar.tsx` |
| `settings/` | Settings pages, including server, notifications, developer, models, profile and usage; `previews/` holds the cards' live previews | `pages.ts` |
| `environments/` | The groups of Settings › Server: sharing this Mac, its devices, the Nyte account, a remote host | `server-settings.tsx` |
| `customize/` | The Customize page: plugins, skills, MCP | `customize.tsx` |
| `account/` | Sign-in, account footer, GitHub account | `account-footer.tsx` |
| `panes/` | Split panes in a window tab, the workspace stage, opening a workspace | `session-screen.tsx`, `pane-context.tsx` |
| `tabs/` | Window tabs, places and routes, page and overlay state | `window-tabs.ts`, `shell-state.ts` |
| `window/` | Which chats are on screen, read or unread | `index.ts` (the only import) |
| `commands/` | Window commands from menus and shortcuts | `window-commands.ts` |
| `shell/` | The window frame, titlebar, routes, host events | `shell.tsx`, `routes.tsx` |
| `web/` | The browser client and its account flows | `entry.tsx` |

Outside `src/`: `dev/` holds the account-footer harness page (`/dev/account-footer.html` on the dev server); `test/` holds shared test helpers.

## How to find things

- The composer is `chat/composer/composer.tsx`; the new-chat composer is `chat/composer/new-chat-composer.tsx`.
- A chat's view is `chat/session-conversation.tsx`; the transcript is `chat/transcript/transcript.tsx`; one turn is `chat/transcript/turn-view.tsx`.
- A chat reads its own folder, not the window's: `chat/chat-scope.tsx` gives it the folder (`useChatFolder`) and a reference opener for that folder's workbench.
- Tool rows are in `chat/tools/`; a subagent row is `chat/tools/subagent-call.tsx`.
- A chat's tasks are its view's background items joined to the chats and jobs they name: `chats/tasks.ts`, read through `useChatTasks` and `useTask`. The trays list them with `listAgents` and `listTerminals`.
- Session reads are `data/sessions.ts`, actions `data/session-actions.ts`, live watches `data/watches.ts`, cache keys `data/query-client.ts`.
- Git reads are `data/vcs.ts`; file reads `data/files.ts`; model catalog `data/catalog.ts`; usage `data/usage.ts`.
- The workbench's kind table and tab types are `workbench/model.ts`; its pure transitions `workbench/view-reducer.ts`, the store `workbench/store.ts`, selectors and the rail model `workbench/selectors.ts`, the path rule `workbench/paths.ts`, its width `workbench/width.ts`, what it saves (and the persistence helper) `workbench/persistence.ts`. Actions that touch several stores, and the reference opener, are `workbench/commands.ts`; the rail is `workbench/rail.tsx`.
- The Changes panel is `workbench/changes/changes-panel.tsx`, its derivations `workbench/changes/changes-model.ts`; the diff it draws is `diff/diff-view.tsx`.
- The sidebar is `sidebar/sidebar.tsx`; the titlebar `shell/titlebar.tsx`; the routes `shell/routes.tsx`.
- Host events are handled in `shell/host-events.ts`; keyboard and menu commands in `commands/window-commands.ts`.
- Composer drafts are saved by `chat/composer/drafts.ts`; per-pane view state is `panes/session-view-state.ts`.
- Popups that may cover a browser page register in `components/overlay-occlusion.ts`.

## Desktop

`packages/desktop/src` is split by the process that runs each file. The two Node processes meet only through `shared/`, and `oxlint.config.ts` enforces this: `main` may not import `host` or `workers`, `host` may not import `main`, `workers` import neither, and `shared` imports none of them.

| Folder | Runs in | Holds |
| --- | --- | --- |
| `main/` | Electron main | startup, the host supervisor, the app menu, canvas preview, the renderer protocol; `account/`, `browser/` (the workbench browser's pages, picker, agent surface, adblock), `native/` (CLI install, context menu, fonts), `updates/` |
| `host/` | the `nyte host` child | the desktop host entry, host settings, models, the browser plugin; `connections/` (relay, tunnel, tailnet, remote access) |
| `workers/` | worker threads | code mode, image and usage workers |
| `shared/` | both | the IPC and host message types, settings shapes, account protocol |
| `preload/` | preload scripts | the window bridge, browser page and canvas preview preloads |
| `renderer/` | the window | the entry that mounts the app and installs the bridge |

## Package boundary

Other packages import the app only through `packages/app/package.json` `exports`: `.` (startup and `App`), `./contract/*` for the desktop main and preload processes, and a short list of style, theme and lab entry points. A new deep import needs an entry there.
