# Workbench review: model vs view

Scope: `packages/app/src/workbench/**`, and the places that mount it or drive it: `screens/session-screen.tsx`, `chrome/titlebar.tsx`, `shell/window-commands.ts`, `app.tsx`, `screens/session-conversation.tsx`, `conversation/*` openers. Every finding below comes from reading the code. Lines marked **(inference)** are conclusions I drew and did not run.

---

## 1. How it works today

One persisted store, `workbenchController` (`controller.ts:728-968`), holds a `WorkbenchViewState` for each workspace. The key is the workspace path, or `"home"` (`controller.ts:123-127`). Each view state holds an ordered `tabs` list, plus `active`, `expanded`, `collapsed`, `layout` and `width` (`controller.ts:199-206`). The store writes to localStorage on every publish (`controller.ts:744-752`, `631-652`).

The store's actions are closures, not pure reducers. They live inside the factory (`controller.ts:775-945`), and so do the de-duplication rules (`sameTab`, `controller.ts:661-690`). The factory also holds a second "waiting" tab list that depends on code-splitting (`controller.ts:736-739`, `793-828`, `959-968`).

Per-tab runtime state lives in separate module-level stores, all keyed by tab id:
- File drafts, history and pending close: `file-store.ts:87-339`. This store wraps the controller and calls its actions.
- Shells and jobs: `terminal-store.ts:91-681`.
- Native browser surfaces: `browser-surfaces.ts:22-186`. This store also writes URLs back into the controller (`browser-surfaces.ts:95-102`).

Rules for what to show and what to open are computed inside components:
- `workbench.tsx` renders the rail ("Open Tabs" `245-271`, "On <repo>" launchers `273-289`), the compact bar (`294-326`), the empty-state launcher (`711-728`) and `PanelContent`. `PanelContent` builds every `updateTab` patch inline (`328-489`).
- `workbench.tsx` also owns a second module store, the most recently visited views (`54-77`), and per-tab sidebar visibility in React state (`511`).
- The tab strip, which mounts in the titlebar (`chrome/titlebar.tsx:241`), implements its own label, icon, "+" menu, new-terminal and close/confirm policy (`tab-strip.tsx:167-319`, `539-596`).
- Status rows derive branch and changed-files text in `rail-status.tsx:144-211`.
- `changes-panel.tsx:397-895` holds roughly 300 lines of scope, row, patch-key, empty-state and viewed-state derivation inside one component.

---

## 2. Findings, ordered by impact

| # | Where | What (seen) | Why it hurts | Change |
|---|---|---|---|---|
| 1 | `workbench.tsx:245-289`, `controller.ts:661-690` | **This is the rail symptom.** "Open Tabs" lists every tab (`251-269`). "On <repo>" lists every launcher kind regardless of what is open. Only Changes is filtered out, and only when the Changes status row shows (`280`). Each launcher calls `openTab`, whose de-dup rule differs by kind. **files/changes** always match an existing tab (`681-683`). **browser** matches only a tab whose *current* URL equals `about:blank` (`675-676`, `487`). **user terminal** never matches; only agent terminals de-dup (`667-674`). | Four rows that look the same behave differently: Files and Changes focus the open tab, Terminal always opens a new tab, and Browser does either one depending on where the open tab has navigated. This is why the rail shows Files/Browser/Terminal in both sections, plus a growing list of identical "Terminal" rows. No single rule explains it, and the rule sits in a private function the rail can't ask. | Give every tab kind one descriptor in the model: `{ label, icon, available(scope, caps), launch: "singleton" \| "new", defaultInput }`. Add a pure selector `railModel(view, …)` that returns `{ openTabs, launchers }`. Launchers for singleton kinds that are already open are dropped. "new" kinds are labelled "New Terminal" / "New Browser". The rail only renders the result. |
| 2 | `open-reference.ts:38-49` vs `51-54`; `conversation/message-references.ts:351-377`; `conversation/tool-line.tsx:236-241`; `file-store.ts:122-130` | **The file tab outside the workspace.** The `skill` reference checks that the path is under the workspace root (`52-54`). The `file` reference does not (`38-49`). `fileFromUrl` accepts any `file://` path. Tool "read" lines build such a reference for any path the agent read, for example `/tmp/…png`. `file-store` then sets `displayPath` to the absolute path (`130`). `restoreSnapshot` keeps the tab after restart (`controller.ts:581-583`). | The Files panel only works on workspace files, yet it accepts any path, so outside files get editor tabs that save through `workspaceFiles()`. The rail shows `/tmp/…png` as a workspace tab. | Make one `workspaceFile(root, absPath): { abs, relative } \| undefined` check at the boundary (`openFile` command). Paths outside the root return `undefined`, so the opener offers no action or uses `openExternal`. The file tab stores the relative path. |
| 3 | `workbench.tsx:133-153`, `tab-strip.tsx:186-194`, `tab-strip.tsx:546-557`, `shell/window-commands.ts:60-70` | "Open a tab of kind K" is written three times. "New terminal" (`openTab` followed by `terminalActions.create`) is written four times. `openWorkbenchTab` checks availability against a hard-coded `{kind:"project"}` scope (`144`), not the real scope. | Each launcher surface (rail, compact bar, empty state, "+" menu, terminal context menu, menu command) can drift on its own. Some already have: the "+" menu skips the availability check. | Add a single `commands.ts` with `launch(view, kind)` and `newTerminal(view)`. Every surface calls it. Delete `openWorkbenchTab`, `newTerminal` and `openTerminal`. |
| 4 | `tab-strip.tsx:266-319` | The close policy lives in the tab-strip component: a dirty file asks for confirmation, a running shell asks `idle()` and then confirms, a job closes, and anything else calls `controller.closeTab`. `controller.closeTab` (`controller.ts:840-852`) knows nothing about the terminal or file stores. Other callers close tabs directly (`conversation/canvas-frame.tsx:336`). | Closing correctly takes a component. Any new close path (menu command, agent, view eviction) has to re-learn three stores, or it leaks a shell or drops a draft. Today only canvas tabs are closed from elsewhere, so this is a trap, not a live bug **(inference)**. | Move this into `commands.closeTab(view, id)`, which returns `{ kind: "closed" } \| { kind: "confirm", reason: "dirty" \| "running" }`. The strip keeps only the dialogs. |
| 5 | `changes-panel.tsx:438-707` | About 270 lines of pure derivation sit in the component body: `activeScope` fallback, `recordedSource`, `workingRows`, row source, `patchKey` and lineage strings, the empty-state precedence chain, `viewedByPath`, `sidebarFiles` and `scopeStats`. | The view can't be tested without rendering, the rules can't be reused (the rail computes line totals its own way at `rail-status.tsx:189-192`), and changing one rule means reading the whole component. | Extract `changes/changes-model.ts`: `resolveChangesScope(scope, turns, session)`, `changeRows(…)`, `patchSource(…)`, `changesEmptyState(…)`, `viewedStates(…)`, `scopeStats(sections)`. All are pure functions of their inputs. The component keeps the hooks and the JSX. |
| 6 | `changes-panel.tsx:391,575,582-585,920,936`; `384,724` | `turnsError` is passed as `null` at both call sites, so `transcriptError` and `transcriptFailure` never fire. `onRevertPath` is declared and checked, but no caller passes it. I grepped the whole of `src`, tests included. | Dead branches inside the empty-state precedence chain make the chain look harder than it is. | Delete `turnsError`, `queryError(turnsError)`, `transcriptFailure` and the `onRevertPath` prop. |
| 7 | `file-store.ts:100,196-236,328-330` | `fileActions.open` runs up to three controller actions in a row (`closeTab` on the replaceable preview, `openTab`, `updateTab` to pin). A module-level `opening` flag inside `try/finally` stops subscribers being notified in between. The file tab itself (`path`, `preview`) is in the controller, while its runtime (draft, saving, navigation) is in `file-store`. `file-editor.tsx:333-350` copies the buffer's draft into `file-store` through a layout effect. | One concept, the open file, is split across two stores plus a copy. The `opening` flag exists only because the model has no atomic "open file" transition. | Add one pure reducer case, `openFile(view, {path, preview})`. It replaces the preview, adds or focuses the tab, and pins it, in one publish. Delete `opening`. Keep the runtime map in `file-store`, but derive `dirty` from the document buffer instead of copying the draft. |
| 8 | `controller.ts:731,736-739,793-828,870-877,959-968` | The controller depends on code-splitting through `WorkbenchPanels`. While the deferred "workbench" chunk loads, `openTab` keeps file, changes and terminal tabs in a private `waiting` map, and `updateTab` patches them there. `closeTab` and `activateTab` don't look at `waiting`. | Tab state has two lists, and the second is invisible to every selector and to the rail. A `closeTab` during load is ignored, and the tab appears later **(inference)**. `PanelContent` already wraps each panel in `<Deferred>` (`workbench.tsx:351,364,477`). | Delete `WorkbenchPanels`/`waiting`. Add the tab at once and let `<Deferred>` show its fallback. If a blank frame is a real problem, prefetch, which `prefetchWorkbench` already does (`workbench.tsx:155-179`). |
| 9 | `tab-strip.tsx:378-382,407-416` vs `workbench.tsx:252-263`; `tab-strip.tsx:167-174` vs `workbench.tsx:79-86` | Tab label and title are built in two places from three stores, and they disagree. The rail uses `file.displayPath ?? terminal.title ?? workbenchTabLabel`. The strip uses `terminal.title ?? workbenchTabLabel`, which is the basename. `tabIcons` is copied verbatim into both files. | The same tab has different names in the rail and the strip. A new kind needs edits in four places. | Add one selector `tabPresentation(tab, files, terminals)` that returns `{ label, title, icon, dirty, running }`. It lives next to the kind descriptor (finding 1). Delete both `tabIcons`. |
| 10 | `rail-status.tsx:144-160` vs `change-scopes.ts:284-299` | Detached, unborn and ahead/behind are derived twice: `headStatus` for the rail and `branchReadout` for the Changes toolbar. | The two branch readouts can drift: the rail shows `Detached`, the toolbar shows `HEAD`/short oid. | Have the rail call `branchReadout` and format it. Delete `headStatus`. |
| 11 | `controller.ts:102-119` vs `change-scopes.ts:105-122,247` | Scope equality is written twice: `sameChangesScope` (structural) and `changesScopeValue(a) === changesScopeValue(b)`. | There are two ways to answer one question. | Keep `changesScopeValue` in the model next to `WorkbenchChangesScope`. Write `sameChangesScope` as value equality, or delete it. |
| 12 | `controller.ts:934-936`; callers `chrome/titlebar.tsx:284`, `shell/window-commands.ts:133` vs `toggle` at `window-commands.ts:84` | `toggleWorkbench` only calls `toggle`. | Two names for one action. | Delete `toggleWorkbench` and point its two callers at `toggle`. |
| 13 | `workbench.tsx:511,622,642-643` vs `files-panel.tsx:147-148`; `workbench.tsx:54-77` | Sidebar visibility is per-tab React state in `WorkbenchViewHost` for Changes and Browser, but local `useState` in `FilesPanel`. `PanelContent` never passes it to Files (`350-359`). Recently visited views are a third, hand-rolled module store inside the view file. | One UI concept has two owners, and both lose state when the host remounts. Model state is hidden in a `.tsx` file. | Put `sidebar: boolean` on the tab state (pure `toggleSidebar(view,id)`). Move `recentViews` into the store module as `visitView`/`mountedViews` selectors. |
| 14 | `workbench.tsx:208-210,609-611`, `tab-strip.tsx:250`, `session-screen.tsx:172-180`, `titlebar.tsx:140-143`, `window-commands.ts:53-79` | Each caller rebuilds `(view, scope, capabilities)` and filters `workbenchTabAvailable` itself. `views.get(k) ?? workbenchController.getView(k)` is written three times, and `getView` already falls back to the default. The view-key ↔ workspace-path inverse is written by hand (`workbench.tsx:782`, `app.tsx:118-124`), and `file-store.ts:123` treats the key as a path prefix. | Selectors take four arguments, and every call site can build a different scope. One already does: background views get `pathless` (`workbench.tsx:790`), so their Files and Changes panels unmount while Browser and Terminal stay. | Add a hook `useWorkbenchView(workspacePath)` that returns `{ key, view, scope, tabs: visibleTabs, active, shown }`. Add `workspacePathForView(key)` next to `workbenchViewKey`. |
| 15 | `controller.ts:631-652`, `workbench-rail.tsx:18-64`, `changes-view-options.ts:7,71,110`, `changes-viewed.ts:5,95,164`, `terminal-store.ts:229-281`, `browser-bookmarks.ts:36,48`, `changes-commit-bar.tsx:53,300,310` | Seven localStorage-backed stores use five idioms: an injected `WorkbenchPersistence`, a module `let` with try/catch, classes with `#storage`, per-id keys, and a raw read inside a component file. Each hand-rolls `listeners`/`subscribe`. | There are many ways to do one job. The boundary checks differ, and some are missing: `workbench-rail.tsx:40` only does `Number(…)`. | Use one `persisted(key, schema, default)` helper that returns `{ get, set, subscribe }`. Move the commit-action preference out of the component file. |
| 16 | `browser-panel.tsx:4,430-497` | Four direct `useEffect`s (lint-suppressed) drive the native surface lifecycle: hold/release, open-on-URL-drift, focus, key forwarding. The URL is stored twice: on the tab (`controller`) and in `BrowserSurfaceState` (`browser-surfaces.ts:93-101`), and the effect at `442-479` reconciles the two. | The surface exists only while React has the panel mounted, and the two-URL reconciliation is subtle (`hold.url`, `stateUrl`). | Make `browser-surfaces.ts` own the surface for a tab id: `ensureSurface(tabId, url, owner)` when the tab is added or changes URL, and `releaseSurface` from `commands.closeTab`. The panel keeps only placement (`useSurfacePlacement`). |
| 17 | `open-reference.ts:79-97` | To open Changes on a path, it calls `openTab` and then `updateTab` with the same patch. `openTab` ignores the input when `sameTab` matches, and `changes` always matches. | Callers must know that `openTab` is "focus, but don't apply". | Add a reducer case `openChanges(view, { scope, path })` that focuses or creates the tab and applies the change in one step. |
| 18 | `rail-status.test.tsx:22-27` | To test the Changes row label, the test renders markup and strips tags with a regex. | This shows the label rule is stuck in the view. | Make `changesSummary(head)` a pure function and test that. |
| 19 | Code style: `rail-status.tsx:148`, `open-reference.ts:11,39,60,77`, `file-store.ts:280`, `terminal-store.ts:415,419,480,487`, `browser-surfaces.ts:89`, `browser-panel.tsx:413`; `controller.ts:146-160` (`let` + switch) | The no-destructuring rule is broken in at least nine places. `workbenchTabs` assigns a `let` inside a switch. | Small, but these break the repo's rules. | Fix them while moving the code. |

---

## 3. Target shape

```
workbench/
  model/                      pure, no React, no window
    tab-kinds.ts              WorkbenchTab types + one descriptor table per kind:
                              label, icon, available(scope,caps), launch "singleton"|"new",
                              defaultInput, identity (replaces sameTab), changesScopeValue
                              ← controller.ts:24-74,121-186,444-500,661-690,102-119
                              ← workbench.tsx:79-86, tab-strip.tsx:167-174 (deleted copies)
                              ← change-scopes.ts:105-122 (scope value)
    view-reducer.ts           reduceView(state, action) for open/openFile/openChanges/activate/
                              close/move/patch/scroll/toggle/toggleCollapsed/toggleMaximized/
                              showChat/setShare/toggleSidebar
                              ← controller.ts:754-945 (closures become cases), workbench.tsx:511 (sidebars)
    selectors.ts              visibleTabs, activeTab, shownTab, tabPresentation, railModel
                              (status, openTabs, launchers de-duplicated)
                              ← controller.ts:420-442, workbench.tsx:200-289, tab-strip.tsx:250-255,378-416
    width.ts                  share/pixels/bounds + side-panel width rules
                              ← controller.ts:13-22,188-197,502-546, workbench-rail.tsx:8-26
    paths.ts                  workbenchViewKey, workspacePathForView, workspaceFile(root, abs)
                              ← controller.ts:123-131, workbench.tsx:782, app.tsx:118-124,
                                file-store.ts:122-130, files-panel.tsx:191-195, open-reference.ts:52,71
    persistence.ts            schema + decode/encode + persisted(key, schema, default) helper
                              ← controller.ts:296-418,548-652; used by the other 6 stores (finding 15)
  store.ts                    createWorkbenchStore(reducer, persistence): subscribe/getSnapshot/dispatch,
                              recentViews, useWorkbenchView(workspacePath)
                              ← controller.ts:728-998, workbench.tsx:54-77
  commands.ts                 the only module that touches several stores:
                              launch(kind), newTerminal, openFile(ref) (root check), openChanges,
                              openReference, closeTab (returns confirm reason)
                              ← workbench.tsx:133-153, tab-strip.tsx:186-194,266-319,546-557,
                                window-commands.ts:60-88, open-reference.ts (merged in), terminal-store.ts:683-706
  files/     file-store.ts (runtime only), file-document.ts, files-panel.tsx, file-editor.tsx,
             file-tree.tsx, files-empty-state.tsx, workspace-search.tsx, tree-theme.ts
  changes/   changes-model.ts (NEW ← changes-panel.tsx:438-707, rail-status.tsx:182-211 summary),
             change-scopes.ts, change-tree.ts, changes-*.ts(x), change-stats.tsx, stacked-diff.ts, diff-range.ts
  terminal/  terminal-store.ts, terminal-runtime.ts, terminal-panel.tsx, ghostty*.ts, terminal.stylex.ts
  browser/   browser-surfaces.ts (owns surface lifecycle ← browser-panel.tsx:430-497), browser-*.ts(x)
  canvas/    canvas-panel.tsx, canvas-activity.ts
  view/      workbench.tsx (host + slots only), rail.tsx (← workbench.tsx:99-326 + rail-status.tsx rows),
             tab-strip.tsx (render + dialogs), side-panel.tsx (← workbench-rail.tsx, renamed: it is the
             resizable sidebar seat, not "the rail"), workbench.stylex.ts, find-widget.tsx
```

**Delete or merge**
- `controller.ts` is split into `model/*` and `store.ts`. Keep a short re-export file while callers move only if asked.
- `toggleWorkbench`, `WorkbenchPanels` and the `waiting` map (`controller.ts:248-251,289,736-739,793-828,870-877,934-936,962-967`).
- `openWorkbenchTab` (`workbench.tsx:133`), `newTerminal` (`tab-strip.tsx:186`), `openTerminal` (`window-commands.ts:60`): all become `commands.ts`.
- Both `tabIcons` tables. `headStatus` (`rail-status.tsx:144`). `sameChangesScope` (`controller.ts:102`).
- `turnsError`, `transcriptFailure` and `onRevertPath` in `changes-panel.tsx`.
- The `opening` flag in `file-store.ts`. The draft copy from `file-editor.tsx:333-350`, once `dirty` is derived.
- `open-reference.ts` is merged into `commands.ts`.

---

## 4. What I'd do first

1. **Kind descriptors plus a `railModel` selector (findings 1 and 9).** This fixes the visible overlap and the duplicate "Terminal" rows. One table owns label, icon, availability and launch policy. The rail, compact bar, empty state and "+" menu all render from it, and the selector gets plain unit tests.
2. **Put the workspace-root check in one place (finding 2).** Add `workspaceFile(root, abs)` in `model/paths.ts` and use it in the `file` branch of the opener. This stops `/tmp/…` tabs. Also drop persisted file tabs that fall outside their view's root when restoring.
3. **Add `commands.ts` (findings 3, 4 and 17).** Combine launch, new terminal, open file, open changes and close-with-policy. Delete the three or four copies, and the tab strip loses its store logic.
4. **Rewrite the controller's closures as a pure `reduceView` and delete the `waiting` map (findings 7 and 8).** Opening a file becomes one transition, `file-store`'s `opening` flag goes away, and every tab the store holds is in the snapshot.
5. **Extract `changes-model.ts` and delete the dead props (findings 5, 6 and 10).** This is the biggest component-to-model move. Removing the dead branches first makes the extraction smaller.

Not verified: I didn't run the app or the tests. The rail trace in finding 1 comes from reading the code: `sameTab`, the launcher list and the default browser URL. The leaked-shell risk in finding 4 and the close-during-load race in finding 8 are inferences.
