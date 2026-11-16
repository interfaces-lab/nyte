# Nyte Studio

A design canvas for the Mac that is a second client of the Nyte host. It is AppKit only, with no SwiftUI and no web view. It brings no host, no model sign-in and no browser engine of its own, so the agent, its models and its chats are the ones Nyte already has.

A design is a `.lune` text file in the project. Every `.lune` file sits on one canvas. You edit on the canvas, the agent edits the file, and both see the result. A canvas edit rewrites only the bytes of the attribute it changed.

| Read              | For                                                         |
| ----------------- | ----------------------------------------------------------- |
| [Spec](docs/SPEC.md)           | What it does, its budgets and how each was measured |
| [Design](docs/DESIGN.md)       | The choices behind the chrome, with what each avoids |
| [Motion](docs/MOTION.md)       | What moves, on which curve, and what doesn't         |
| [Benchmark](docs/BENCHMARK.md) | Two measured reviews, before and after their findings |
| [Lune](Resources/lune-skill.md) | The design language, as the agent reads it           |

## Build and run

```sh
pnpm --dir packages/studio build        # dist/Nyte Studio.app
pnpm --dir packages/studio dev:host     # a host with a scripted model, for working without an account
pnpm --dir packages/studio typecheck    # the scripts, the colour tokens and the layout check
```

The app attaches to the host named in `~/.nyte/host.json`, or under `NYTE_HOME`. `dev:host` prints the home to point it at. It starts on a fresh copy of the sample project each time; with `NYTE_STUDIO_DEV_ROOT` set to a folder it keeps the project and the chats there, so the host can be stopped and started again under a running app.

Requires macOS 26, Swift 6.2 and Node 26.

## Targets

| Target       | What it is                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------- |
| `Lune`       | The markup. A parser that keeps byte spans, tokens, components, Yoga layout, a Core Graphics renderer, hit testing and text patches |
| `NyteKit`    | The host client. Discovery, HTTP, server-sent events, the WebSocket, sessions and files       |
| `NyteDesign` | Nyte's design language in AppKit. Colour roles, the scales, layout that only takes tokens, the glow |
| `LuneCLI`    | The `lune` command, with `check`, `frames`, `render` and `pack`                                       |
| `NyteStudio` | The app                                                                                       |

Dependencies:

- [Yoga](https://github.com/react/yoga) 3.2.2, MIT, for flexbox layout.
- [BeautifulMermaid](https://github.com/lukilabs/beautiful-mermaid-swift) 1.0.4, MIT, which draws the Mermaid diagrams in a reply. It brings [ElkSwift](https://github.com/lukilabs/elk-swift) 1.0.2, EPL-2.0, for graph layout. Together they add about 7 MB to the app.

Markdown is parsed by Foundation and laid out with TextKit, so it adds nothing to the app's size.

## What is not built

Drawing tools, component variants, signing, notarization, an updater, and the desktop app fetching and installing Studio. Tool input does not stream from the host, so a screen appears when its write lands, not as it is written.
