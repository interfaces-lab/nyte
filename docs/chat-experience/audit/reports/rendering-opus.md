# How the workbench opens and renders files

Scope: opening a file from the transcript, the explorer, search, breadcrumbs and Changes, then reading it through app → sdk → host and choosing what to show. Snapshot: `/tmp/review-code`. Every claim below is either **read** (from the code, with file:line) or **observed** (from a throwaway Playwright spec I ran against the built e2e desktop and then deleted).

## 1. How it works today

A file link in the transcript goes through `linkReference` (`packages/app/src/conversation/prose.tsx:150-171`). An absolute href becomes a `file://` URL and then a `MentionFile` (`message-references.ts:349-376`). `workbenchReferenceOpener` turns that into `fileActions.open(viewKey, { path, preview: true })` (`workbench/open-reference.ts:38-48`). It does nothing if there is no workspace (`:35`). The explorer, search, breadcrumbs and the empty state call the same `fileActions.open` (`files-panel.tsx:204, 282, 367, 477, 542`). Changes has no call to open a file in the editor (no `fileActions` use under `workbench/changes-*`). `file-store.ts:196-236` opens or reuses a `{ kind: "file", path }` tab. The store sets `displayPath` with a string-prefix test against the view key, which is the workspace path (`file-store.ts:118-135`, `controller.ts:125-126`). `FilesPanel` mounts one `WorkspaceFileEditor` per tab (`files-panel.tsx:485-502`).

`WorkspaceFileEditor` calls `useWorkspaceFile(path)` (`file-editor.tsx:201-202`). That query (`queries.ts:592-603`, key `["files","document",path]` at `query-keys.ts:37`) calls `workspaceFiles().read(path)` (`queries.ts:168-177`). From there the call goes to sdk `rows.call("files.read")` (`sdk/src/workspace.ts:123`), over the desktop IPC transport to the host process, to `"files.read"` in `host/src/serve/binding.ts:438`, through core's pass-through `wrapFiles` (`core/src/env/environment.ts:431`), and finally to `localFiles.read` (`host/src/local/files.ts:102-121`). The Electron main process only relays the call; it does no file I/O on this path.

The host decides the kind from size and bytes alone. It answers `missing` on ENOENT. Above 1 MiB it answers `large` without looking at the bytes (`:49-50, 110-111`). Otherwise it answers `binary` if `decodeText` fails (NUL or invalid UTF-8, `local/text.ts:1-9`), and `text` if it succeeds. An absolute path is used as given (`files.ts:79`), so nothing limits reads to the workspace.

Back in the app, the result goes through a nested ternary (`file-editor.tsx:204-220`):
- `text` → `TextFileEditor`.
- `binary` → "Binary files cannot be edited here."
- `large` → "This file is too large for the workbench editor."
- anything else → **"Opening file…"**.

Only `TextFileEditor` mounts `DiskSync`, the per-path watcher that refetches the query (`file-editor.tsx:186-199, 529`). The client defaults are `refetchOnMount: false` and `retry: false` (`queries.ts:79-89`).

## Runtime check: what I saw vs. what I read

I built canvas, app, desktop and the e2e desktop. Then I ran a scratch spec (deleted afterwards) that sends markdown links in the "Beta rollout" chat. The fake model echoes them, and the spec clicks each citation.

| Case | Observed in the Files panel |
|---|---|
| 1×1 PNG inside the workspace | "Binary files cannot be edited here." |
| Same PNG outside it (`/tmp/nyte-review-render/frames-stack.png`) | "Binary files cannot be edited here.", breadcrumb `tmp › nyte-review-render › frames-stack.png` |
| 2 MiB PNG outside | "This file is too large for the workbench editor." |
| SVG outside | Opens as an editable text document |
| Path that doesn't exist | **"Opening file…" forever** |
| File then created on disk, same link clicked again | still "Opening file…" |
| Tab closed, file now on disk, link clicked again (immediately and after 4 s) | still "Opening file…" |
| Open text file deleted on disk | text editor unmounts, "Opening file…" |
| …then recreated, and the link clicked again | still "Opening file…" |

`/tmp/legend-verify/compare/frames-stack.png` does not exist on this machine now (`ls` gives ENOENT). An existing PNG outside the workspace renders a terminal message, not a spinner (observed). So the reported stuck state is the host's `missing` answer drawn as "loading". Without a watcher or refetch the panel can never recover. This matches a screenshot that was opened before it was written, or after it was deleted. That timing is an inference; the mechanism is observed.

## 2. Findings (by impact)

| # | Where | What | Why it hurts | Change |
|---|---|---|---|---|
| 1 | `app/src/workbench/file-editor.tsx:213-220`; `schema/src/files.ts:131` | `FileDocument` has 4 kinds, but the view handles 3. `missing`, and the real pending state, both fall into the ternary's default "Opening file…". No `never` check exists, so the compiler can't flag the gap. No app code reads `kind === "missing"` (grep). | **Root cause of the stuck screen** (observed). A deleted or not-yet-written file looks like a slow load forever, with no action. | Replace the ternary with an exhaustive `switch (document.kind)` that includes `missing` ("Not found" + Retry + Reveal folder) and a separate `isPending` branch. |
| 2 | `file-editor.tsx:186-199, 529`; `queries.ts:79-89, 592-603` | The disk watcher lives only in `TextFileEditor`. `binary`, `large` and `missing` documents have no watcher. The client defaults `refetchOnMount: false` and `staleTime` 1 s don't refetch on remount, and clicking a link to an already-open tab only bumps `navigationRevision` (`file-store.ts:221-228`). | **Second root cause** (observed): after the file appears, nothing re-reads it. This holds in the same tab, after a re-click, and after closing and reopening the tab, because the cached `missing` result lives until gcTime with no observers. An open text file that is deleted then recreated stays dead the same way. | Mount `DiskSync` in the outer view for every kind (the watch already waits for missing paths, `host/src/local/files.ts:70` doc, `:274-277`). Set `refetchOnMount: "always"` on the document query. |
| 3 | `file-editor.tsx:204` | A kind change swaps `TextFileEditor` out for the placeholder. On delete the buffer and its `CodeView` unmount. The draft survives only in the file store (`:338-349`). | A file that an agent deletes and rewrites under an open editor drops the editor into "Opening file…" (observed). The user's place and undo history are lost. | Keep `TextFileEditor` mounted on `missing` and show "Deleted on disk" in its status bar, the way it already handles `conflict` (`:574-575`). Swap renderers only on a real kind change. |
| 4 | `host/src/local/files.ts:102-121, 110-111`; `local/text.ts:1-9` | The host decides kind from bytes and size only. Size is checked first, so any image over 1 MiB, which covers most real screenshots, is `large`, not `binary`. Nothing distinguishes an image or PDF from other bytes. SVG is `text`. UTF-16 and Latin-1 text read as `binary`. | No file kind can get a dedicated renderer. The 2 MiB PNG says "too large for the editor" (observed), which is the wrong reason. | Classify once, on the host, at the read boundary: sniff the first 4 KiB (PNG/JPEG/GIF/WebP/BMP/ICO/AVIF/PDF magic) before the size check, and add an extension rule for SVG. Return a `mime` (see §3). |
| 5 | `files.ts:122-162` (`mime: null` at `:139`); `app/src/use-blob-url.ts:26-49`; no caller of `files.bytes` in `packages/app` (grep) | The byte-stream API and a blob-URL hook that manages object-URL lifetimes already exist. The hook is only wired to `connection.blob` for transcript images (`turn-view.tsx:132`). `files.bytes` answers no MIME type. | Everything an image preview needs is already built but unused. The renderer CSP already allows `img-src blob:` (`desktop/src/account/policy.ts:53`). | Give `bytes` the host's MIME type. Generalize `useBlobUrl` to take a reader source, and use it in an `ImagePreview`. |
| 6 | `file-editor.tsx:213-220` | Every terminal state is plain text with no action: no Reveal in Finder, no Copy Path, no Retry, no size shown. "Binary files cannot be edited here" says what you can't do, not what the file is. | Dead ends. VS Code's binary editor offers "Open Anyway", its missing-file editor offers "Create File" (`createMissingFile` in `workbench.desktop.main.js` ≈ byte 32888300), and large files get a confirmation. | One `FilePlaceholder` with a title (kind + size) and actions: Reveal (`nyte.host.revealPath`), Copy Path, Retry. |
| 7 | `file-store.ts:122-130`; `host/src/local/files.ts:79-85`; `open-reference.ts:52-54` | "Inside the workspace" is decided three different ways. (a) The app compares string prefixes against the view key, with no realpath, so `/tmp` vs `/private/tmp` style symlinks misclassify. (b) The host has its own `within()`, used only for search and watch. (c) Skill links outside the root are refused (`:54`), while file links outside it open. | The same path behaves differently by entry point. An outside file gets workspace-only UI that doesn't apply: breadcrumb popovers filter workspace files by the prefix `tmp/` (`files-panel.tsx:600-616, 685-689`), "Copy Relative Path" copies the absolute path (`file-editor.tsx:500`), Git blame runs against the wrong repo (`:298-302`), and Save writes the file (`:317-324` → `files.ts:180`). | Have the host return `scope: "workspace" \| "external"` from the realpath. External files render read-only: no blame, no format, no save, an absolute-path breadcrumb with no popovers, and an "Outside <workspace>" note. |
| 8 | `host/src/serve/handler.ts:133-136`; `binding.ts:438-447`; `core/src/env/environment.ts:431`; `files.ts:79, 180` | `files.read`, `files.bytes` and `files.write` accept any absolute host path for any principal with `participant` authority, which includes paired devices. No layer checks the path against the workspace. | This is a policy question, not the stuck bug. The repo rules ask for buy-in before adding security complexity. Failure: a paired participant can read or write anything the host user can, e.g. `~/.ssh`. Likelihood: low, since participants are paired explicitly and the agent already has a shell. Cost of a fix: small if limited to "outside files are read-only" (finding 7); larger if reads must be limited to cited paths. | Decide explicitly. Recommended minimum: refuse `write`/`remove` outside the root on the host. Keep reads, since the user clicked the link. |
| 9 | `changes-patches.ts:64-65`; `stacked-diff.ts:36-37`; `schema/src/git.ts:55-60` | Changes renders a binary change as the raw text "Binary file <path>". `git.contents` sides carry only `{ kind: "binary" }`, with no MIME type, size or bytes. Changes has no way to open the file in the editor. | Changed screenshots, the most common binary change an agent makes, can't be seen or opened from Changes. | Phase 2: give binary git sides a `mime`, render image before/after with the same `ImagePreview`, and add "Open File" on a section header → `fileActions.open`. |
| 10 | `edit-call.tsx:185-193`; `tool-line.tsx:200-209`; `composer-files.ts:43-48`; `message-references.ts:20-31`; `prose.tsx:162-166`; `open-reference.ts:71` | Six hand-written path ↔ `file://` / join helpers. Two are identical copies. The two `startsWith("/")` absolute checks break on Windows paths. | Different entry points can produce different `path` strings for the same file, and `path` is both the tab key (`file-store.ts:160-161`) and the query key. | One `fileUrl(path, cwd?)` / `pathFromUrl` pair in `message-references.ts`. Delete the copies. |
| 11 | `composer-files.ts:13-20` | An extension → image-MIME table exists only for the composer. | A second, different table would appear as soon as a preview is added. | Delete it when the host returns `mime`. The composer can use the host's `mime` or one shared table. |
| 12 | `queries.ts:592-603` | `useWorkspaceFile(path: string \| undefined)` has one caller, which always passes a string (`file-editor.tsx:202`). The `undefined` branch, `enabled` and the "Select a file" throw are dead. | Noise in the one place that should be the read boundary. | Take `path: string`. |
| 13 (inferred) | `host/src/local/files.ts:724-727` + `tree.ts:57-76` | `watchFiles` filters events through the workspace's `.gitignore` even for absolute paths outside the root (segment `""` → root rules applied to `tmp/...`). | A workspace `.gitignore` containing `*.png` or `tmp/` would silence the watch for an outside file once finding 2 is fixed. I did not run this. | Skip ignore rules for paths that `within()` leaves absolute. |

## 3. The rendering model I propose

**How VS Code decides (read from the Cursor bundle; nothing copied).**
- **Resolver:** an `EditorResolverService` picks an editor per resource from registered selectors, ranked builtin < default < option < exclusive, and the user can override with `workbench.editorAssociations`. `media-preview/package.json` registers `imagePreview.previewEditor` for `*.{jpg,jpe,jpeg,png,bmp,gif,ico,webp,avif,svg}`, audio for `*.{mp3,wav,ogg,oga}` and video for `*.{mp4,webm}`.
- **Fallbacks:** anything unmatched goes to the text editor. If the text read fails as binary, `openAsBinary` hands the file to `workbench.editor.defaultBinaryEditor` or to `BinaryFileEditor` (`workbench.editors.files.binaryFileEditor`). That editor's action re-resolves with `override: PICK` + `setForceOpenAsText`.
- **Terminal states:** missing and too-large are editors with actions, not spinners.
- **Preview:** it loads the resource through `asWebviewUri`, with `localResourceRoots: [dirname(resource)]`. It watches the folder and re-renders with `?version=` on change, and shows the byte size.

**Nyte equivalent, decided once at the host boundary.**

1. **Kind (host, `files.read`).** Only the host sees bytes and realpaths, so it is the only place that classifies.
   ```ts
   FileDocument =
     | { kind: "text";   path; scope; mime; contents; version }      // mime "text/plain" | "image/svg+xml" | …
     | { kind: "media";  path; scope; mime; size; version }          // image/*, application/pdf, video/mp4|webm, audio/*
     | { kind: "binary"; path; scope; size; version }
     | { kind: "large";  path; scope; size; version }                // text over TEXT_LIMIT
     | { kind: "missing"; path; scope }
   scope: "workspace" | "external"   // realpath vs realpath(root)
   ```
   The steps: sniff a 4 KiB head with magic numbers before the size test, apply an extension rule for SVG, then run `decodeText`. One `classify(head, path, size)` in `host/src/local/text.ts` serves `read`, `bytes` (`mime`), and the git and snapshot binary paths (`git.ts:899-904`, `snapshots.ts:765`).

2. **Renderer (app).** One exhaustive switch, no ternary:

   | Document | Renderer | What the user sees |
   |---|---|---|
   | pending | `FileLoading` | "Opening <name>…" (pending only) |
   | `text` | `TextFileEditor` | Editor. Read-only when `scope === "external"`. SVG also gets a "Preview" toggle, default preview, the way VS Code ranks image preview over text for `*.svg` |
   | `media` image/* | `ImagePreview` | `<img src=blob:…>` from `files.bytes` with fit/100% zoom. Status bar shows pixel size · byte size · MIME. Re-reads on watch events |
   | `media` PDF / video / audio | `FilePlaceholder` (phase 1) | "PDF · 2.1 MB" + "Open in Default App" / Reveal. The renderer CSP has `object-src 'none'` and no `blob:` in `frame-src` or `media-src` (`policy.ts:57-59`), so in-panel PDF/media needs its own decision (probably a workbench Browser tab). Inference |
   | `binary` | `FilePlaceholder` | "Binary file · 48 KB" + Reveal, Copy Path |
   | `large` | `FilePlaceholder` | "Text file · 14 MB, larger than 1 MB" + Reveal (later: open read-only, limited) |
   | `missing` | `FilePlaceholder` | "<name> isn't on disk" + Retry, Reveal folder. Auto-recovers on the watch event |
   | error | `FilePlaceholder` role=alert | message + Retry |

   Every kind keeps `DiskSync` mounted, so each state is live.

3. **Files outside the workspace.** The user clicked a citation, so reads go ahead. The host stamps `scope: "external"` from the realpath, and the app does no prefix test. External files open read-only: no save, format or blame, an absolute breadcrumb, and an "Outside <workspace>" note. Restricting host-side `write`/`remove` to the root is the minimal safety step and needs the owner's buy-in (finding 8).

**Module map**

| Today | Target |
|---|---|
| `workbench/file-editor.tsx:201-224` (`WorkspaceFileEditor`) | `workbench/files/file-view.tsx`: query, `DiskSync`, exhaustive switch |
| `file-editor.tsx:1-185, 226-624` (`TextFileEditor`, `EditorFind`, `replaceContents`) | `workbench/files/text-editor.tsx` (+ `readOnly` prop) |
| `file-editor.tsx:186-199` (`DiskSync`) | `workbench/files/disk-sync.tsx`, mounted by `file-view` for every kind |
| new | `workbench/files/image-preview.tsx`, `workbench/files/file-placeholder.tsx` |
| `use-blob-url.ts` | `use-bytes-url.ts`: one hook over any `ByteReader` source (`connection.blob`, `files.bytes`) |
| `file-store.ts`, `file-document.ts`, `files-panel.tsx` | move into `workbench/files/`; drop the prefix-based `displayPath` once the host returns `scope`/relative path |
| `edit-call.tsx:185`, `tool-line.tsx:200`, `composer-files.ts:43`, `prose.tsx:162-166`, `open-reference.ts:71` | deleted; use one `fileUrl`/`pathFromUrl` in `conversation/message-references.ts` |
| `composer-files.ts:13-20` MIME table | deleted in favour of the host's `mime` |
| `host/src/local/text.ts` `decodeText` | `classify()` beside it; used by `files.ts` `read`/`bytes`, `git.ts`, `snapshots.ts` |
| `schema/src/files.ts:118-132` | the union above (+ `pnpm --dir packages/host check:store` per repo rules) |
| `changes-patches.ts:64-65`, `stacked-diff.ts:36-37` | phase 2: `binary` with `mime` image → image before/after via `ImagePreview`; "Open File" action on sections |

## 4. What I'd change first

1. **Fix the stuck screen.** Make `WorkspaceFileEditor` an exhaustive `switch` with a real `missing` placeholder and a pending-only "Opening…" (`file-editor.tsx:204-220`), plus Retry/Reveal/Copy Path actions.
2. **Make every state live.** Hoist `DiskSync` above the kind switch and set `refetchOnMount: "always"` on `useWorkspaceFile` (`file-editor.tsx:529`, `queries.ts:592-603`). This fixes "file appears later" and "deleted then recreated" (both observed). Keep `TextFileEditor` mounted on `missing` (finding 3).
3. **Classify on the host.** Sniff before the size check, add `mime` + `scope` to `FileDocument`, and fill `bytes().mime` (`host/src/local/files.ts:102-121, 139`; `schema/src/files.ts:118-132`).
4. **Add `ImagePreview`.** Build it on `files.bytes` + a generalized `useBlobUrl`, used for PNG/JPEG/GIF/WebP/BMP/ICO/AVIF and as the default view for SVG.
5. **One answer for "outside the workspace".** Use the host's `scope` instead of the prefix tests (`file-store.ts:122-130`, `open-reference.ts:52-54`) and render external files read-only. Get a decision on host-side write confinement (finding 8). Then merge the six path/URL helpers.

---
Housekeeping: the scratch spec, its temp files, its screenshots and `packages/desktop/e2e/test-results` were deleted. Build outputs and the harness's gitignored `e2e/.cache` baseline remain. No tracked files were modified.
