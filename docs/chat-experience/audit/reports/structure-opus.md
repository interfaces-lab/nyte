# Desktop app structure and navigation review

Scope: `packages/app/src` (330 source files, about 63.5k lines, plus 156 test files), `packages/desktop/src` (92 source files, about 14.6k lines), and how `packages/ui` and `packages/canvas` are used. Sizes count non-test `.ts`/`.tsx` files. Cross-folder counts come from parsing relative `import`/`export … from` statements in app/src. Dependency checks follow value imports.

## 1. How the area works today

**Entry and bootstrap.**
- The desktop renderer starts at `desktop/src/renderer/src/main.tsx`. It imports fonts and theme (`:1-7`) and installs the IPC bridge through `install-bridge.ts`, which calls `installBridge` from `@nyte-ai/app/nyte.ts` (`install-bridge.ts:1,44`).
- It then builds the router with `createAppRouter` (`main.tsx:29-31`), sets up a react-query focus listener (`:55`), and calls `startRendererStartup` (`:87`) to mount `<App>` inside `AccountProvider` (`:73-79`).
- The web client runs the same sequence again from `app/src/web/entry.tsx` (`:2-7`, `:52`). It imports app internals by relative path and does not use `app/src/index.ts`.

**App root.**
- `app.tsx` contains the host-event switch. It sends each event to its feature: `requestTrust` from chrome, `applyBrowserEvent` from workbench, `acceptHostSettings` from preferences, and so on (`app.tsx:30-104`). It then renders `<Shell>` from `router.tsx`.
- `router.tsx` holds two things:
  - The visible window frame: `Shell`/`ShellChrome` (`:147-245`), sidebar, titlebar and overlays.
  - The route tree, plus a stage switch between `SessionScreen`, `CustomizeSurface` and `EnvironmentsSurface` (`:247-476`).
- The four stages are named in `client-actions.ts:9` (`"workspace" | "customize" | "environments" | "settings"`). None of them has a folder.

**Window model.**
- Window tabs live in `tabs/` (`model.ts`, `window-tabs.ts`).
- Panes inside a tab live in `layout/` (`pane-layout.ts`, `pane-controller.ts`, `session-view-state.ts`).
- The rendered pane is in `screens/` (`pane-host.tsx`, `session-screen.tsx`, `session-conversation.tsx`, `blank-conversation.tsx`).
- What is on screen or unread is in `window/` (`index.ts`, `exposure.ts`, `tray.ts`).
- Shell state such as sidebar width and overlays is in `chrome/shell-state.ts`.
- Menu commands are run from `shell/window-commands.ts`.

**Data.** There are two layers, and features import both directly:
- `sdk.tsx` (663 lines): the connection, the `WatchStore` live streams and the watch families. It has 50 importers.
- `queries.ts` (960 lines, about 60 exports): TanStack Query hooks for sessions, workspaces, VCS, files, search, usage, catalog, plugins and the local connection. It has 57 importers.
- On top of these sit `nyte.ts` (bridge accessor, 56 importers) and `bridge.ts` (the host contract, 46 importers).

**Features.**
- `conversation/`: 87 flat files plus `tray/`.
- `workbench/`: 53 flat files covering browser, changes, files, terminal and canvas.
- `chrome/`: 55 files covering sidebar, titlebar, palette, three settings pages, the customize and environments stages, and account/sign-in.
- `settings/` holds the settings shell and the rest of the pages.

**Other packages.**
- Desktop reaches into the app through the wildcard export `"./*": "./src/*"` (`app/package.json:14`): 41 deep imports from `desktop/src`, plus 20 from `lab` and 2 from `docs`.
- `packages/ui` is used only through per-component subpaths (42 distinct specifiers, mostly `styles/*.stylex`, `button`, `icon`). That boundary is clean.
- `packages/canvas` reaches the app only as a built iframe shell. `app/vite.ts:146` points at `../canvas/dist/shell/` by relative path rather than a package export, and `conversation/canvas-frame.tsx` hosts the iframe.
- No client file imports `@nyte-ai/host` (checked).

**File-level import cycles: zero.** `scripts/check-cycles.mjs` (`pnpm cycles`) enforces this. Nothing checks cycles between folders.

## 2. Findings

Ordered by impact. Line references are to what I read. Where a point is an inference, it says so.

| # | Where | What | Why it hurts | Change |
|---|---|---|---|---|
| 1 | `app/src/chrome/` (55 files, 11.1k lines) | **`chrome/` covers at least six concepts, grouped by where they sit on screen:**<br>• sidebar: 10 `sidebar*` files, 3.2k lines<br>• three settings pages: `models-settings.tsx` 584, `profile-settings.tsx` 596, `usage-settings.tsx` 637 + `usage-view.ts` 655<br>• the environments stage: `environments.tsx`, `server-settings.tsx`, `remote-*`, `nyte-connection.tsx`, `cloud-connection.tsx`, `pairing-code.tsx`, `device-rows.tsx`, `connect-*`, `link-tray.tsx`; about 2.1k lines<br>• the customize stage: `customize*`, 1.1k lines<br>• account and sign-in: `account-footer`, `sign-in-panels`, `login-attempts`, `github-account`<br>• titlebar, palette, about dialog, open-workspace<br>**`settings/` reaches back into chrome for its own pages:** `settings/pages.ts:3,5`, `settings/agent.tsx` (models-settings), `settings/profile.tsx:3`, `settings/navigation.tsx` (`sidebar.stylex`). `settings/profile.tsx` (19 lines) only wraps `chrome/profile-settings.tsx`. | Nobody would look for the Usage settings page in `chrome/`. The two folders depend on each other (chrome→settings 6 edges, settings→chrome 5). The customize and environments stages that `router.tsx:252-256` switches on have no folder of their own. | Remove `chrome/`. Each settings page moves to `settings/` and merges with its wrapper. `environments/` and `customize/` become stage folders. `sidebar/`, `account/` and `shell/` get the rest (map in §3). |
| 2 | `app/package.json:14` `"./*": "./src/*"`; `desktop/src/shared/ipc.ts:1-3`; `desktop/src/main/app-menu.ts:9-11`; `desktop/src/main/updates.ts:10`; `desktop/src/main/host.ts:18`; `desktop/src/preload/index.ts:29-30` | **The app package has no public boundary.** The Node main process and the preload import renderer-package source from four unrelated places: root (`bridge.ts`, `errors.ts`, `client-actions.ts`, `updates.ts`), `workbench/browser-shortcuts.ts`, `web/origins.ts` and `tabs/window-tabs.ts`.<br>The wire type `DesktopWindow` is declared in `tabs/window-tabs.ts:31`. That is a 317-line store module that also creates the `windowTabs` singleton (`:317`).<br>Lab deep-imports app style internals (`chrome/sidebar.stylex.ts` ×6, `theme/schema.stylex.ts` ×9). | Moving any app file can break desktop, lab or docs. There is no single file that lists what desktop may use. The IPC contract is scattered across folders named after renderer features. | Create `app/src/contract/` holding everything main or preload may import (bridge types, errors, client-action catalog, browser shortcut table, update label, web origins, `DesktopWindow`). Export it as `"./contract/*"`. Give lab and docs explicit exports, then delete `"./*"`. |
| 3 | `app/src/queries.ts` (960 lines) and `app/src/sdk.tsx` (663 lines, no JSX despite `.tsx`) | **The data layer sits at root and imports feature folders:**<br>• `queries.ts:68` → `chrome/usage-view.ts`<br>• `queries.ts:71-73` → `conversation/message-references.ts` and `conversation/subagent-status.ts`<br>• `sdk.tsx:24-26` → `conversation/session-activity.ts` and `conversation/paced-text.ts`<br>`queries.ts` mixes about 10 domains (outline lines 104-960). `sdk.tsx` mixes connection setup (`:28-88`), the generic `WatchStore` (`:90-405`) and domain watch families (`:456-663`). | The lowest layer depends on the highest. Fan-in is 13 folders for `queries.ts` and 12 for `sdk.tsx`. To find "where are VCS reads" you have to scroll a 960-line file. | Add a `data/` folder with one module per domain. Move the four helpers it needs (`USAGE_STALE_AFTER_MS`, `MentionFile`/`mentionFile`, `subagentActivity`, `sessionActivityProjector`, `createTextPacer`) into `data/` or `lib/`. |
| 4 | **conversation↔workbench** (18 edges workbench→conversation, 8 back). Imports into conversation: `workbench/changes-stack.tsx:19-26`, `file-editor.tsx:20`, `changes-panel.tsx:18`, `canvas-panel.tsx:14`. Imports into workbench: `conversation/diff-view.tsx:19`, `diff-expansion.ts:3`, `canvas-frame.tsx:35` (`patchDigest` from `workbench/changes-viewed.ts:59`), `transcript-rows.ts:10`, `turn-view.tsx:23` (`CHANGES_VISIBLE_FILES` from `workbench/change-tree.ts`) | **Shared concepts are kept inside one feature and imported by the other:**<br>• diff rendering (`diff-view`, `diff.stylex`, `diff-expansion`) lives in conversation and is used by workbench<br>• the patch digest lives in workbench and is used by conversation<br>• the canvas frame lives in conversation and is used by `workbench/canvas-panel`<br>• references (`add-to-chat.ts`, `message-references.ts`, `reference-opener.tsx`, `composer-file-drop.ts`) are imported by 6 workbench files | The file-level cycle check passes, but the folders form a knot, so neither folder can be read on its own. More folder cycles of the same kind:<br>• `conversation/timeline.tsx:13` → `screens/transcript-skeleton.tsx`, while screens imports 25 conversation edges<br>• `layout/session-view-state.ts:6` → `conversation/composer-files.ts`, while composer imports layout<br>• `preferences/index.ts:4` → `chrome/sidebar-view.ts`<br>• `tabs/use-window-tabs.tsx` → `chrome/use-show-session.ts`<br>• `chrome/sidebar-pane.tsx:12`, `conversation/tray/tray.tsx:12` and `layout/session-dnd.tsx:30` all import `workbench/browser-occlusion.ts` | Extract `diff/`, `canvas/` and `references/` as their own folders. Move `TranscriptSkeleton` into chat. Move `ComposerImageAttachment` and the sidebar view schema down to where they are owned. Add a folder-layer check next to `scripts/check-cycles.mjs`. |
| 5 | `router.tsx:147-476`, `app.tsx:30-104`, `chrome/shell-state.ts`, `chrome/titlebar.tsx`, `shell/` (3 files), `tabs/`, `layout/`, `window/`, `screens/pane-host.tsx`, `split-sash.tsx`, `pane-header.tsx` | **The window frame is spread over about 8 places.**<br>• The folder named `shell/` holds a command runner, `focus-owner.ts` (21 lines) and `search.ts`, a 6-line interface. It does not hold the shell.<br>• `Shell` itself is in `router.tsx`.<br>• "Tray" means three different places: `conversation/tray/`, `window/tray.ts` and `theme/tray.stylex.ts`. | A newcomer looking for "where is the window laid out" will open `shell/` and find nothing. Routing changes and layout changes collide in one 484-line file. | Make `shell/` the frame: split `router.tsx` into `shell/shell.tsx` and `shell/routes.tsx`, and move the host-event switch to `shell/host-events.ts`. Add `panes/`, which merges `layout/` with the pane pieces of `screens/`. Add `commands/`. |
| 6 | `conversation/` (87 flat files + `tray/`, 18.8k lines). Composer: 17 `composer-*` files, 5.6k lines. `screens/blank-conversation.tsx:10-32` | **One flat folder for at least six sub-concepts:** composer, transcript/turn, tool calls, markdown/code/mermaid, trays and model picker.<br>**The new-chat composer is built in `screens/`.** It imports 10 composer internals (`ComposerFrame`, `attachComposerFiles`, `bindComposerFileDrop`, `composerSource`, `composerSendPlan`, `startDraft`, `ModelPicker`, …). `conversation/composer.tsx` wires the same parts at `:133`, `:195`, `:340`, `:716` and `:842`. | 87 siblings with prefix-only grouping. The composer's public surface is undefined because `screens/` reaches into its internals. Inference: the two assemblies will drift. | Split into `chat/composer/`, `chat/transcript/`, `chat/tools/`, `chat/markdown/` and `chat/trays/`. Move `blank-conversation.tsx` to `chat/composer/new-chat-composer.tsx` beside `session-composer.tsx`, so the shared wiring is in one folder. |
| 7 | `workbench/` (53 flat files). `workbench/controller.ts` (998 lines) | **Four tools share one flat folder:** changes (13 files, about 4.6k lines), browser (13, 2.5k), terminal (4 plus ghostty, 1.6k) and files (6, 2k).<br>**`controller.ts` mixes five things:**<br>• tab model types (`:24-92`)<br>• tab helpers and labels (`:94-500`)<br>• width geometry (`:189-546`)<br>• persistence schema and decoding (`:396-653`)<br>• the store (`:728-968`) plus React hooks (`:970-998`) | `controller.ts` is imported by root, chrome, conversation, screens, shell and window. Every one of them pulls in the whole file to get one type or constant. | Add subfolders `workbench/{browser,changes,files,terminal}/`. Split `controller.ts` into `model.ts`, `width.ts`, `persistence.ts` and `controller.ts`. |
| 8 | `desktop/src/main/` (60 flat files, 10k lines) | **One folder holds three runtimes.** I traced reachability from the build inputs in `electron.vite.config.ts`:<br>• 29 files are reachable only from `index.ts`, the Electron main process (all `browser*` except `browser-tools`, plus `app-menu`, `updates`, `host-process`).<br>• 12 are reachable only from `host-entry.ts`, the utility process (`host.ts` 922 lines, `cloudflare*`, `tailnet`, `server-settings`, `host-settings`, `browser-tools`, `models`).<br>• 15 are reachable from both and import no Electron (`host-rpc`, `host-messages`, `ipc-call`, `ipc-inputs`, `errors`, `launch-state`, …).<br>• 5 more are worker entries.<br>**The file name prefixes are misleading.** `host-process.ts` runs in main, `browser-tools.ts` runs in the host, and `host-account.ts` runs in both. `desktop/src/account/` mixes renderer React (`provider.tsx`, `clerk.tsx`) with main-process code (`operations.ts`, `scheme.ts`). | You cannot tell from a path which process code runs in. In Electron that decides which APIs are allowed and what goes into which bundle. | Split into `main/`, `host/`, `workers/` and `shared/`. Move the account renderer files to `renderer/account/`. |
| 9 | `desktop/src/renderer/src/main.tsx:1-7,55-70`; `app/src/web/entry.tsx:2-7,52-67`; `app/src/break/account-footer.tsx:2-7` | **The renderer bootstrap is copy-pasted:** the font and theme imports appear three times, and the react-query `focusManager` listener twice. The web entry imports app internals directly while desktop goes through `index.ts`, so there are two entry paths. | Changes have to be repeated in every copy, and the entry contract is unclear. | Add one `boot/renderer.ts` (fonts, theme boot, focus listener), exported from `index.ts`. Make the web entry use `index.ts` too. |
| 10 | `app/src/break/` (2 files, served by `app/break-account-footer.html:22`), `chrome/fixtures/login-harness*`, `screens/session-screen-render.fixtures.ts` | **Dev harnesses and fixtures sit in production feature folders.** | They add noise when navigating, and in `break/` they look like a feature. | Move them to `app/dev/` (harness pages) and next to their tests. |
| 11 | `view-helpers.ts:18,37-43,51-65` (10 importers); `chrome/usage-view.ts:97-117` (`formatUsd`, `formatTokens`, `formatPercent`, imported by `conversation/composer-context.tsx:6` and `workbench/rail-status.tsx:11`); `components/ui.tsx:125` (`formatTimeAgo`) | **Generic helpers are filed by whoever wrote them first.** `view-helpers.ts` mixes conversation turns, workspace naming and worktree files. | Imports cross features for a number formatter, and a file name like "view helpers" says nothing about what is in it. | `lib/format.ts`; `conversationTurns` → `chat/`; workspace naming → `data/workspaces.ts`; worktree files → `workbench/files/`. |
| 12 | `conversation/transcript.tsx:214-723`, `workbench/changes-panel.tsx:397-897`, `workbench/browser-panel.tsx:398-898`, `layout/session-view-state.ts:259,486` | **Single components or classes of about 500 lines.** `session-view-state.ts` holds two unrelated classes: `WindowDrafts` and `SessionViewStateStore`. | They are hard to review, and the drafts model is filed under "layout". | Pull hooks out of the three components. Move `WindowDrafts` to `chat/composer/drafts.ts`. This comes after the folder moves. |

What is fine and should stay:
- Tests sit next to the files they cover (`*.test.ts`, `*.browser-test.tsx`, `*.electron.test.ts`).
- The `ui` subpath imports.
- The `.deferred` lazy-chunk seam (`deferred-entries.ts`, `vite.ts`).
- The e2e swap of `main/models.ts`/`tailnet.ts` (`electron.vite.config.ts:18-21`).
- `web/` as the web-only client.

## 3. Target shape

Folder layers, from lowest to highest. A folder may import only from folders in lower layers; enforce this with a script next to `check-cycles.mjs`.

```
contract → lib, data → theme, preferences, components → diff, canvas, references
        → chat, workbench, sidebar, settings, environments, customize, account → panes, commands → shell → boot, app.tsx, index.ts, web
```

The stages named in `client-actions.ts:9` (workspace, customize, environments, settings) each get a folder: the workspace stage is `panes/` + `chat/` + `workbench/`.

### packages/app/src

```
index.ts                     public API for desktop (unchanged surface + boot)
app.tsx                      providers only (host-event switch moves out)
contract/                    importable by desktop main/preload; no React
  bridge.ts                  ← bridge.ts
  nyte.ts                    ← nyte.ts
  errors.ts                  ← errors.ts
  client-actions.ts          ← client-actions.ts
  browser-shortcuts.ts       ← workbench/browser-shortcuts.ts
  update-label.ts            ← updates.ts
  origins.ts                 ← web/origins.ts
  desktop-window.ts          ← DesktopWindow type extracted from tabs/window-tabs.ts:31
boot/
  renderer.ts                NEW: fonts + theme/boot + focus-modality + focusManager (dedupes main.tsx/web/entry.tsx)
  startup.ts, startup-failure.tsx, first-frame.ts   ← root
data/
  connection.ts              ← sdk.tsx:28-88, 407-455
  watch-store.ts             ← sdk.tsx:90-405 (WatchStore, watchFamily, useWatch*)
  watches.ts                 ← sdk.tsx:456-663
  query-client.ts            ← queries.ts:77-120 (queryClient, keys, session actions) + query-keys.ts
  sessions.ts                ← queries.ts session hooks + session-list.ts + session-configuration.ts + session-actions.ts
  workspaces.ts              ← queries.ts workspace hooks + view-helpers.ts:37-43
  vcs.ts, files.ts, search.ts, usage.ts, catalog.ts (+ root catalog.ts), plugins.ts   ← queries.ts by domain
  local-host.ts              ← queries.ts:838-893 (connectLocalHost, loadLocalResources)
  derived-store.ts, schemas.ts   ← root
lib/
  format.ts                  ← chrome/usage-view.ts:97-170 + components/ui.tsx:125
  deferred.tsx, deferred-entries.ts, deferred-urls.ts   ← root
  pierre-worker-provider.tsx, file-ranking.ts, open-external.ts, action-toasts.ts, work-counts.ts
  use-blob-url.ts, use-debounced-value.ts, use-now-minute.ts
theme/                       unchanged
preferences/                 unchanged; SessionViewSchema moves in from chrome/sidebar-view.ts
components/                  + chrome/connection-list.tsx, chrome/status-glyph.tsx
diff/                        ← conversation/diff-view.tsx, diff.stylex.ts, diff-expansion.ts,
                               workbench/changes-viewed.ts (patchDigest + store), workbench/change-tree.ts, stacked-diff.ts
canvas/                      ← conversation/canvas-frame.ts(x), canvas-theme.ts, workbench/canvas-panel.tsx,
                               canvas-activity.ts, client-plugins.tsx
references/                  ← conversation/message-references.ts, add-to-chat.ts, reference-opener.tsx,
                               mention-preview.ts, composer-file-drop.ts, workbench/open-reference.ts, diff-range.ts
chat/                        ← conversation/ (renamed: it is one chat, and "chats/" is the list)
  index.ts                   the surface panes/ uses: SessionConversation, NewChatComposer, Timeline, trays
  session-conversation.tsx   ← screens/session-conversation.tsx
  composer/                  composer-*.ts(x) (17), model-picker*.ts(x), draft-start.ts, plugin-command.ts,
                             new-chat-composer.tsx ← screens/blank-conversation.tsx,
                             drafts.ts ← layout/session-view-state.ts:259-485 (WindowDrafts)
  transcript/                transcript*.ts(x), timeline.tsx, turn-view.tsx, turn.stylex.ts, live-turn.tsx,
                             turn-recovery.tsx, chunk-fade.tsx, paced-text.ts, step-group*.ts(x), thinking-line.tsx,
                             reasoning-heading.ts, planning-time.ts, row-surfaces.tsx, message-content.tsx,
                             raw-part.tsx, part-origin.ts, activity.stylex.ts, transcript-skeleton.tsx ← screens/,
                             turns.ts ← view-helpers.ts:10-35
  tools/                     tool-call.tsx, tool-line.tsx, tool-output.tsx, shell-call.tsx, shell-background.ts,
                             terminal-text.ts, edit-call.tsx, edit-patch.ts, subagent-*.ts(x)
  markdown/                  prose*.ts(x), code-block.tsx, code.deferred.tsx, highlight*.ts, mermaid-*.ts(x),
                             external-link.ts, image-preview.tsx
  trays/                     tray/*, approval-tray.tsx, approval-state.ts
  session-activity.ts        (or data/, since data/watches.ts needs it)
chats/                       unchanged (directory of chats)
workbench/
  index.ts                   Workbench, WorkbenchTabStrip, controller API
  workbench.tsx, workbench.stylex.ts, workbench-rail.tsx, rail-status.tsx, tab-strip.tsx, panels.deferred.tsx,
  find-widget.tsx, workspace-search.tsx
  model.ts                   ← controller.ts:13-188, 420-500 (tab types, labels, defaults)
  width.ts                   ← controller.ts:189-198, 502-546
  persistence.ts             ← controller.ts:396-419, 548-653
  controller.ts              ← controller.ts:654-998 (store + hooks)
  browser/                   browser-*.ts(x) (13 files)
  changes/                   changes-*.ts(x), change-scopes.ts, change-stats.tsx
  files/                     file-*.ts(x), files-*.tsx, tree-theme.ts, worktree-files.ts ← view-helpers.ts:51-91
  terminal/                  terminal-*.ts(x), ghostty*.ts
sidebar/                     ← chrome/sidebar*.ts(x) (10), search-palette*.ts(x), palette-legend*.ts(x),
                               use-sidebar.ts, use-show-session.ts
account/                     + chrome/account-footer.tsx, sign-in-panels.tsx, login-attempts.ts, github-account.ts,
                               link-tray.tsx, connect-view.ts
settings/                    + chrome/models-settings*.ts(x), usage-settings*.ts(x), usage-view.ts (minus format),
                               usage-charts.deferred.ts; chrome/profile-settings.tsx merged with settings/profile.tsx
environments/                ← chrome/environments.tsx, server-settings.tsx, remote-*.tsx, nyte-connection.tsx,
                               cloud-connection.tsx, pairing-code.tsx, device-rows.tsx, connect-devices.tsx
customize/                   ← chrome/customize*.ts(x)
panes/                       ← layout/* (minus WindowDrafts) + screens/pane-host.tsx, pane-header.tsx, split-sash.tsx,
                               session-screen*.ts(x), context-selector*, workspace-context.tsx, environment-menu.tsx,
                               model-configuration.ts
tabs/                        unchanged (window tabs); DesktopWindow type → contract/
window/                      unchanged (exposure); window/tray.ts stays: it is window state
commands/                    ← shell/window-commands.ts, shell/focus-owner.ts, shell/search.ts
shell/                       the window frame
  shell.tsx                  ← router.tsx:117-270 (Shell, ShellChrome, ConnectionFailure, ReleaseNotice, stage switch)
  routes.tsx                 ← router.tsx:272-484 + route-session.ts + router-register.ts
  host-events.ts             ← app.tsx:30-104
  shell-state.ts, titlebar*.ts(x), about-dialog.tsx, open-workspace.tsx, use-chrome-tab.ts, use-settings-open.ts ← chrome/
web/                         unchanged (web-only client); entry.tsx imports ../index.ts + boot
```

Removed: `chrome/`, `screens/`, `layout/`, `break/`, the old 3-file `shell/`, and every loose root file except `index.ts`, `app.tsx` and `vite-env.d.ts`. Dev harness pages move to `packages/app/dev/` (`break/account-footer.tsx`, `chrome/fixtures/login-harness*`), with their `.html` files next to them.

Size check, from the prefix counts above: the largest leaf folders become `chat/composer` (about 25 files, 6.5k lines), `chat/transcript` (about 28) and `workbench/changes` (about 13, 4.6k). No folder has more than about 30 files.

### packages/desktop/src

```
main/                Electron main process (entry: index.ts)
  index.ts           composition root only
  windows.ts         ← index.ts:98-131, 492-500, 572-788 (window chrome, createWindow, restoreWindows)
  ipc.ts             ← index.ts:478-571 (senderWindow, registerIpc)
  browser/           browser.ts, browser-runtime.ts, browser-surface*.ts, browser-actions.ts, browser-guest-session.ts,
                     browser-policy.ts, browser-history.ts, browser-downloads.ts, browser-picker*.ts, browser-agent-surface.ts, adblock.ts
  account/           account.ts, account-keeper.ts, account-store.ts, ../account/operations.ts
  updates/           updates.ts, update-controller.ts, update-settings.ts
  app-menu.ts, context-menu.ts, cli.ts, fonts.ts, canvas-preview.ts, renderer.ts, external-url.ts,
  host-process.ts → host-launcher.ts (it starts the host; it does not run in it), startup.ts
host/                utility process (entry: host-entry.ts)
  host-entry.ts, host.ts, host-settings.ts, server-settings.ts, models.ts, tailnet.ts,
  remote-access-plugin.ts, cloudflare-tunnel*.ts, cloudflared.ts, browser-tools.ts
workers/             codemode-worker.ts, codemode-runtime.ts, image-worker.ts, image-runtime.ts, usage-worker.ts
shared/              process-neutral (no electron import; reachable from both entries)
  ipc.ts, host-port.ts, app-menu.ts, browser-page.ts, browser-picker.ts, canvas-preview.ts (existing)
  + host-rpc.ts, host-messages.ts, host-account.ts, host-browser-agent.ts, browser-agent.ts, browser-report.ts,
    ipc-call.ts, ipc-inputs.ts, errors.ts, launch-state.ts, desktop-settings.ts, connect-config.ts,
    account-session.ts, host-window.ts, ../account/policy.ts, scheme.ts, protocol.ts
preload/             unchanged
renderer/            + account/provider.tsx, account/clerk.tsx ← src/account/
fixtures/            ← main/fixtures/ (e2e-only; update E2E_FIXTURES paths in electron.vite.config.ts:18-21)
```

`desktop/src/account/` is deleted: its renderer files go to `renderer/` and its main-process files to `main/account/` or `shared/`.

## 4. First changes, in order

Each step is a pure move plus import rewrites, done with a TypeScript move-file refactor so every importer is updated. Lab and docs deep-import app paths, so each commit must update them in the same change. Gate every step on `pnpm check && pnpm cycles && pnpm --dir packages/app test && pnpm --dir packages/desktop test`.

1. **Add a folder-layer check in report-only mode** next to `scripts/check-cycles.mjs`. It should list folder-level edges that point the wrong way under the §3 ordering. The baseline is the edges in finding 4, and each later step must shrink that list. Make it fail once step 5 lands.
2. **Create `app/src/contract/` and move the eight contract files into it** (finding 2). Pull `DesktopWindow` out of `tabs/window-tabs.ts` into it, and add the `"./contract/*"` export. This touches about 45 desktop imports and no behaviour. Desktop main and preload then import only from `contract/`.
3. **Extract the shared leaf folders `lib/format.ts`, `diff/`, `canvas/` and `references/`** (findings 4 and 11). Move `TranscriptSkeleton` into chat, the sidebar view schema into `preferences/`, and `ComposerImageAttachment` beside the drafts. This breaks the conversation↔workbench, screens↔conversation, preferences→chrome and layout↔conversation folder cycles before any large folder moves.
4. **Remove `chrome/`** into `settings/`, `environments/`, `customize/`, `account/`, `sidebar/` and `shell/`. Split `router.tsx` into `shell/shell.tsx` and `shell/routes.tsx`, move `app.tsx`'s event switch to `shell/host-events.ts`, and merge `layout/` + `screens/` into `panes/` (findings 1 and 5). Lab imports `chrome/sidebar.stylex.ts`, `chrome/titlebar.stylex.ts` and `chrome/connection-list.tsx`, so update lab in the same commit.
5. **Split the data layer and the two oversized feature folders.** Turn `sdk.tsx` and `queries.ts` into `data/*` (finding 3). Add the `chat/*` and `workbench/*` subfolders and split `workbench/controller.ts` (findings 6 and 7). Then split desktop `main/` into `main/`, `host/`, `workers/` and `shared/` (finding 8). The build inputs in `electron.vite.config.ts:131-138` are the only build paths that change. Last, drop `"./*"` from `app/package.json` in favour of explicit exports.
