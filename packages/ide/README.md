# Nyte IDE

A native Mac IDE for macOS 27, in Swift and AppKit, that talks to the Nyte host already running
on the machine. It is a prototype: the shell and its four panes work end to end, and the list at
the bottom says what has and has not been proven.

## Run it

```sh
packages/ide/scripts/bundle.sh
open "packages/ide/build/Nyte IDE.app" --args /path/to/a/folder
```

`scripts/check.sh` builds every target and prints only compiler diagnostics. `scripts/render.sh`
draws the window to a PNG without showing it.

## The window

```
● ● ●  (sidebar)   tab  tab  tab                  (terminal) (agent)
nyte  main        ┌──────────────────────────┐   ┌────────────────┐
› packages        │ editor                   │   │ agent          │
⌄ scripts         │                          │   │                │
    build.sh      │ path          Ln 1, Col 1│   │                │
                  └──────────────────────────┘   │                │
                  ┌──────────────────────────┐   │                │
                  │ terminal                 │   │ composer       │
                  └──────────────────────────┘   └────────────────┘
```

- One warm chrome under everything. The navigator and the titlebar row sit flat on it.
- The editor, terminal and agent are cards on the chrome, 8pt apart, 10pt corners.
- Glass is only the three buttons in the titlebar row, Open Quickly, and what the system draws.
- File tabs live in the titlebar row above the editor. The path and the caret share one line at
  the editor's foot, so there is no separate path bar or status bar.

| Key | Does |
| --- | --- |
| ⌘P | Open Quickly |
| ⌃⌘S | Sidebar |
| ⌃` | Terminal |
| ⌥⌘0 | Agent |
| ⌘L | Ask Nyte |
| ⌃⇥ / ⌃⇧⇥ | Next and previous tab |

## Modules

| Module | Owns |
| --- | --- |
| `NyteCore` | `FileTree`, a struct-of-arrays store of the workspace's files; `FileIndex`, every path in one byte buffer for Open Quickly. No AppKit. |
| `NyteUI` | Nyte's colour roles, type scale, spacing and radii as Swift constants; Pierre's file icons; the few base controls. |
| `NyteFiles` | The navigator: one table drawn from the file store, git status, file watching. |
| `NyteEditor` | One text view and many documents, a line index, and a table-driven highlighter that colours only visible lines. |
| `NyteTerminal` | libghostty-vt for terminal state, our own CoreText drawing, a login shell on a PTY behind a backend seam. |
| `NyteAgent` | The client for the Nyte host and the agent pane: sessions, streaming, tool steps, approvals. |
| `NyteShell` | The window, titlebar row, tab strip, pane cards, Open Quickly and the menu. |
| `NyteIDE` | The executable: one file. |
| `NyteShot` | A development tool that renders the window offscreen. |

## Where it stands

Proven by running it:

- [x] The shell lays out, collapses and restores its panes in light and dark, down to 760 by 480.
- [x] The navigator opens this repository in about 50ms and holds 60,000 nodes in 5 MB.
- [x] The editor opens, edits, undoes and saves files byte for byte, including CRLF, tabs and
      Latin-1, and re-highlights a single edit in about 4ms.
- [x] The terminal passes the multiplexer checklist's terminal gate except a real CJK input
      method, and draws nothing while idle or hidden.
- [x] The agent pane lists this workspace's sessions, renders an existing one, and ran one real
      conversation with a tool step against the live host, then survived a dropped connection.

Not proven or not built:

- [ ] Glass and vibrancy were seen only in early window captures; renders cannot show them.
- [ ] Pointer paths: hover, drag to resize, the tab and navigator context menus.
- [ ] VoiceOver, Increase Contrast and Reduce Transparency, beyond the code that handles them.
- [ ] A real approval from the host, and changing the model on an existing chat.
- [ ] Tab reordering by drag, split editors, find in files, a source control view, language servers.
- [ ] Terminals owned by the Nyte host, so a shell outlives the window. The backend seam is there;
      the host backend is not.
- [ ] Signing, notarization, updates and an icon of its own.
