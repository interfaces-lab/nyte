# Desktop terminal and workbench tabs

Implemented September 4, 2026 in `/Users/workgyver/Developer/nyte`.

## Shipped changes

- Each shell is a closable tab in the top navigation row alongside Browser and Changes. The duplicate terminal tab strip and shell-title row are removed.
- The + menu creates another shell; the rail opens an existing shell. Middle-click, close buttons, and tab context menus work. Closing a running shell asks for confirmation.
- Shells use the account login shell before inherited `SHELL`, launched interactively with login configuration. Verified `/bin/zsh`, `.zshrc` behavior, and `prompt_starship_precmd` in the local app.
- Terminal rendering uses [OpenCode v2's approach](https://github.com/anomalyco/opencode/tree/v2): `ghostty-web` pinned to OpenCode's fork revision `83c0a07b8628b748aed073b232cb4b52a6ca11c1`, backed by `@lydell/node-pty` 1.2.0-beta.15.
- Replaced the missing vendored electron-vite tarball reference with npm `electron-vite` 5.0.0. No xterm dependency was added.
- Ghostty and the native PTY manager load lazily. Terminal output bypasses React rendering; acknowledgements bound unread output. Input chunks are ordered, including large pastes.
- Selection and tabs share one immutable external-store snapshot. The terminal engine and scrollback survive panel hiding and tab switches.
- Canvas colors resolve from desktop theme tokens; code font family/size updates refit the shell. Terminal focus, native text insertion, paste, copy selection, clear, exit status, and restart are wired.
- Project shell creation checks the selected workspace and its trust grant. Renderer reload, window close, and app shutdown dispose window-owned shells.

## Verification

- All 92 desktop tests passed. Includes real PTY input/output, independent shells, resize, exit, idempotent close, 512 KiB output/backpressure, IPC validation, workspace trust, and workbench controller behavior.
- Desktop type checking and scoped lint passed.
- Production build and unchanged startup budget passed: main 31.0 KiB, preload 3.3 KiB, renderer 1294.2 KiB (1300 KiB limit).
- Isolated Electron app loaded compiled renderer assets through `file://`; Ghostty was absent before first terminal open. Typed commands executed in the real shell.
- A native UI paste rendered its command, and Return produced `NATIVE_PASTE_OK`. The automation clipboard helper timed out, but the subsequent native screenshot confirmed successful execution.
- Light terminal/background pixels matched at RGB 244,244,245; dark matched at RGB 19,20,23. Changing code size from 12 to 15 resized the PTY from 53×67 to 42×52 at the same panel size.
- Exit code 7 displayed the restart control; restart launched a new zsh process. Closing the QA window removed its shell process. Both isolated app processes, their shells, and the QA Vite server were stopped afterward.
- Separate tabs task verified new-shell selection, switching, hidden-session retention, rail restoration, individual/last-tab close, middle-click confirmation, context actions, expanded layout, Browser open/close/reopen, and visit-history toggling.

## Limits

Shells are window-lifetime sessions, not restored across app restart or renderer reload. Terminal tabs are intentionally excluded from restart persistence. macOS and the compiled renderer were exercised; a signed/distributed app bundle and Windows/Linux were not tested. Native menu actions over Browser were verified; the native screenshot tool could not capture the open menu itself, so that overlay's exact visual stacking is not claimed as verified.

Source ownership: `main/terminals.ts`, `workbench/terminal-store.ts`, `terminal-runtime.ts`, `terminal-panel.tsx`, `terminal.stylex.ts`; shared/preload/host IPC wiring. The separate task owns `workbench/tab-strip.tsx`, controller, titlebar, workbench layout, and Browser toolbar changes.
