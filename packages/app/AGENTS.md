# App

- Load the nyte-styles skill before writing StyleX.
- Read the ui package's AGENTS.md before changing a shared component.
- Each source folder owns one concept and sits in a layer. A folder never imports one above it. `pnpm layers` checks this and prints the fix.

## Priorities

Stability first, then simplicity, then performance. A faster path loses to the plain one if it can break, or if it adds a second way to do the same thing.

## The three apps

The desktop app opens three kinds of window. Main names a window's app when it opens it, and the app never changes. `AppShape` holds everything that differs between the apps, one row per app. Read the window's row with `appShape()`.

- **Nyte** is chat first. It has the chat sidebar and window tabs. The workbench is a side panel that offers every tab.
- **Code** is the IDE. The workbench is the main area and always holds an Editor. Chat is the side panel. Code has no chat sidebar, no window tabs and no Design tab. Its sidebar toggle opens the explorer.
- **Studio** is the design board. It opens maximized on Design, its only tab. A file reference opens in Code.

Rules that follow from this:

- All three share one renderer build, one host and one project. Never fork a component per app.
- A new difference between the apps is a new `AppShape` field. Lint rejects a comparison of `windowApp()`.
- A view below the shell never reads `appShape()`. It takes the fact it needs as a prop, as `EditorPanel` takes `main`.
- The workbench store keeps the workbench open on its Editor where it is the main area (`WorkbenchArrangement`), and moves every other tab into the dock under it. Never restore that from a subscriber.
- `AppShape.launchers` lists the tabs each app offers. A new tab kind goes there.
- `switchApp` focuses or opens another app's window on the same project. It carries the selection as an `ArrivalSubject`.
- A Code window follows the light (`followLight`). A selection made in another window, or an agent's change, opens in its editor. An agent's change waits while the person is in the window, so it never moves the caret they type at.
- Each app keeps its own workbench arrangement per project.
- `offeredApps()` lists the apps a window can switch between. A packaged build offers Nyte and Code. Studio is offered only from source.
- The web app has only Nyte. There `windowApp()` answers `nyte` and `offeredApps()` is empty.

## Actions

- Everything the app does by name is an `AppAction`. It is a row in `APP_ACTIONS` and a case in `runAction`.
- A key, a menu item and the palette name an action through a `clientActions` entry (`action` and `input`). `nyte action run` and plugins reach the same case through `offerActions`. Never add a second dispatcher.
- A preference a script reads or sets gets a `setting.<name>` row in `SETTING_ACTIONS`.
- Leave out what the app remembers about its own layout. Leave out every switch that guards links, developer tools or remote control (`remoteControl`, `developerMode`, `trustedLinkHosts`, `confirmExternalLinks`, `linkTarget`).
- The declared list never changes while the app runs. A changed list reconnects the socket.
- An action that can't run now answers `unavailable`.
- The whole list fits one hello (`HELLO_MAX_BYTES`).
- `offerActions` runs a request from the connection's own principal. It runs any other only while `preferences.remoteControl` is on.

## Fonts

These rules hold for the app, `@nyte-ai/ui`, the canvas and the desktop.

- There are two font roles, the UI font and the code font. Users pick both in Settings › Appearance.
- Read a role through the type tokens: `type.fontSans` for the UI font, `type.fontMono` or `text.code` for the code font.
- Take sizes from `text.*`, or from a `type.font*` with its matching `type.leading*`.
- Never write a literal family in a style, an inline style or generated SVG. The typography tokens name each family once.
- Faces load in one place, the app theme's faces module. The web and desktop entries import it at the top, before the theme boot.
- The canvas document can't see the app's CSS. Its shell font sheet loads the same faces and nothing else.
- Never add a face anywhere else, or a family a user can't pick.
- Mono at semibold or heavier is for real emphasis. Labels, chrome and metadata in the code font stay regular.

## Loading indicators

These rules hold in every package.

- `Spinner` means AI is working: a running chat, turn, subagent or tool call.
- `Loader` is everything else: a page, a sign-in, a download, a process or terminal job, a `Button` with `loading`.
- Choose at the call site. A component that can show either takes the fact that decides, as `TaskMark` takes `job`. It never takes a style.
- Never restyle one indicator to look like the other.

## Workbench editor

- `WorkbenchViewState.tabs` is the only file-tab list. The strip shows Editor as one slot, and `move-slot` moves its file records as a block.
- Resolve Editor's target file with `activeEditorFile`.
- A close request appends to the view's `closeQueue`. It never replaces the queue.
- Cancel empties the queue and keeps those files open with their drafts. A saving entry can't be discarded.
- Split placement uses the source file's group, not the focused one.
- Native drag (`FILE_TAB_DRAG`) is the only drag owner on file tabs. Never wrap them in the strip's `SortableList`.
- The focused group's marker reads `appearance.focusColor`. Pointer modality clears `focusRing`, so the marker can't use it.
- A list that grows with a file or a workspace renders a window of rows. The outline uses `useVirtualizer`, and Quick Open uses `MATCH_LIMIT`.

## Renderer tests

- A renderer test is a vitest test that calls `testRenderer(url, setup, { captures })`. It pairs with a browser file that exports a `run()` returning a string.
- To capture, call `window.rendererCapture(name)`, then await the `renderer-captured` document event.
- The window is 800×600. Size the layout with a container element, not the window.
