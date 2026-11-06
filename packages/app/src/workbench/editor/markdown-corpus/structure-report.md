# Desktop app structure and navigation review

Scope: the snapshot at `/tmp/review-code` only. No documentation, source edits, builds, tests, or dev servers were used. Counts below come from the filesystem and a TypeScript-AST import analysis; conclusions about responsibilities come from reading the implementations. Paths are relative to the snapshot root. `app/` and `desktop/` in citations abbreviate `packages/app/src/` and `packages/desktop/src/`.

## 1. How it works today

Electron main starts a separate utility-process host, creates native windows, registers IPC, and restores the application (`desktop/main/index.ts:402–437`, `:502–564`, `:601–755`, `:820–901`); the utility entry constructs `DesktopHost` and serves requests over transferred ports (`desktop/main/host-entry.ts:97–117`, `:174–177`). Preload exposes the desktop bridge, and the renderer installs its port-backed transport before starting the shared React application (`desktop/preload/index.ts:93–201`; `desktop/renderer/src/install-bridge.ts:25–44`; `desktop/renderer/src/main.tsx:27–39`, `:72–96`). The app combines a QueryClient, SDK watch stores, plugin renderers, and host-event subscriptions (`app/app.tsx:33–150`; `app/queries.ts:79–120`; `app/sdk.tsx:154–365`; `app/client-plugins.tsx:21–84`). The router also renders the titlebar/sidebar and chooses between the workspace, customization, environments, and settings; window tabs synchronize with routes, panes select chats inside those tabs, and a separate workbench controller owns tool tabs (`app/router.tsx:147–263`, `:376–474`; `app/tabs/use-window-tabs.tsx:32–116`; `app/layout/pane-context.tsx:8–28`; `app/workbench/controller.ts:42–68`, `:728–998`). Session screens compose conversation and workbench views, while window exposure derives which chats count as visible/read (`app/screens/session-screen.tsx:165–192`; `app/window/index.ts:60–151`). `@nyte-ai/ui` supplies primitives and tokens; canvas content runs in a separately built, sandboxed shell, reached through the app's iframe/protocol adapter rather than an ordinary app-to-canvas import (`packages/canvas/src/kit/index.ts:1–57`; `app/conversation/canvas-frame.tsx:383–494`; `packages/app/vite.ts:146–167`; `desktop/main/renderer.ts:16–95`).

## 2. Findings, ordered by impact

The **What** column states observed facts. **Why it hurts** states the structural consequence I infer, not a reproduced behavioral defect.

| Where | What | Why it hurts | Change |
| --- | --- | --- | --- |
| **1. Root data and platform modules**. `app/queries.ts:68–75`, `:79–120`, `:426–662`, `:721–960`; `app/sdk.tsx:22–26`, `:154–405`, `:477–663`; `app/bridge.ts:2–3`, `:494–554` | `queries.ts` is 960 lines with **56 production importing files**. It owns session actions, workspaces, files, Git, models, usage, plugins, and startup connection/loading. `sdk.tsx` is 663 lines with **49 importing files**, combining connection installation, generic watches, React subscriptions, transcript pacing/paging, and resource watches. Data code imports usage policy from `chrome/usage-view.ts` and reference/status code from `conversation/`. The bridge contract obtains connection types from the renderer's `sdk.tsx`. | A newcomer cannot locate an operation by its domain. Moving a feature is difficult because its data, streaming policy, and transport types have unrelated owners. The generic names conceal a large share of the application, rather than defining a small foundation. | Keep a leaf QueryClient/key registry and generic connection/watch runtime. Put queries, mutations, and resource watches beside their features. Put transcript streaming under chat. Make platform contracts independent of renderer implementations. Split the hubs, migrate every importer, then delete the old hubs rather than leaving forwarding barrels. |
| **2. Navigation and shell ownership**. `app/router.tsx:147–263`, `:289–348`, `:418–474`; `app/tabs/use-window-tabs.tsx:32–116`; `app/chrome/shell-state.ts:55–98`; `app/chrome/use-show-session.ts:6–25`; `app/shell/window-commands.ts:1–19`, `:44–69`; `app/window/index.ts:60–132`, `:176–186` | Navigation is distributed across the root router, `tabs/`, `layout/`, `screens/`, `chrome/`, `shell/`, `window/`, and settings-return handling. The router owns shell JSX, keyboard/menu handling, startup selection, route validation, and route construction. `use-show-session.ts` actually exports workspace activation; tabs import it from chrome. Active tab → route and route → active tab synchronization live in one hook but outside the router. | Finding the owner of “open this chat,” “return from settings,” or “which chat is visible?” requires following surface names instead of one navigation model. This is not evidence of a selection bug or redundant tab systems: window tabs, panes, and workbench tabs represent different things. | Make `shell/navigation/` the address for window-tab, pane, location, command, and visibility behavior. Keep the router as route assembly and the shell as visual composition. Move workspace activation to workspaces. Give the three models explicit entry points; do not merge their state machines. |
| **3. Conversation and workbench are feature warehouses with shared code between them**. `app/workbench/changes-panel.tsx:18–33`; `app/workbench/changes-stack.tsx:19–26`; `app/workbench/open-reference.ts:1–5`; `app/conversation/canvas-frame.tsx:35–40`, `:311–380`; `app/conversation/tray/tray.tsx:12`; `app/workbench/controller.ts:307–398`, `:548–652`, `:728–998` | Conversation has **92 non-test files / 18,827 lines**; workbench has **53 / 15,198**. There are **17 workbench → conversation** and **8 conversation → workbench** file-pair dependencies. Some are common rendering/reference infrastructure, not conversation behavior. Canvas embedding lives in conversation but is also used by the canvas panel; its host component knows about workbench placement. The 998-line workbench controller combines types, persistence, geometry, state transitions, singleton installation, and hooks. | Folder names do not predict ownership. A file-editor/diff change leads into conversation, and a canvas-frame change leads into changes-viewed storage. Large entry components make it hard to distinguish panel composition from panel behavior. | Extract app-shared code/diff/reference rendering and file-drag primitives; give canvas integration its own feature. Group chat into composer, transcript, tools, trays, streaming, and drafts. Group workbench by panel concept, with a small layout/state host. Split the controller and the major panel orchestrators at the operation boundaries listed below. |
| **4. Chrome owns settings, accounts, connection management, and usage**. `app/settings/pages.ts:3–5`, `:27–45`; `app/settings/profile.tsx:3–17`; `app/chrome/customize.tsx:24–49`, `:357–500`; `app/chrome/usage-view.ts:1–67`; `app/preferences/index.ts:4`, `:131–135`; `app/chrome/sidebar-view.ts:45–78` | Chrome contains 52 non-test files / 11,132 lines, including providers settings, profile settings, usage derivation/settings, customization, connection management, and remote-device/tunnel UI. Settings imports chrome through five file pairs; chrome imports settings through six. Preferences imports the sidebar view-model module for its schema/default. `usage-view.ts` is a pure 655-line model/formatting module despite its location and name. | “Chrome” becomes the default home for unrelated features. A developer looking under settings will miss substantial settings implementations. A preference schema drags ownership toward a presentation module even though its data can stand alone. | Reserve shell chrome for titlebar, sidebar, palettes, and overlays. Move account, catalog/providers, usage, customization, connections, and workspace selection to named features. Keep settings as the page registry and settings-specific layout. Extract the sidebar preference schema/default into a leaf preferences module. |
| **5. Desktop folders do not expose the real process boundaries**. `desktop/main/index.ts:195–237`, `:326–437`, `:502–564`, `:601–755`, `:778–922`; `desktop/main/host.ts:282–320`, `:439–511`, `:603–921`; `desktop/account/provider.tsx:9–24`; `desktop/account/operations.ts:1–3`; `desktop/account/policy.ts:33–170`; `desktop/main/renderer.ts:4–10` | `main/` has **60 non-test files / 10,043 lines**, including utility-host implementation and workers. Both `index.ts` and `host.ts` are 922 lines. `account/` mixes React provider/deferred Clerk loading, Node-side pending operations, IPC contracts, application/canvas schemes, CSP, file serving policy, and account validators. Main → account has 11 file pairs; account → main has one value dependency. Browser automation's 885-line runtime mixes injected scripts, schemas, reference encoding, CDP input, and capture. | A directory named main does not say which process executes a module; account does not say whether importing it is safe in a renderer. Native-window lifecycle and host-domain changes have large, unrelated reading surfaces. These are ownership problems, not proof that privileged code currently enters the renderer bundle. | Separate `main/`, utility-process `host/`, `preload/`, `renderer/`, and leaf `shared/` contracts. Put account runtime code under its process. Split native windows/IPC/lifecycle out of main composition; split host connections/workspaces/activity out of `DesktopHost`; split browser page scripts, validation, and CDP operations. Preserve the existing preload/renderer boundary. |

### 2.1 Measured footprint

Physical lines include blanks/comments. “Non-test” excludes `*.test.ts[x]`, `*.browser-test.tsx`, `*.fixtures.ts`, `fixtures/`, and the two `app/src/break/` harness files; it includes stylesheets, declarations, and HTML. This is a source-footprint measure, not a bundled-size measure. The snapshot's chrome count is 52 by this definition, rather than the approximate 55 in the question.

| App source location | All files | All lines | Non-test files | Non-test lines |
| --- | ---: | ---: | ---: | ---: |
| Root | 50 | 6,745 | 36 | 5,095 |
| `account/` | 1 | 56 | 1 | 56 |
| `break/` | 2 | 194 | 0 | 0 |
| `chats/` | 5 | 795 | 2 | 416 |
| `chrome/` | 69 | 13,675 | 52 | 11,132 |
| `components/` | 14 | 1,636 | 9 | 1,019 |
| `conversation/` | 158 | 29,569 | 92 | 18,827 |
| `layout/` | 8 | 2,108 | 6 | 1,913 |
| `preferences/` | 4 | 390 | 4 | 390 |
| `screens/` | 24 | 4,587 | 13 | 2,089 |
| `settings/` | 22 | 1,980 | 21 | 1,958 |
| `shell/` | 3 | 200 | 3 | 200 |
| `tabs/` | 9 | 2,057 | 6 | 1,519 |
| `theme/` | 11 | 779 | 9 | 712 |
| `web/` | 16 | 2,236 | 15 | 2,147 |
| `window/` | 5 | 597 | 3 | 315 |
| `workbench/` | 87 | 19,216 | 53 | 15,198 |
| **Total** | **488** | **86,820** | **325** | **62,986** |

Conversation, workbench, and chrome contain 45,157 non-test lines, about 72% of app source. `screens/` and `components/` name roles, not concepts; `chrome/` and `workbench/` name surfaces but also own domains. The proposal keeps surface names where they really are composition boundaries.

| Other source location | All files / lines | Non-test files / lines |
| --- | ---: | ---: |
| `desktop/src/account/` | 6 / 808 | 6 / 808 |
| `desktop/src/main/` | 97 / 18,186 | 60 / 10,043 |
| `desktop/src/preload/` | 3 / 345 | 3 / 345 |
| `desktop/src/renderer/` | 4 / 234 | 4 / 234 |
| `desktop/src/shared/` | 6 / 729 | 6 / 729 |
| **Desktop total** | **116 / 20,302** | **79 / 12,159** |
| `ui/src/` root | 42 / 8,191 | 42 / 8,191 |
| `ui/src/styles/` | 12 / 2,112 | 12 / 2,112 |
| `canvas/src/kit/` | 9 / 1,420 | 9 / 1,420 |
| `canvas/src/shell/` | 4 / 444 | 4 / 444 |

### 2.2 Who imports whom, and cycles

Counts are **unique directed source-file → target-file pairs**, combining imports and re-exports, including type-only edges. Multiple imports of one target from one source count once. Internal relative paths and `@nyte-ai/app`, `@nyte-ai/ui`, and `@nyte-ai/canvas` source subpaths were resolved. Tests/harnesses were excluded. Module-script injection, iframe messages, IPC, and build-generated assets are not static import edges.

Complete app cross-folder adjacency, excluding imports within the same folder:

| Importing folder | Imported app folders: file-pair count |
| --- | --- |
| Root | chrome 12; conversation 10; tabs 8; workbench 6; layout 3; preferences 3; shell 2; window 2; screens 1; settings 1; theme 1 |
| account | None |
| chats | root 4 |
| chrome | root 82; theme 17; tabs 11; layout 9; components 7; settings 6; chats 5; preferences 5; window 3; workbench 3; conversation 2; shell 2 |
| components | root 5; chats 2 |
| conversation | root 63; theme 20; preferences 14; components 12; workbench 8; layout 7; window 4; chats 2; settings 2; chrome 1; screens 1 |
| layout | root 2; conversation 1; tabs 1; workbench 1 |
| preferences | root 8; chrome 1; theme 1 |
| screens | conversation 25; root 22; layout 15; workbench 6; chrome 4; theme 2; window 2; chats 1; components 1; shell 1; tabs 1 |
| settings | root 13; preferences 10; theme 7; chrome 5; components 1; conversation 1; tabs 1 |
| shell | root 4; chrome 2; workbench 2; layout 1; settings 1; tabs 1 |
| tabs | layout 5; root 5; components 3; chats 1; chrome 1; theme 1; window 1 |
| theme | preferences 1; root 1 |
| web | root 16; theme 3; account 2 |
| window | root 4; chats 2; tabs 2; layout 1; workbench 1 |
| workbench | root 72; conversation 17; components 10; preferences 8; theme 6; layout 4; chrome 2; shell 2; chats 1; settings 1 |

`break/` is excluded, not disconnected production code.

**No static value-import file cycles were found in the four scoped source packages.** Including erased type imports produces one 170-file strongly connected component. For example, `sdk.tsx:22` imports startup's read gate, while `startup.ts:2` imports the complete router type; that router reaches SDK consumers. `bridge.ts:2` similarly refers back to SDK implementation types. These are compile-time dependency tangles, not observed runtime initialization cycles. Reciprocal folder imports do not by themselves prove a file-level cycle.

Desktop cross-folder counts within desktop are main → shared 14, main → account 11, account → main 1, preload → shared 4, preload → account 1, renderer → shared 2, and renderer → account 1. Desktop also has **45 import declarations referring into app source**, covering contracts, boot/theme/deferred APIs, action definitions, browser shortcuts, and web origins. Examples of value dependencies outside the app entry are `desktop/main/app-menu.ts:10–11` and `desktop/main/host.ts:18`.

Package-boundary import declarations, with unique importing files in parentheses:

| Importing package | `@nyte-ai/ui` | `@nyte-ai/canvas` | `@nyte-ai/host` |
| --- | ---: | ---: | ---: |
| app source | 690 (169) | 0 | 0 |
| desktop source | 9 (3) | 0 | 10 (5) |
| canvas source | 35 (8) | 0 | 0 |

The desktop host imports belong to host-side implementations/workers, not the shared React client. I found no client-source import of `@nyte-ai/host`. UI has no reverse dependency on app or canvas. Do not move app stores or bridge consumers into UI merely to shorten app imports.

The canvas zero is intentional: `packages/app/vite.ts:146–167` serves/copies its built shell; `desktop/main/index.ts:797–811` and `desktop/main/renderer.ts:69–95` locate/serve that artifact. `app/conversation/canvas-frame.tsx:411–454` handles protocol messages; `packages/canvas/src/shell/main.tsx:299–325` handles the other side. Any migration must check these non-import connections too.

Caller checks used in the findings: `queries.ts` has 56 importing files; `sdk.tsx` has 49, of which 47 have a value import; `workbench/controller.ts` has 22, of which 14 have a value import. Canvas-frame's two production importing files are `client-plugins.tsx:11` and `workbench/canvas-panel.tsx:14`. `chrome/use-show-session.ts` has two: `chrome/sidebar.tsx:72` and `tabs/use-window-tabs.tsx:7`. None of these modules is dead. Neither is zero-import `router-register.ts`: its module augmentation is intentional (`app/router-register.ts:1–8`).

### 2.3 Files at or above 600 lines

There are 24 non-test app files at this threshold, three desktop files, two UI files, and one canvas file. None exceeds 1,000 lines. This threshold locates reading costs; it is not a rule that every stylesheet or cohesive algorithm must be split.

| Area | Files and measured lines |
| --- | --- |
| App root | `queries.ts` 960; `sdk.tsx` 663 |
| Chrome | `sidebar.tsx` 671; `usage-view.ts` 655; `customize.tsx` 654; `usage-settings.tsx` 637 |
| Conversation | `composer-suggestions.tsx` 881; `transcript.tsx` 879; `composer.tsx` 845; `turn-view.tsx` 838; `transcript-rows.ts` 725; `composer.stylex.ts` 712; `subagent-call.tsx` 640; `composer-frame.tsx` 614 |
| Layout | `session-view-state.ts` 681 |
| Workbench | `controller.ts` 998; `changes-panel.tsx` 944; `browser-panel.tsx` 898; `workbench.tsx` 800; `files-panel.tsx` 729; `terminal-store.ts` 706; `changes-commit-bar.tsx` 682; `file-editor.tsx` 624 |
| Web | `account-screen.tsx` 610 |
| Desktop main | `index.ts` 922; `host.ts` 922; `browser-runtime.ts` 885 |
| UI | `menu.tsx` 650; `styles/theme.stylex.ts` 632 |
| Canvas | `kit/charts.tsx` 669 |

## 3. Proposed target shape

This is a destination, not a request for one large rename commit. Existing filenames generally survive the initial moves. Feature entry points are named components/operations, not barrels exporting every internal file. Keep the public app entry at `src/index.ts`.

```text
packages/app/src/
  index.ts                         public renderer startup/App entry
  vite-env.d.ts
  bootstrap/                       App providers, host-event wiring, startup, first frame
  platform/
    contracts/                     bridge/action/connection types; no renderer implementations
    bridge.ts                      installed NyteBridge facade
    connection.ts                  renderer connection installation/access
    watches/                       generic store, registry, scheduling, React subscriptions
    query-client.ts
    query-keys.ts
    preferences/                   preference storage and leaf definitions
    deferred/                      entry manifest, loader, generated-URL placeholder
    links/
  shell/
    shell.tsx                      titlebar/sidebar/main/overlays composition
    workspace-stage.tsx            chat panes + workbench placement
    sidebar/
    titlebar/
    palette/
    overlays/
    navigation/
      router.tsx                   route assembly, errors, validation
      window-tabs/                 window documents/places, state, route synchronization, strip
      panes/                       pure layout, pane controller, context, DnD, pane host
      visibility/                  exposure/read projection and stage integration
      commands.ts                  renderer command dispatch
  features/
    chat/
      data/                        directory, sessions, actions, configuration
      streaming/                   session watch, paging, pacing, activity
      drafts/                      draft/view-state model, codec, stores
      composer/                    entry: composer.tsx
        suggestions/
      transcript/                  entry: timeline.tsx; viewport and rows below it
      tools/
      trays/
      cards/
      session-conversation.tsx     chat feature composition
    workspaces/                    selection, activation, open dialog, workspace queries/context
    workbench/
      state/                       tab model, controller, persistence, installed state/hooks
      layout/                      retained views, rail, panel selection, sizing
      browser/                     entry: browser-panel.tsx
      changes/                     entry: changes-panel.tsx
      files/                       entry: files-panel.tsx
      terminal/                    entry: terminal-panel.tsx
      canvas-tab.tsx               workbench adapter for the canvas feature
      panels.deferred.tsx          intentional deferred boundary, not a general barrel
    canvas/                        frame protocol/theme/height + transcript adapter
    catalog/                       model catalog, picker, provider settings/login
    usage/                         queries, derivation/formatting, settings surface/charts
    account/                       profile, account footer, shared account appearance
    connections/                   environments, server/remote/connect/device UI
    customize/                     plugins, MCP, skills, plugin settings
    settings/                      page registry, settings navigation/layout, app settings pages
  shared/
    code/                          code/diff/highlight rendering and worker support
    rich-text/                     prose, mermaid, links, images
    references/                    typed message references and opener contract
    components/                    app-local domain-free presentation
    hooks/
    state/
    overlays/                      DOM overlay rectangle tracking
    diagnostics/
  styles/                          existing app theme/boot/fonts/style modules
  web/                             web entry and web-only connection/account flows

packages/desktop/src/
  main/
    index.ts                       Electron composition only
    startup.ts
    windows/                       creation, frames, restoration, lifecycle
    ipc/                           validated request routing and native call handlers
    browser/                       native surfaces, sessions, history, automation, picker
    account/                       Clerk/native account session + pending operations
    assets/                        renderer/canvas schemes, CSP, file serving
    canvas/                        offscreen preview
    updates/
    native/                        CLI, fonts, external URLs, context menu
    host-process.ts                parent-side utility-process supervisor
  host/
    entry.ts                       utility-process composition
    desktop-host.ts                small host facade
    runtime/                       service opening, settings, activity
    workspaces/
    connections/                   server, connect, remote exposure, tunnels
    account.ts                     utility-side account proxy
    browser-tools.ts               host plugin + utility-side agent proxy
    workers/
  preload/                         keep the three constrained entry points
  renderer/
    index.html
    src/main.tsx                   shared app composition
    src/install-bridge.ts
    src/devtools.tsx
    src/account/                   AccountProvider + deferred Clerk runtime
  shared/                          IPC/account/host/browser contracts and port transport

packages/ui/src/                   remain the domain-independent design system
packages/canvas/src/
  kit/                             canvas-facing composition API over UI
  shell/                           sandbox runtime, protocol, module loading
```

Dependency rules for this layout:

- Shell/bootstrap compose features. Features can use platform contracts/runtime, shared renderers, and leaf navigation models; they should not import shell JSX, the settings page registry, or bootstrap coordinators. Use existing opener/action callbacks at composition seams instead of importing an entire sibling surface.
- Workbench tool tabs and window tabs remain distinct. Persisted keys, tab discriminants, route URLs, command IDs, and window/pane IDs do not change in a folder move.
- Generic watches do not import chat rendering or startup coordination. Connection replacement and watch-reset wiring must not introduce a new connection ↔ registry value cycle. Startup read gating becomes a leaf module, not an import of the whole coordinator.
- Shared code/reference/canvas protocol primitives do not import the workbench controller. Canvas placement and reference-opening decisions belong to the transcript/workbench adapters.
- Main/host/preload depend on leaf bridge types, not a React implementation type. The utility process may import host/core implementations; renderer code may not.
- Retain the deliberate deferred loading and iframe boundaries. Do not replace their entry modules with an eager feature-wide barrel.

### 3.1 Every loose app-root file

Left-hand paths in this table are relative to `packages/app/src/`. Multiple destinations indicate an implementation split, not copies of the same implementation.

| Current file | Destination |
| --- | --- |
| `action-toasts.ts` | `features/chat/data/action-toasts.ts` |
| `app.tsx` | `bootstrap/app.tsx`; host-event dispatch → `bootstrap/host-events.ts`; saved terminal restoration → a workbench terminal operation called by bootstrap |
| `bridge.ts` | Split into `platform/contracts/{bridge,connection,host,browser,usage,connections,updates,window,account}.ts`; preserve one explicit contract-facing export path, with no renderer value imports |
| `catalog.ts` | `features/catalog/catalog.ts` |
| `client-actions.ts` | `platform/contracts/client-actions.ts`; remains the one shared action definition/key-resolution implementation used by desktop menus and the app |
| `client-plugins.tsx` | `bootstrap/client-plugins.tsx`; preserve single plugin registration owner |
| `deferred-entries.ts` | `platform/deferred/entries.ts` |
| `deferred-urls.ts` | `platform/deferred/urls.ts` |
| `deferred.tsx` | `platform/deferred/loader.tsx` |
| `derived-store.ts` | `shared/state/derived-store.ts` |
| `errors.ts` | `platform/errors.ts`; IPC result/failure types can live in `platform/contracts/errors.ts` |
| `file-ranking.ts` | `features/workbench/files/file-ranking.ts` |
| `first-frame.ts` | `bootstrap/first-frame.ts` |
| `index.ts` | Keep; update its explicit exports to moved implementations |
| `nyte.ts` | `platform/bridge.ts`; keep one installed bridge, not one bridge per feature |
| `open-external.ts` | `platform/links/open-external.ts` |
| `pierre-worker-provider.tsx` | `shared/code/pierre-worker-provider.tsx` |
| `queries.ts` | Split by operation into the feature/platform files in §3.5; delete old file after migration |
| `query-keys.ts` | `platform/query-keys.ts`; keep the small coherent registry, with key values unchanged |
| `route-session.ts` | `shell/navigation/routes/session.ts` |
| `router-register.ts` | `shell/navigation/router-register.ts`; retain its compiler-only augmentation role |
| `router.tsx` | Route assembly → `shell/navigation/router.tsx`; Shell/ShellChrome → `shell/shell.tsx`; workspace-stage selection → `shell/workspace-stage.tsx`; startup-arrival selection → `shell/navigation/arrival.ts` |
| `schemas.ts` | `features/chat/data/schemas.ts` |
| `sdk.tsx` | Split into `platform/connection.ts`, `platform/watches/*`, feature resource watches, and `features/chat/streaming/*`; delete the old file |
| `session-actions.ts` | `features/chat/data/session-actions.ts`; keep the actual queued/optimistic action operation |
| `session-configuration.ts` | `features/chat/data/session-configuration.ts` |
| `session-list.ts` | `features/chat/data/session-list.ts` |
| `startup-failure.tsx` | `bootstrap/startup-failure.tsx` |
| `startup.ts` | `bootstrap/startup.ts`; read-gate state → `platform/startup-read-gate.ts` |
| `updates.ts` | Merge its update-label operation into `platform/contracts/updates.ts` |
| `use-blob-url.ts` | `shared/hooks/use-blob-url.ts` |
| `use-debounced-value.ts` | `shared/hooks/use-debounced-value.ts` |
| `use-now-minute.ts` | `shared/hooks/use-now-minute.ts` |
| `view-helpers.ts` | `conversationTurns`/`TurnMessages` → `features/chat/data/turns.ts`; workspace name/path → `features/workspaces/presentation.ts`; worktree projection → `features/workbench/changes/worktree-files.ts`; delete mixed helper file |
| `vite-env.d.ts` | Keep at root |
| `work-counts.ts` | `shared/diagnostics/work-counts.ts` |

The remaining 14 root files are existing tests, not loose production modules:

| Current test file(s) | Destination |
| --- | --- |
| `client-actions.test.tsx` | `platform/contracts/client-actions.test.tsx` |
| `client-rules.test.ts` | `packages/app/test/client-rules.test.ts`; its current package-root calculation still has the same depth (`app/client-rules.test.ts:6–13`) |
| `derived-store.test.ts` | `shared/state/derived-store.test.ts` |
| `first-frame.test.ts`, `startup.test.ts` | Same basenames under `bootstrap/` |
| `router-preload.test.ts` | Same basename under `shell/navigation/` |
| `sdk.test.ts`, `watch-notifications.test.ts`, `watch-notifications.browser-test.tsx` | Same basenames under `platform/watches/`; keep integration assertions while updating imports |
| `session-actions.test.ts`, `session-list.test.ts` | Same basenames under `features/chat/data/` |
| `session-selection.test.ts`, `session-selection.browser-test.tsx` | Same basenames under `shell/navigation/window-tabs/` |
| `usage-query.test.ts` | `features/usage/usage-query.test.ts` |

### 3.2 Every other small app folder

For a directory move, all listed files move with their existing basenames unless an arrow gives a rename. Existing adjacent tests/fixtures follow their subject; do not create replacement tests or delete the existing ones.

| Current source | Destination / disposition |
| --- | --- |
| `account/appearance.tsx` | `features/account/appearance.tsx` |
| `break/account-footer.tsx`, `break/install.ts` | `packages/app/test/break/`; update the explicit script entry in `packages/app/break-account-footer.html:22`. These are a wired harness, not dead code. |
| `chats/directory.ts`, `chats/index.ts` | `features/chat/data/directory.ts`, `features/chat/data/chat-directory.ts`; keep the derived directory and its public selectors together |
| `layout/pane-context.tsx`, `pane-controller.ts`, `pane-layout.ts`, `session-dnd.ts`, `session-dnd-geometry.ts` | `shell/navigation/panes/` |
| `layout/session-view-state.ts` | Split under `features/chat/drafts/`, described below |
| `tabs/model.ts`, `places.ts`, `use-window-tabs.tsx`, `window-tab-strip.tsx`, `window-tab-strip.stylex.ts`, `window-tabs.ts` | `shell/navigation/window-tabs/`; `DesktopWindow` contract type → `platform/contracts/window.ts` so preload/IPC no longer name a tab implementation |
| `window/exposure.ts`, `window/index.ts`, `window/tray.ts` | `shell/navigation/visibility/exposure.ts`, `chat-window.ts`, `tray.ts`; stage/router subscription remains app integration, separate from pure exposure calculation |
| `shell/focus-owner.ts` | `shell/navigation/focus-owner.ts` |
| `shell/search.ts` | `shell/navigation/search.ts` |
| `shell/window-commands.ts` | `shell/navigation/commands.ts` |
| `screens/session-screen.tsx`, `session-screen.stylex.ts` | `shell/workspace-stage.tsx`, `shell/workspace-stage.stylex.ts`; merge the router's WorkspaceRouteStage selection here, keeping chat-pane and workbench composition in the shell |
| `screens/pane-host.tsx`, `pane-header.tsx`, `split-sash.tsx` | `shell/navigation/panes/` |
| `screens/session-conversation.tsx`, `blank-conversation.tsx` | `features/chat/` |
| `screens/transcript-skeleton.tsx` | `features/chat/transcript/transcript-skeleton.tsx`; removes conversation → screens import (`app/conversation/timeline.tsx:13`) |
| `screens/context-selector.tsx`, `context-selector.stylex.ts`, `workspace-context.tsx` | `features/workspaces/` |
| `screens/environment-menu.tsx` | `features/connections/environment-menu.tsx` |
| `screens/model-configuration.ts` | `features/catalog/model-configuration.ts` |
| Screen test exceptions | Session-screen-render tests and fixture → `shell/`; session-switching tests → `shell/navigation/window-tabs/`; warm-sessions tests → `features/chat/streaming/`; other screen tests follow their moved subject |
| `components/chat-card.tsx`, `chat-card-facts.ts` | `features/chat/cards/` |
| `components/ui.tsx` | StatusDot/UnreadMark → `features/chat/cards/status-mark.tsx`; `formatTimeAgo` → `shared/format-time.ts`. These are the actual unrelated exports (`app/components/ui.tsx:88–140`); delete `ui.tsx`. |
| `components/animated-number.tsx`, `text-roll.tsx`, `sortable-strip.tsx`, `copy-confirmation.ts`, `context-menu.ts`, `file-type-icon.tsx` | `shared/components/`; keep app-local rather than expanding the design system's public API |
| `preferences/{host,index,plugin,store}.ts` | `platform/preferences/`; extract sidebar schema/default from `chrome/sidebar-view.ts:14–78` into `platform/preferences/sidebar.ts`, leaving grouping/projection in sidebar |
| `settings/` | Move intact to `features/settings/`, except `return.ts` → `shell/navigation/settings-return.ts`. Settings navigation receives or imports a leaf return operation, not the shell view. |
| `theme/` | Move intact to `styles/`; update all boot/CSS consumers, including desktop and web entrypoints |
| `web/` | Keep as the alternative client entry, not part of Electron main. Move only `origins.ts` → `platform/contracts/origins.ts`, since utility-host policy imports it. Split `account-screen.tsx` only as described below. |

`settings/` remains the owner of page metadata, capability filtering, layout, appearance/general/editor/browser/terminal/source-control pages, and common rows/font controls. It composes account/catalog/usage feature pages; it should not absorb those domains' non-settings code.

### 3.3 Conversation file-by-file placement

Source directory: `packages/app/src/conversation/`. Each comma-separated filename below is an individual move into the destination directory. These rows account for all 92 non-test files, including the five tray files.

| Existing filenames | Destination |
| --- | --- |
| `composer.tsx`, `composer-frame.tsx`, `composer-chip.tsx`, `composer-context.tsx`, `composer-document.ts`, `composer-editor.tsx`, `composer-files.ts`, `composer-history.ts`, `composer-keys.ts`, `composer-model-chip.tsx`, `composer-queue.tsx`, `composer-send.ts`, `composer-surface.tsx`, `composer.stylex.ts`, `draft-start.ts`, `plugin-command.ts`, `mention-preview.ts` | `features/chat/composer/` |
| `composer-suggestions.tsx`, `composer-suggestion-ranking.ts` | `features/chat/composer/suggestions/`; split the former below |
| `composer-file-drop.ts` | `shared/references/file-drop.ts`; the existing tree-drag state and DOM-file binding have both file-panel and composer consumers (`app/workbench/files-panel.tsx:26`; `app/conversation/composer-file-drop.ts:16–84`) |
| `model-picker.tsx`, `model-picker-state.ts` | `features/catalog/` |
| `canvas-frame.ts`, `canvas-frame.tsx`, `canvas-theme.ts` | `features/canvas/`; rename the protocol-only `.ts` file to `frame-protocol.ts` to distinguish it from JSX; split the JSX component below |
| `code-block.tsx`, `code.deferred.tsx`, `diff-expansion.ts`, `diff-view.tsx`, `diff.stylex.ts`, `highlight-code.ts`, `highlight.deferred.ts` | `shared/code/` |
| `external-link.ts`, `image-preview.tsx`, `mermaid-diagram.tsx`, `mermaid-render.ts`, `mermaid-worker.ts`, `prose.tsx`, `prose.stylex.ts`, `chunk-fade.tsx` | `shared/rich-text/`; retain the worker URL relationship. Split prose's chat/data adapters from its shared renderer as described below. |
| `message-references.ts`, `reference-opener.tsx`, `part-origin.ts` | `shared/references/`; keep schema parsing at the reference boundary and pass typed references inward |
| `session-activity.ts`, `paced-text.ts` | `features/chat/streaming/`; presentation pacing is no longer a dependency of the generic platform watch store |
| `activity.stylex.ts`, `live-turn.tsx`, `message-content.tsx`, `planning-time.ts`, `raw-part.tsx`, `reasoning-heading.ts`, `row-surfaces.tsx`, `step-group-content.ts`, `step-group-open.ts`, `step-group-pin.ts`, `step-group-presentation.ts`, `step-group.stylex.ts`, `step-group.tsx`, `thinking-line.tsx`, `timeline.tsx`, `transcript-mode.ts`, `transcript-presentation.ts`, `transcript-render-counter.ts`, `transcript-rows.ts`, `transcript-scroll.ts`, `transcript-unread-view.tsx`, `transcript-unread.ts`, `transcript.stylex.ts`, `transcript.tsx`, `turn-recovery.tsx`, `turn-view.tsx`, `turn.stylex.ts` | `features/chat/transcript/` |
| `edit-call.tsx`, `edit-patch.ts`, `shell-background.ts`, `shell-call.tsx`, `subagent-call.tsx`, `subagent-call.stylex.ts`, `subagent-sessions.ts`, `subagent-status.ts`, `terminal-text.ts`, `tool-call.tsx`, `tool-line.tsx`, `tool-output.tsx` | `features/chat/tools/`; activity/status portions used by data code may join chat's streaming model rather than importing a view |
| `add-to-chat.ts` | `features/chat/composer/add-to-chat.ts`; keep this one real cross-feature operation for browser/diff/terminal additions, rather than duplicating it in each panel |
| `approval-state.ts`, `approval-tray.tsx` | `features/chat/trays/` |
| `tray/agents.tsx`, `tray/questions-state.ts`, `tray/questions.tsx`, `tray/terminals.tsx`, `tray/tray.tsx` | `features/chat/trays/` |

The prose move is not a blind rename. `app/conversation/prose.tsx:18–19`, `:35`, `:61–66`, `:181–201` currently embeds file-query policy and SubagentCitation. Move `useCitableFiles` to the file-data owner, pure `linkReference` to `shared/references/link-reference.ts`, and the agent-link renderer to `features/chat/transcript/prose.tsx`. The shared markdown renderer receives typed file data and its chat-specific link component through a narrow adapter. Its fade implementation moves with it. Canvas uses the pure link resolver and file data, not the full chat prose module (`app/conversation/canvas-frame.tsx:45–49`). This avoids creating shared → chat/workbench dependencies during extraction.

The rendering extraction must include its lower-level dependencies. In particular, move `patchDigest` out of `workbench/changes-viewed.ts:59–72` to `shared/code/content-digest.ts`; both diff rendering and canvas height identity use it. Leave viewed-file persistence in changes. Move the genuinely shared label/constants part of `workbench/change-tree.ts:3–9` to `shared/code/change-summary.ts`; keep changes filtering/selection in the changes feature. Do not move all workbench storage into shared just to make imports resolve.

### 3.4 Workbench file-by-file placement

Source directory: `packages/app/src/workbench/`. These rows account for all 53 non-test files.

| Existing filenames | Destination |
| --- | --- |
| `controller.ts` | Split into `features/workbench/state/{model,geometry,persistence,controller,state}.ts`; details below |
| `workbench.tsx`, `workbench.stylex.ts`, `workbench-rail.tsx`, `tab-strip.tsx`, `rail-status.tsx` | `features/workbench/layout/`; split `workbench.tsx` below |
| `panels.deferred.tsx` | `features/workbench/panels.deferred.tsx`; remains the loading boundary for files/changes/terminal |
| `browser-address-field.tsx`, `browser-address.ts`, `browser-bookmarks.ts`, `browser-downloads.tsx`, `browser-find.tsx`, `browser-history.ts`, `browser-login.tsx`, `browser-panel.tsx`, `browser-shield.tsx`, `browser-shortcuts.ts`, `browser-suggestions.ts`, `browser-surfaces.ts` | `features/workbench/browser/`; shared main/renderer shortcut definitions → `platform/contracts/browser-shortcuts.ts` rather than a desktop import of panel code |
| `browser-occlusion.ts` | `shared/overlays/rectangles.ts`; also used by chat tray overlays, not owned by the browser surface |
| `canvas-panel.tsx` | `features/workbench/canvas-tab.tsx`; imports the neutral frame API from `features/canvas/` |
| `canvas-activity.ts` | `features/canvas/activity.ts` |
| `change-scopes.ts`, `change-stats.tsx`, `change-tree.ts`, `changes-commit-bar.tsx`, `changes-panel.tsx`, `changes-patches.ts`, `changes-pull-request.tsx`, `changes-sidebar.tsx`, `changes-stack-code-view.ts`, `changes-stack.tsx`, `changes-toolbar.tsx`, `changes-view-options.ts`, `changes-viewed.ts`, `stacked-diff.ts` | `features/workbench/changes/`; shared digest and change-summary exports leave these files as described above |
| `diff-range.ts` | `shared/references/diff-range.ts` |
| `file-document.ts`, `file-editor.tsx`, `file-store.ts`, `file-tree.tsx`, `files-empty-state.tsx`, `files-panel.tsx`, `workspace-search.tsx`, `tree-theme.ts`, `find-widget.tsx` | `features/workbench/files/`; changes can import the explicitly shared tree theme if necessary, without depending on the FilesPanel |
| `open-reference.ts` | `features/workbench/open-reference.ts`; remains the adapter from typed references to workbench actions |
| `ghostty.deferred.ts`, `ghostty.ts`, `terminal-panel.tsx`, `terminal-runtime.ts`, `terminal-store.ts`, `terminal.stylex.ts` | `features/workbench/terminal/` |

### 3.5 Split the data hubs by operation, not by framework API

The source line ranges are navigation aids for extraction, not instructions to copy text ranges without following their helpers.

| Existing section | New owner |
| --- | --- |
| `queries.ts:79–89` QueryClient; small key registry | `platform/query-client.ts`, `platform/query-keys.ts` |
| `queries.ts:91–120`, `:190–199`, `:309–424`, `:894–896`, `:954–960` session actions/read/search/configuration | `features/chat/data/{queries,actions,configuration}.ts`; merge with the moved session action/configuration modules where it is the same operation |
| `queries.ts:125–128`, `:164–166`, `:242–307`, `:840–842` workspace listing/selection/forget | `features/workspaces/{queries,selection}.ts` |
| `queries.ts:130–162`, `:577–590`, `:686–719`, `:806–836` catalog/listings/default model | `features/catalog/{queries,mutations}.ts` |
| `queries.ts:168–188`, `:426–523`, `:541–560` file/Git capability access and changes | File capability accessor → `features/workbench/files/api.ts`; Git accessor/changes → `features/workbench/changes/{api,queries}.ts` |
| `queries.ts:525–539`, `:562–575`, `:592–662` scanning/document/search/save | `features/workbench/files/queries.ts`; return shared typed reference data without importing a composer view |
| `queries.ts:203–240`, `:664–684` host/update/server/remote/release | Host/update state → `platform/host-state.ts`; server/remote → `features/connections/queries.ts`; release → a named workspace/host operation, not a generic query hub |
| `queries.ts:721–777` usage/account limits | `features/usage/queries.ts`; colocate freshness policy with usage data, not chrome |
| `queries.ts:779–804`, `:898–952` plugin catalog/settings | `features/customize/data/{catalog,settings}.ts`; composer consumes catalog data without importing CustomizeSurface |
| `queries.ts:844–892` connection and local-resource loading | `bootstrap/connect-host.ts`, `bootstrap/load-local-resources.ts`; these orchestrate the feature loaders |
| `sdk.tsx:28–88`, `:407–454` endpoint/problem/connection | Types → `platform/contracts/connection.ts`; installation/access → `platform/connection.ts`; classification → `platform/connection-problem.ts` |
| `sdk.tsx:90–405` generic watches | `platform/watches/{store,registry,notifications,react}.ts`; one implementation of each, no new wrapper per feature |
| `sdk.tsx:456–475`, `:477–644` session lists/children/transcript paging, warming, pacing | `features/chat/streaming/{session-watch,session-lists,paging}.ts`; the existing pacer/activity modules join this feature |
| `sdk.tsx:604–613` part watches | `platform/watches/parts.ts` if kept generic; canvas consumes this API, not a transcript implementation |
| `sdk.tsx:646–663` jobs/MCP/Git resource watches | `features/workbench/terminal/jobs-watch.ts`, `features/customize/data/mcp-watch.ts`, `features/workbench/changes/git-watch.ts` |

Keep the current QueryClient, cache keys, optimistic projection behavior, and connection/watch registries. The change is ownership, not the introduction of a second cache or a new event system. Remove `startup.ts` → full router-type coupling by typing the coordinator's actual load capability, rather than importing the entire app router just for `load` (`app/startup.ts:2–8`).

### 3.6 Chrome file-by-file placement

Source directory: `packages/app/src/chrome/`. These rows account for all 52 non-test files.

| Existing filenames | Destination |
| --- | --- |
| `sidebar.tsx`, `sidebar.stylex.ts`, `sidebar-content.tsx`, `sidebar-filter.tsx`, `sidebar-filter.stylex.ts`, `sidebar-lists.tsx`, `sidebar-navigation.ts`, `sidebar-pane.tsx`, `sidebar-rows.tsx`, `sidebar-view.ts`, `use-sidebar.ts` | `shell/sidebar/`; sidebar preference schema/default extracted to `platform/preferences/sidebar.ts` |
| `titlebar.tsx`, `titlebar.stylex.ts` | `shell/titlebar/` |
| `search-palette.tsx`, `search-palette.stylex.ts`, `palette-legend.tsx`, `palette-legend.stylex.ts` | `shell/palette/` |
| `about-dialog.tsx` | `shell/overlays/about-dialog.tsx` |
| `shell-state.ts` | Split sidebar/overlay presentation state into `shell/state.ts`; place/stage commands join `shell/navigation/commands.ts` and window-tab selectors. Delete the old mixed file. |
| `use-chrome-tab.ts`, `use-settings-open.ts` | `shell/navigation/use-place-section.ts`, `shell/navigation/use-settings-open.ts`; names describe what is read/changed |
| `use-show-session.ts` | `features/workspaces/activate-workspace.ts`; this is the actual exported operation, with its existing two callers migrated |
| `open-workspace.tsx` | `features/workspaces/open-workspace.tsx` |
| `account-footer.tsx`, `profile-settings.tsx`, `github-account.ts` | `features/account/` |
| `models-settings.tsx`, `models-settings.stylex.ts`, `login-attempts.ts`, `sign-in-panels.tsx` | `features/catalog/` |
| `usage-charts.deferred.ts`, `usage-settings.tsx`, `usage-settings.stylex.ts`, `usage-view.ts` | `features/usage/`; split model/formatting and page sections below |
| `customize.tsx`, `customize.stylex.ts`, `customize-mcp.tsx`, `customize-parts.tsx` | `features/customize/` |
| `cloud-connection.tsx`, `connect-devices.tsx`, `connect-view.ts`, `connection-list.tsx`, `device-rows.tsx`, `environments.tsx`, `link-tray.tsx`, `nyte-connection.tsx`, `pairing-code.tsx`, `remote-devices.tsx`, `remote-share.tsx`, `remote-tunnel.tsx`, `server-settings.tsx`, `status-glyph.tsx` | `features/connections/`; settings/profile/customize compose their named operations/components rather than importing chrome |

### 3.7 Concrete splits for oversized implementations

Do these after their dependency owners are clear. Splitting a component into a same-sized hook plus a view is not automatically an improvement; extract a named operation or independently understandable view. Keep one state owner for each transaction, editor, viewport, and terminal feed.

| Existing file / verified seam | Proposed files and retained entry |
| --- | --- |
| `workbench/controller.ts` 998. Types/options `:13–294`; schemas/codec/storage `:307–418`, `:548–652`; geometry `:502–546`; transitions/controller `:661–957`; installed state/hooks `:959–998` | `state/model.ts`, `geometry.ts`, `persistence.ts`, `controller.ts`, `state.ts`. Keep state transitions together; isolate validation/localStorage at persistence boundary. No view/deferred imports in the pure model. |
| `workbench/workbench.tsx` 800. Rail/open/prefetch `:99–179`; floating/compact layout `:181–326`; panel dispatch `:328–489`; retained/resizable hosts `:491–800` | `layout/rail.tsx`, `floating-panel.tsx`, `panel-content.tsx`, `view-host.tsx`, `workbench.tsx`. Retain an exhaustive six-kind panel switch, not an unnecessary dynamic registry. Keep deferred panel lookup in composition. |
| `workbench/changes-panel.tsx` 944. Patch-row preparation `:223–337`; revert `:340–364`, `:714–741`; data/scope/patch source `:420–573`; viewed handling `:609–679`; session adapter `:897–925` | `changes/patch-sections.ts`, `change-source.ts`, `revert-file.ts` plus `revert-dialog.tsx`, `viewed-actions.ts`, `session-changes.tsx`, and a smaller `changes-panel.tsx`. Preserve patch lineage/freshness in the existing patch-loader owner, not in multiple hooks. |
| `workbench/browser-panel.tsx` 898. Native placement `:218–320`; frame fallback `:322–332`; picker-to-chat `:369–385`; native surface lifetime/URL/event synchronization `:427–497` | `browser/surface-placement.ts`, `surface-lifecycle.ts`, `page-frame.tsx`, `picked-element.ts`, and `browser-panel.tsx` as controls/composition. Share existing surface store; do not introduce another native-surface owner. |
| `workbench/files-panel.tsx` 729. File-tree setup/context menus/open/drag `:183–302`, alongside editor tabs, search, discard and save UI | `files/explorer.tsx` owns tree interaction; `file-context-menu.ts` owns menu construction; existing `workspace-search.tsx` remains search; `files-panel.tsx` composes explorer/search/editor group and a bounded discard dialog. Retain `file-store.ts` as tab/document state owner. |
| `workbench/terminal-store.ts` 706. Output attachment/printing `:158–227`; save/restore `:229–286`; SDK jobs/spawn/recovery/follow `:288–511`; public state/actions `:513–706` | `terminal/output.ts`, `persistence.ts`, `job-feeds.ts`, `terminal-store.ts`. Keep shell/job ownership checks and stop/close semantics in the feed operation, not in rendering. |
| `workbench/changes-commit-bar.tsx` 682. Action planning/result presentation before `:297`; storage `:297–312`; actual revision-fenced operation `:360–434`; UI `:444–682` | `changes/commit-plan.ts`, `commit-result.ts`, `commit-action.ts`, `commit-preference.ts`, `changes-commit-bar.tsx`. Keep the branch → commit → push → PR transaction and revision progression in one operation. |
| `workbench/file-editor.tsx` 624. Minimal text replacement `:146–184`; disk subscription `:186–199`; document-kind boundary `:201–223`; text editor `:226`; search `:588` | `files/editor/text-replacement.ts`, `disk-sync.tsx`, `editor-find.tsx`, `text-file-editor.tsx`, and `file-editor.tsx` as the document-kind boundary. Do not extract the trivial createEditor wrapper merely to make another file. |
| `layout/session-view-state.ts` 681. Persistence decoding `:239–253`; window draft ownership `:259–483`; per-tab facade `:486–681` | `chat/drafts/model.ts`, `codec.ts`, `persistence.ts`, `window-drafts.ts`, `session-view-state.ts`. Preserve the one window-owned draft collection and its per-tab view; do not change storage format during the split. |
| `conversation/composer.tsx` 845. Draft/queued-edit state `:139–147`, `:199–278`; floating portal movement `:159–193`; the entry also wires catalog, questions and session operations | `chat/composer/composer.tsx` remains composition; `queued-edit.ts` owns held-message/edit lifecycle; `draft-controller.ts` owns draft/recall/attachment transitions; `composer-mount.tsx` owns inline/floating placement. Reuse existing `composer-send.ts`, `composer-queue.tsx`, and document/editor modules, rather than rebuilding them in a new controller. |
| `conversation/composer-suggestions.tsx` 881. Token/source model `:28–153`; keyboard/select behavior `:605–708`; menu rendering `:710–881` | `composer/suggestions/model.ts`, `tokens.ts`, `command-completion.ts`, `use-suggestions.ts`, `suggestion-menu.tsx`; retain existing ranking implementation in `composer-suggestion-ranking.ts`. Keep current/live-token validation with selection, not split across two independent menu states. |
| `conversation/composer-frame.tsx` 614. Geometry `:153–235`; attachment view `:281–336`; form/editor/drop/controls `:338–614` | `composer/frame-geometry.ts`, `attachments.tsx`, `composer-controls.tsx`, and `composer-frame.tsx`. Share geometry state within the frame; avoid a universal form abstraction. |
| `conversation/transcript.tsx` 879. Provider `:172–212`; virtualizer/anchor/history `:214–649`; row markup `:651–720`; DOM inputs `:723–843`; bottom button `:845–879` | `transcript/context.tsx`, `viewport.tsx`, `viewport-input.tsx`, `dock-input.tsx`, `scroll-button.tsx`; move measurement snapshot persistence into a bounded viewport operation. Keep the anchor/follow state machine and virtualizer together; existing `transcript-mode.ts` and `transcript-scroll.ts` remain the algorithm owners. |
| `conversation/transcript-rows.ts` 725. Row construction `:149–387`; incremental projection `:388–622`; estimates `:624–725` | `transcript/rows/build.ts`, `projector.ts`, `estimates.ts`, plus leaf row types. Preserve the incremental fast path and stable row identities; no second implementation for full renders. |
| `conversation/turn-view.tsx` 838. User editor `:171–422`; outside-click lifecycle `:423–457`; changes card/footer `:476–571`; response/actions `:679–756`; dispatcher `:757` | `transcript/user-message.tsx`, `user-message-editor.tsx`, `turn-changes.tsx`, `response.tsx`, `reply-actions.tsx`, `turn-view.tsx`. Editing can reuse composer contracts without making code/diff rendering import the user editor. |
| `conversation/subagent-call.tsx` 640. Call UI, report line `:472–534`, citation preview `:536–640` | `tools/subagent-call.tsx`, `subagent-report.tsx`, `subagent-citation.tsx`. Shared child-session data remains in the existing session/status modules. |
| `conversation/canvas-frame.tsx` 518, below threshold but crosses several concepts. Height cache `:168–222`; frame `:237–305`; transcript/workbench placement `:311–380`; protocol shell `:383–494`; plugin registration `:496–518` | `features/canvas/{height-cache,frame,shell-client,transcript-canvas,plugin}.ts[x]`; protocol-only sibling → `frame-protocol.ts`. Neutral frame takes opening/placement inputs; workbench and transcript adapters own their placement actions. |
| `chrome/sidebar.tsx` 671. Workspace activation/read/neighbor operations `:85–121`, followed by a large shell view `:156–671` | `shell/sidebar/actions.ts`, `sidebar.tsx`; move workspace activation to workspaces. Keep existing sidebar lists/rows/filter/view modules instead of inventing parallel ones. Further split only a bounded workspace/draft section, not one file per event handler. |
| `chrome/customize.tsx` 654. Plugin presentation/model `:51–136`; plugin rows/details; PluginsTab `:357–403`; SkillsTab `:429–466`; surface `:468–654` | `customize/plugin-model.ts`, `plugins-tab.tsx`, `skills-tab.tsx`, `customize.tsx`. Keep the already extracted MCP tab and shared parts. |
| `chrome/usage-view.ts` 655 and `usage-settings.tsx` 637. Formatting `usage-view.ts:93–190`; data model `:29–67`; page components `usage-settings.tsx:111`, `:200`, `:284`, `:370`, `:468` | `usage/format.ts`, `calendar.ts`, `derive.ts`, `limits.ts`; `range-picker.tsx`, `spend-card.tsx`, `limits-card.tsx`, `breakdown-table.tsx`, `usage-settings.tsx`. These are usage modules, not shared generic utilities. |
| `web/account-screen.tsx` 610. Desktop list `:79–135`; AccountFlow `:142–544`; boundary `:546–598` | `web/account/desktop-list.tsx`, `account-flow.tsx`, `account-screen.tsx`; keep one enrollment/account-flow state owner. This is secondary to the desktop structural changes. |

The direct `useEffect`/`useLayoutEffect` calls in these files are real departures from the supplied rules, for example `app/workbench/browser-panel.tsx:228`, `:430–495` and `app/conversation/transcript.tsx:461–632`. Moving them into a newly named hook does not make them compliant. When rewriting these boundaries, use mount-scoped owners, ref lifetimes, derivation, or external-store subscriptions as appropriate; do not mechanically replace before-paint measurement with a mount effect and claim equivalent behavior. This review does not claim that visual timing has been verified.

### 3.8 Desktop file-by-file placement and splits

Paths in this table start at `packages/desktop/src/`. Existing tests/fixtures follow the executing process/concept and their imports must be updated in the same change.

| Current file(s) | Destination / split |
| --- | --- |
| `main/index.ts` | Keep composition entry. Window construction/frame/show/restore/close → `main/windows/{manager,frame,lifecycle}.ts`; validated IPC registration/native call table → `main/ipc/{register,native-calls}.ts`; app readiness/suspend/quit → `main/lifecycle.ts`. Keep one window registry, injected into IPC/browser/account adapters. |
| `main/startup.ts` | Keep as the early process entry dependency |
| `main/launch-state.ts`, `main/host-window.ts` | `main/windows/launch-state.ts`, `shared/host-window.ts` |
| `main/host-process.ts` | Keep parent-side process supervisor under main |
| `main/host-entry.ts` | `host/entry.ts`; output entry name remains `host-entry.js` |
| `main/host.ts` | `host/desktop-host.ts`, with runtime opening/settings/activity → `host/runtime/{open,settings,activity}.ts`; selection/open/close workspace → `host/workspaces/selection.ts`; server and remote exposure → `host/connections/{server,remote-access}.ts` |
| `main/host-settings.ts`, `main/desktop-settings.ts`, `main/models.ts` | `host/runtime/settings-plugin.ts`, `shared/desktop-settings.ts`, `host/runtime/models.ts` |
| `main/connect-config.ts`, `main/server-settings.ts`, `main/remote-access-plugin.ts`, `main/tailnet.ts`, `main/cloudflare-tunnel.ts`, `main/cloudflare-tunnel-store.ts`, `main/cloudflared.ts` | `host/connections/` with existing basenames; connect configuration/schema portions shared with main move to a leaf shared config module |
| `main/host-account.ts` | Split `answerAccount` → `main/account/answer.ts`; `RemoteAccount` → `host/account.ts`; ask/answer types → `shared/account-rpc.ts`. The current file contains both sides (`desktop/main/host-account.ts:4–15`, `:50`). |
| `main/host-browser-agent.ts` | Split `answerAgent` → `main/browser/answer-agent.ts`; `remoteAgent` → `host/browser-agent.ts`; wire types → `shared/browser-agent-rpc.ts` (`desktop/main/host-browser-agent.ts:9–31`, `:65`) |
| `main/host-messages.ts`, `main/host-rpc.ts` | `shared/host-messages.ts`, `shared/rpc.ts`; replace references to implementation-derived host types with leaf wire types where necessary |
| `main/usage-worker.ts`, `main/codemode-worker.ts`, `main/codemode-runtime.ts`, `main/image-worker.ts`, `main/image-runtime.ts` | `host/workers/`; retain the existing emitted filenames and runtime URL relationships |
| `main/account.ts`, `main/account-keeper.ts`, `main/account-session.ts`, `main/account-store.ts`, `account/operations.ts` | `main/account/{register,keeper,session,store,operations}.ts` |
| `account/provider.tsx`, `account/clerk.tsx` | `renderer/src/account/` |
| `account/protocol.ts` | `shared/account.ts`; schema-derived wire types must not depend on a main policy file |
| `account/policy.ts` | Account answer/report schemas → `shared/account-schema.ts`; publishable-key/frontend-host checking → `shared/account-config.ts`; renderer/shell CSP and renderer file routing → `main/assets/{csp,files}.ts` |
| `account/scheme.ts` | Application/account/canvas scheme constants → `shared/schemes.ts`; sign-in return URL helper stays with `main/account/` |
| `main/renderer.ts` | `main/assets/renderer-protocol.ts`; renderer/canvas serving is not an account implementation |
| `main/canvas-preview.ts` | `main/canvas/preview.ts` |
| `main/ipc-call.ts`, `main/ipc-inputs.ts` | `main/ipc/{call,inputs}.ts`; preserve one boundary decoder for each incoming request |
| `main/errors.ts` | `shared/ipc-errors.ts`; retain diagnostic/error handling at process boundaries |
| `main/app-menu.ts` | `main/windows/app-menu.ts`; imports leaf action/shortcut definitions rather than app panel files |
| `main/context-menu.ts`, `main/external-url.ts`, `main/fonts.ts`, `main/cli.ts` | `main/native/` |
| `main/update-controller.ts`, `main/update-settings.ts`, `main/updates.ts` | `main/updates/` |
| `main/adblock.ts`, `main/browser.ts`, `main/browser-actions.ts`, `main/browser-agent-surface.ts`, `main/browser-downloads.ts`, `main/browser-guest-session.ts`, `main/browser-history.ts`, `main/browser-picker-page.ts`, `main/browser-picker.ts`, `main/browser-policy.ts`, `main/browser-runtime.ts`, `main/browser-surface-events.ts`, `main/browser-surface.ts` | `main/browser/`; split runtime as below, without moving native surfaces into the renderer |
| `main/browser-agent.ts`, `main/browser-report.ts` | `shared/browser-agent.ts`, `shared/browser-report.ts`; shared agent contract/reference formatting, not an Electron surface implementation |
| `main/browser-tools.ts`, `main/browser-stub.ts` | `host/browser-tools.ts`, `host/browser-stub.ts`; keep host plugin/stub separate from the main-side native agent |
| `shared/app-menu.ts`, `shared/browser-page.ts`, `shared/browser-picker.ts`, `shared/canvas-preview.ts`, `shared/host-port.ts`, `shared/ipc.ts` | Keep in shared; update contract imports. In particular `shared/ipc.ts:2` must no longer import DesktopWindow from app's window-tab implementation. |
| `preload/index.ts`, `preload/browser-page.ts`, `preload/canvas-preview.ts` | Keep these constrained entries; update paths only. No host/workspace domain logic moves into preload. |
| `renderer/index.html`, `renderer/src/main.tsx`, `renderer/src/install-bridge.ts`, `renderer/src/devtools.tsx` | Keep; add the relocated renderer account files alongside them |

The 885-line browser runtime has concrete seams: ref encoding/escaping at `desktop/main/browser-runtime.ts:18–60`; injected scripts at `:62–192`; schemas and isolated-world result validation at `:194–279`; keyboard mapping/CDP input at `:282–362`, `:443–493`; runtime/console state at `:374–411`; snapshot/check/actions at `:495–867`. Split into `main/browser/{references,page-scripts,page-result,cdp-input,runtime-state,snapshot,actions}.ts`. Keep unknown isolated-world results validated in `page-result.ts`, not separately revalidated inside every action. Keep the one native surface registry.

For `DesktopHost`, extract service opening and activity first, then workspace selection, then server connection and remote exposure. The facade should compose operations and dispatch typed calls; do not merely move all 922 lines into a new class file and call the split complete. For main, extract the window manager before IPC so there is one concrete owner for window lookup, lifecycle, and broadcasting.

### 3.9 What stays separate, what gets merged or deleted

- **Keep UI separate.** Its app/desktop/canvas use is extensive but points in the right direction. `ui/src/menu.tsx` and `styles/theme.stylex.ts` are not evidence that app-domain logic belongs in UI. No package extraction is needed for this review's main fixes.
- **Keep canvas kit and sandbox shell separate.** Kit composes UI exports (`packages/canvas/src/kit/index.ts:1–57`); shell handles untrusted module execution, protocol, theme application, and height reporting (`packages/canvas/src/shell/main.tsx:249–325`, `:379–388`). App adapters remain outside the sandbox package. A later local split of the 669-line `kit/charts.tsx` into bar/line/pie plus chart-common is reasonable, but not a prerequisite for app navigation; keep `kit/index.ts`'s public shape unchanged.
- **Delete after replacement:** root `queries.ts`, `sdk.tsx`, `view-helpers.ts`, `updates.ts`, and `components/ui.tsx`; old `chrome/shell-state.ts`; old canvas/desktop policy aggregates. These are implementation extractions, not dead-code findings. Do not leave duplicate implementations or permanent compatibility barrels.
- **Merge:** root session mutation hooks with the moved session action/configuration owner; router workspace-stage selection with workspace-stage composition; shell-state's place commands with navigation command handling; shared digest/reference implementations across consumers. Keep the deliberately different window-tab, pane, and workbench models separate.
- **Remove emptied directories:** old `chrome/`, `screens/`, `layout/`, `tabs/`, `window/`, `conversation/`, and `components/` only after their production files and adjacent tests have moved. The new `features/chat/` and `features/workbench/` are not flat replacements: their subfolders are part of the change.
- **No unreferenced-code purge.** Ambient registrations, worker entries, module-script entries, HTML harnesses, and IPC implementations can have few/no ordinary import callers. Their build/protocol callers were considered; none is proposed for deletion on an import-count argument.

## 4. First five changes, in buildable order

Each numbered item is a sequence of small commits, not one commit per whole section. Every move updates all source/test/build consumers atomically. No permanent old-path shims are needed.

1. **Create leaf contracts and remove the root's accidental dependencies.** Move connection/window/action/bridge types into platform contracts; extract the startup read gate, QueryClient, sidebar preference schema, shared references/diff digest, and rich-text/code primitives. Update the existing importing files in the same commit. This gives later feature moves real destinations instead of new circular barrels. Check package typechecks, existing app/desktop tests, and value-import cycles after each extraction.
2. **Split queries and streaming by feature while filenames are otherwise stable.** Start with usage and files/Git, then catalog/customization, sessions/actions, and startup orchestration. Split generic watch runtime from chat pacing/paging. Keep a single cache/connection/watch registry throughout; migrate each operation's callers before deleting its old export. Use the existing usage-query, SDK, watch-notification, session-action, and startup tests. Finish by deleting the two root hubs.
3. **Make navigation and the visual shell discoverable.** Extract Shell from the router, move workspace activation, group window tabs/panes/visibility/commands, then relocate chrome's real feature pages. Move chat/workbench files by the ledger, one coherent group at a time. Replay existing selection, session-switching, missing-session, settings-return, and session-screen tests. Preserve route URLs, persisted IDs/keys, and the intentional window-tab ↔ route synchronization.
4. **Split the large workbench/chat operations without changing ownership twice.** Start with controller model/persistence/state, workbench panel composition, changes data/revert/viewed operations, and browser surface lifetime/placement. Then transcript viewport/row projection, composer editing/suggestions, and draft persistence. Use existing controller, panel, transcript, composer, draft, and browser tests. Do not combine this with new features, persisted-format migrations, or visual redesigns.
5. **Expose Electron's real process boundaries.** Move renderer/main account implementations first; extract native window management and IPC from main composition; extract utility-host runtime/workspace/connection operations; group native browser modules and split automation. Preserve all compiled worker/preload filenames. Build desktop and canvas and run existing desktop QA before declaring this migration complete.

### Build-path checklist for those changes

These are observed non-obvious coupling points, not optional cleanup:

- `packages/app/package.json:6–15` exports arbitrary source subpaths. Update deep consumers throughout the snapshot, not just under app. The desktop alone has 45 import declarations into app. Retain a small explicit startup/contracts/deferred/style export surface where cross-package access is genuinely needed.
- `app/deferred-entries.ts:1–35` contains both type references and `new URL(...)` source paths. `packages/app/vite.ts:71–79` hard-codes the URL-placeholder module. Update both when moving code/highlight/usage/workbench/ghostty entries. Preserve the build's deferred-package leakage check at `packages/app/vite.ts:113–141`.
- `desktop/account/provider.tsx:22–25` augments the deferred-runtime module by its exact path. Update it with the loader manifest move. `packages/desktop/electron.vite.config.ts:39–44` independently names the deferred Clerk source.
- `packages/desktop/electron.vite.config.ts:131–146`, `:157–163` names main/host/worker/preload input files and runtime chunk identities. Update source paths atomically while preserving output labels. Native window creation still expects emitted preload paths (`desktop/main/index.ts:614–622`), and host startup expects `host-entry.js` (`desktop/main/index.ts:402–405`).
- Browser picker build input is also explicit (`packages/desktop/electron.vite.config.ts:9`, `:115–121`). Canvas serving uses artifact directories/protocol URLs, not a resolvable TS import.
- Update moved test fixtures, HTML entry scripts, import-meta-relative worker URLs, router augmentation inclusion, and both desktop/web theme boot imports. Do not infer completeness from TypeScript import resolution alone.

**Verification performed for this report:** filesystem/line inventory; TypeScript-AST static dependency graph with type-only imports separated for cycle analysis; concrete importer counts; source tracing of composition, navigation, streaming, panel, canvas, IPC, and process boundaries; build-entry inspection. **Not verified:** typecheck/build/test success, application runtime behavior, layout/scroll/focus timing, or the proposed target graph after implementation. Review emphasis was reader load, domain ownership, boundary direction, and deletion of replaced aggregates; it was not a visual, security, or full code-style audit.
