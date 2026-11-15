# @nyte-ai/studio

Nyte Studio is a design canvas for the Mac. It is a second client of the Nyte host, next to the Nyte desktop app, built for designers the way the desktop app is built for developers. It is an exploration, not a shipped product.

It doesn't bundle a host, a model login or a browser engine. It attaches to the host Nyte already runs, so the projects, chats, models and permissions in Studio are the ones in Nyte. A chat started on the canvas is in Nyte's sidebar, and the other way round.

| | Nyte Studio | Nyte desktop |
| --- | --- | --- |
| Built with | Swift, AppKit and SwiftUI | Electron |
| App size | 4.2 MB | hundreds of MB |
| Memory, project open, idle | about 40 MB in one process | one renderer process per window and tab, plus GPU and utility processes |
| Runs the agent | no, the host does | no, the host does |

## Run it

```sh
pnpm --dir packages/studio build
open "packages/studio/dist/Nyte Studio.app"
```

Studio finds the host through `~/.nyte/host.json`, the file `nyte host` and the desktop app keep. Open Nyte first, or run `nyte host`. It needs macOS 26.

To work on Studio without a model account, run the development host. It is the real host and its real file tools over a copy of `sample/`, with a scripted model that edits the designs:

```sh
pnpm --dir packages/studio dev:host
# prints {"type":"listening", "endpoint": ".../home/host.json", ...}
open -n "packages/studio/dist/Nyte Studio.app" --env NYTE_HOME=<the folder holding that host.json>
```

Ask it for something "warm", "rounder" or "a tide row" and watch the canvas.

## How the two apps share one host

- **Discovery.** `HostEndpoint.discover` reads `host.json` for the URL and token, as `nyte` does.
- **Files.** Studio never touches the disk. It lists, reads, writes and watches the project through `files.scan`, `files.read`, `files.write` and `files.watch`, so it works the same against a host on another machine.
- **Writes can't clobber.** Every write names the version it expects. If an agent changed the file first, the host answers `stale`, Studio reloads, and the agent's change stands.
- **Chat.** The composer calls `sessions.start` and `head.send`. The transcript is the head's rows over the host WebSocket, with streamed text from the text channel.
- **Selection is context.** What is selected on the canvas is sent as an `excerpt` part naming the file and lines, the same part Nyte sends for a selection in a diff.
- **Hand-off.** Both apps declare actions in their WebSocket hello and call each other with `client.perform`. Studio offers `reveal` and `snapshot`. The desktop app offers `open`, which Studio's **Continue in Nyte** calls with the chat's session.

## Lune

A design is a `.lune` file: markup with frames, stacks, text, tokens and components, kept in the repository beside the code. `Resources/lune-skill.md` is the language reference, written as an agent skill. Studio adds it to a project from **File > Teach This Project's Agents Lune**, and sends its body as a prompt layer with every chat it starts.

The canvas shows every `.lune` file of the project in one space. Files are places: choosing one in the sidebar moves the camera, it doesn't switch a document.

An edit on the canvas rewrites only the bytes it changes. Dragging a frame turns `x="0" y="0"` into `x="412" y="137"` and leaves the rest of the file, comments and formatting included, as the agent or the person wrote it.

The `lune` command ships inside the app and needs neither the app nor a display:

```sh
LUNE="packages/studio/dist/Nyte Studio.app/Contents/MacOS/lune"
"$LUNE" check sample/design/screens/tonight.lune --root sample
"$LUNE" render sample/design/screens/tonight.lune --root sample --out /tmp/tide
```

An agent checks its own design this way: `check` for errors, `render` for a PNG it can look at. The app's icon is `Resources/icon.lune`, rendered by this command during the build.

## The Swift package

Three libraries and two executables. The libraries are the part meant to outlive this app: a second native Nyte client would start from them.

| Target | What it is |
| --- | --- |
| `NyteKit` | A host client: discovery, operations over HTTP, watches as server-sent events, the WebSocket with its hello, calls, events, text channel and client actions, and stores for the sessions table and a head's transcript. Foundation only |
| `NyteDesign` | The Nyte design language outside the browser: the colour roles generated from `@nyte-ai/ui`, the type, space, control and motion scales, Inter, and the SwiftUI pieces built from them |
| `Lune` | The design language: parser with source spans, tokens and components, layout, a Core Graphics renderer, hit testing and text patches |
| `NyteStudio` | The app |
| `LuneCLI` | The `lune` command |

`pnpm --dir packages/studio sync:tokens` regenerates `Tokens.generated.swift` from the hex table `@nyte-ai/ui` generates for mobile. `typecheck` fails when it is stale.

## The canvas

Core Animation composites the canvas on the GPU. Each frame is a layer whose bitmap the Lune renderer draws off the main thread, at exactly the pixel scale it is shown at, with its origin snapped to a device pixel. While a zoom is in flight the bitmaps scale; when it settles they are redrawn. A frame larger than the pixel budget gets a sharp tile over the part in view. Nothing draws while nothing changes.

## What is not here yet

- Drawing tools. Frames move and resize, and the inspector edits attributes; new content comes from the agent or the file.
- Variants on components and vector paths.
- Signing, notarization and an updater. The build signs ad hoc.
- A way for the desktop app to fetch and install Studio. Today you build it.
