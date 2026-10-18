# Nyte film

A 60-second introduction at 1920×1080, 30 fps, built the way Apple's OS X Yosemite film introduces macOS: the interface's parts up close, the parts at work, the whole window, then the name. Its subject is durability: a session that outlives the process that started it.

Everything on screen inside the window is the desktop app's own React: `SessionRow`, `TurnItemView`, `StatusMarker`, `ComposerFrame`, `ModelPicker`, `QuestionTray` and `StatusDot`, imported from `@nyte-ai/app` and fed typed fixtures from the lab's `src/messages/build.ts`. Nothing is a screenshot.

## Shots

| Time | What it shows |
| --- | --- |
| 0–5 s | One beat each, up close: the working spinner, send, Running, Interrupted, Retrying…, Needs input, Branch summary, the model, a changes card |
| 5–14 s | A prompt typed into the composer and sent; the work streams in |
| 14–24 s | ⌘Q. The window leaves and comes back; the step reads Interrupted, then the run carries on |
| 24–34 s | The prompt edited in place, the model switched, and the first path folded into a branch summary |
| 34–42 s | A question parks the run; the sidebar says Needs your answer while two days pass; the answer resumes it |
| 42–60 s | The whole window, "One session. Any process. Any host.", dawn, and the name |

## The project

`src/project.ts` is the film's project file, the way an After Effects project holds its comps and footage. It lists:
- **Compositions:** `nyte`, the film; `ending`, the closing shot, a precomp of the film from its dawn beat.
- **Footage:** the score and effects under `public/`.
- **Fonts and sources:** the fonts the film sets and the files that make it.

Each composition carries its layers and markers. The Remotion CLI registers the compositions from this file, and the lab's studio reads the same file.

## Studio

`pnpm --dir packages/lab dev`, then open `/studio`. It works like After Effects:
- **Project panel:** compositions, footage you can play, font specimens and sources.
- **Viewer:** the open composition, playing in Remotion's Player with the app's real components.
- **Timeline:** labelled layers, beat markers and a playhead. Space plays; ← → step one frame, with Shift ten. Double-click a precomp to open it.
- **Director:** a Nyte core session on the lab's `lab-director` agent. Each message carries what is on screen, like `[ending · frame 96 · 3.20 s · film frame 1601 · layer "Nyte"]`. The agent edits the files here, and Vite reloads the viewer when it saves.

The director uses `anthropic/claude-opus-5-5` when it is signed in, otherwise the catalog's default; set `NYTE_LAB_STUDIO_MODEL=provider/id` to choose. Footage is served at `/video/`, which Remotion's `staticFile()` reads in the studio.

## How it renders

`remotion.config.ts` resolves the workspace's `nyte-source` exports and compiles StyleX with Nyte's own plugin (`@nyte-ai/ui/stylex`). StyleX appends its rules to a `stylex.css` asset the config emits, which `src/app/sheet.tsx` loads before the first frame. Caching stays off: a cached webpack build skips the transforms StyleX collects from. Vite `?url` imports resolve through the importing package's `exports`.

`src/app/setup.tsx` installs the lab's stub host bridge, the app's global CSS, dark mode and the code runtime, and pins the app's CSS animations to the film's frame. `src/app/transcript.tsx` draws rows the way the app's `Timeline` does.

`src/film/chat.ts` holds the session as snapshots keyed by frame; `src/film/window.tsx` assembles the window; `src/film/film.tsx` holds the camera, captions, night and sound; `src/film/ending.tsx` holds dawn, the moon and the name, and plays alone as the `ending` composition. The sky, moon and pixel type come from the landing plate (`src/film/dither.tsx`, `src/film/type.tsx`).

The score (`public/music/score.mp3`) and effects (`public/sfx/`) are generated and stay out of Git.

```sh
pnpm --dir packages/lab dev            # the lab; the film's studio is /studio
pnpm --dir packages/lab video          # Remotion's own studio
pnpm --dir packages/lab video:render   # video/out/nyte.mp4
pnpm --dir packages/lab video:ending   # video/out/ending.mp4
```

The film and its studio UI (`studio/`) are a sketch: they are outside the workspace's lint and format runs. The lab's typecheck reaches them through `/studio`.
