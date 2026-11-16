# Nyte Studio

A native Mac app: Swift and AppKit, built by SwiftPM from the package manifest. No SwiftUI and no Xcode project.

- Build: `pnpm --dir packages/studio build`. Check: `pnpm --dir packages/studio typecheck`, which also runs `check-layout`.
- `swift build -c release` has no warnings, in Swift 6 language mode.
- Every size is a token: `NyteSpace`, `NyteControl`, `NyteRadius`, `NyteGlyph`, `NyteText` or a `NyteMetric`. `check-layout` rejects a bare number.
- Glass is for surfaces seen now and then. Anything used many times a minute is a plain surface.
- Before adding a dependency, build the app with and without it and write the size difference in the README. Add its licence to both third-party notices.
- Use the system's parser or control before a library, and a maintained library before writing one.

## Swift

These rules come from reading the AppKit side of Ghostty's Mac app. Each is something that code does throughout.

### Types and files

- Build views and controllers in code. `init?(coder:)` is `fatalError("Made in code.")`.
- Give each protocol conformance its own `// MARK:` and `extension Type: Protocol` block, in the type's file.
- An extension of a system type goes in a file named `Type+What`, one type per file.
- Expose state as `private(set)`. A type used by one file is `private`. The app target declares nothing `public`.
- Keep the model in value types that throw a small error enum, so it can be tested without a window.

### Control flow

- Unwrap with `guard let` at the top of the function, one per line, and return early.
- Capture `[weak self]` in every stored or escaping closure. Never `unowned`.
- When a focus or window change has to wait for AppKit to settle, defer it one turn of the main queue and say why in a comment.

### Events

- A menu action lives on the responder that owns the state. Validate it in `validateMenuItem` with a `switch` on `item.action` that defaults to `true`, and set the item's title and state there.
- A shortcut has one owner: the menu or `keyDown`, never both.
- A raw key code appears only as a case of a key enum, and only for a key that sits in the same place on every layout. Match letters and punctuation by `charactersIgnoringModifiers`.
- Whatever a held key turns on is turned off when the view resigns first responder or its window resigns key. The key's release goes to whoever has the keyboard by then.
- Ignore `mouseExited` while a button is down.
- Set the cursor from state with `set()`. Never `push` and `pop`.
- A tracking area is `activeAlways` when the view takes the first click in a background window, so hover shows what that click will do.
- The middle button arrives in `otherMouseDown`. Check `buttonNumber` and send it through the same drag code as the left button.
- Keep an event monitor or an observer in a property and remove it when the view leaves its window.
- One function decides what a click selects, and hover asks the same function, so the outline never promises something a click won't do.

### Failures and comments

- A type that can fail has a private static `Logger`, with the bundle identifier as subsystem and the type's name as category. Mark interpolations `privacy: .public`. No empty `catch` and no `print`.
- A comment says why. A workaround names the bug or the OS build it is for, and says so when the cause is not known.

### Not taken from Ghostty

- Its SwiftUI layer, `ObservableObject` and Combine. This app's model uses Observation, and views follow it through `Observer`.
- Notifications between windows. There is one window, and closures do the job.
- A first click that only focuses. On a design canvas the first click selects, as in Nyte.
