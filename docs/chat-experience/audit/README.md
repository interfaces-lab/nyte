# Audit round 2

A code-only review of the whole desktop app. Twelve reviewers, two per area on different models (Claude Opus 5.5 high, GPT-6.1 Sol xhigh), read a snapshot of `chat-experience` with every Markdown file removed, so their judgement rests on code alone. Their reports are in [reports/](reports). This page records what both reviewers of an area agreed on, the decisions taken, and the work it became.

## What both reviewers found

**Run-state gate.** One `RunStatus` union holds two independent things: the chat's own run and its descendants' work. A working subagent outranks how the chat's own run ended, so a finished chat with background agents spins in the sidebar and tabs, its reply never counts as unread, and a child waiting on approval reads as "working" on the parent. The TUI derives run state on its own and prints "Working" where desktop says "Planning next moves". The collapsible thinking group also stands in for the live planning status: a group with no tool calls turns its header into "Planning next moves" and hides the live row. Clients don't get which children the run awaits and which run in the background.

**Linkage.** A subagent opened as a full chat has no way back to its parent when the tab strip is on. The same click opens a tab or the tray depending on mode. The host already sends each chat's background items with the call that started them, but the app ignores them and re-derives jobs from the workspace job list. Ended jobs vanish with no way to reopen their output. Status words and glyphs disagree across surfaces (Completed, Finished, Run finished; three unread glyphs). Stop feedback says "already finished" after a successful stop.

**Rendering.** A file the host reports as missing falls through the editor's nested ternary to "Opening file…" forever, and only the text editor re-reads from disk, so it stays stuck after the file appears. The host checks size before content, so most screenshots come back "too large", nothing classifies images or PDFs, and SVG counts as text. Nothing renders an image, though the byte stream and `blob:` policy exist. "Outside the workspace" is decided by string prefixes in several places.

**Workbench.** The rail lists every open tab and every launcher, and launchers follow different rules per kind (Terminal always opens a new tab), so the rail repeats itself. The file opener has no workspace-root check. "Open a tab of kind K" is written three times and "new terminal" four. The controller's actions are closures with a hidden pending-tab map, so opening a file takes three steps guarded by a flag. The Changes panel derives about 270 lines of state inside its component.

**Structure.** No file is over 1,000 lines; the problem is folders. `chrome/` is a catch-all of 55 files (sidebar, settings, environments, customize, account, titlebar). The data layer (`queries.ts`, `sdk.tsx`) sits at the root and imports feature folders. Folders import each other in circles even where files don't. Desktop and lab can import any app file through a wildcard export. `packages/desktop/src/main` mixes code for three processes in 60 flat files.

**Tokens.** Interactive text levels collapse in tinted scopes (primary, secondary and tertiary resolve to one step). One role doubles as muted text and error accent. Icon `size` takes any number (nine sizes in use against a 14/16/20 scale). Row, menu-item and control heights repeat each other. The type scale has no extra-large step, so headings sit off it. The lint copies the token values by hand.

## Decisions

- **Structure follows the Opus tree**: concept folders under `packages/app/src` (`contract`, `boot`, `data`, `lib`, `diff`, `canvas`, `references`, `chat/{composer,transcript,tools,markdown,trays}`, `chats`, `workbench/{browser,changes,files,terminal}`, `sidebar`, `account`, `settings`, `environments`, `customize`, `panes`, `tabs`, `window`, `commands`, `shell`, `web`), a folder-level layer check, and an explicit export map instead of the `./*` wildcard. Desktop main splits by process: `main/`, `host/`, `workers/`, `shared/`.
- **Status is two parts**: the chat's own run, and the background work it started. Background work never changes how the chat itself reads; a chat whose own run ended reads as done and its composer sends at once.
- **The thinking group and the planning status are separate**: the group is transcript content and stays after the turn; the planning status is a live row owned by the run.
- **The host classifies a file once** (kind, MIME, inside or outside the workspace); the app renders each kind with one exhaustive switch. Files outside the workspace open read-only.
- **No new host restrictions on which paths a paired device can read or write.** The host serves any absolute path today; confining it is a security decision for the product owner.
- **`AGENTS.md` files name concepts and symbols, never file paths**, because paths go stale when files move. A check fails on a path in any `AGENTS.md`.
- **Token values stay Nyte's**; the work is internal consistency of the levels.

## Packages

Run in this order so no two packages move the same files at once: P1 alone; then P2 and P3 together; then P4 and P5 together; then P6 alone; then the final review.

| Package | Scope | Status |
| --- | --- | --- |
| P1 Structure | App folder tree, layer check, export map; desktop process split; `AGENTS.md` files name concepts, not file paths, with a check that keeps it so | done |
| P2 Run-state gate | Own run vs background work, thinking vs planning, one projection for desktop and TUI | done |
| P3 File rendering | Host classification, exhaustive editor states, image preview (inline PDF waits on the owner's choice), read-only outside files | done |
| P4 Task linkage | Parent return, one subagent open rule, jobs from the host's background items, reopenable ended jobs, one status vocabulary | todo |
| P5 Workbench | Kind table and rail model, one command module, pure tab reducer, Changes model, browser handoff | todo |
| P6 Tokens | Interactive levels, accent roles, glyph-step icons, one control scale, type steps, lint read from tokens; a non-AI `Loader` so `Spinner` means AI work only; an app `AGENTS.md` (priorities, font roles, loading indicators) once those rules hold | todo |
| P7 Final review | Two code-only reviewers over the whole diff; fixes; full verification | todo |
