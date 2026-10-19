# Nyte film

A narrated launch film at 1920×1080, 30 fps, in the grammar of Notion's "Think together": a real clip first, then a voice over photographs with captions a phrase at a time, the turns alone on black a word at a time, the real product under headlines, the music cutting dead before the last words, and a small lockup at the end. Its argument: everyone is building their own harness with no foundation under it; Nyte is the foundation, and you build your own on top.

## Script

The narration lives in `src/film/script.ts`, one recording per line, read by Sarah, one of ElevenLabs' premade voices, on its Eleven v4 model.

| Lines | Picture |
| --- | --- |
| We all started with blocks. Stacked them up, took them apart, and built worlds that were ours. | Minecraft gameplay by Naybr, four shots cut on the words, muted; captions a phrase at a time |
| Every block stood on the one beneath it. | A word at a time, alone on black |
| In the age of AI, everyone wants to build their own harness. | The Mark I Perceptron reading a letter, a hackathon, a harness maker's workshop, one per phrase |
| Billion-dollar companies with whole teams trying to build a software factory. | A glass tower, a row of switchboard operators, then ENIAC and Ford's assembly line side by side |
| No need for a foundation. No need for consistency. And AI will rewrite them all. | The Leaning Tower of Pisa, a tangle of wires, a building imploding |
| We think that's the wrong direction. | A word at a time, alone on black, the music still under it |
| Nyte is the foundation. Your skills. Your subagents. Your MCP servers. Your canvases. Your models. | The real app rises on a plane tilted back under the headline; "Your ☑ …" rolls to each part as it is named, and the app cuts to it: a skill read, two subagents, the places MCP server, a canvas, the TUI's model setting |
| Build any harness on top. It runs on your machine. It's open source. | The TUI, then the desktop; the composer on this Mac; the repository on GitHub |
| Build your own. | A word at a time, alone on black, in silence; then the film's pictures flicker on the beat into the lockup |

## The clip

The film opens on Minecraft survival gameplay by Naybr ([source](https://www.youtube.com/watch?v=GPsGyv5zTlM)), published under YouTube's Creative Commons Attribution licence: free to use and monetise with the credit "Gameplay – youtube.com/@Naybr" wherever it is used, which includes the post the film goes out with. Four shots cut on the narrator's words (`clip` in `src/film/media.ts`, `clipShots` in `src/film/scenes.tsx`): logs laid, a wall stacked, dirt dug out on "took", and the finished front. It plays muted, framed above the game's hotbar so the HUD stays clear of the captions, and cuts to black on "Every block".

The footage stays out of Git. To fetch it:

```sh
yt-dlp -f "bv*[height=1080]" --download-sections "*00:30-02:30" -o /tmp/naybr.mp4 "https://www.youtube.com/watch?v=GPsGyv5zTlM"
ffmpeg -i /tmp/naybr.mp4 -r 30 -c:v libx264 -crf 17 -pix_fmt yuv420p -an -movflags +faststart packages/lab/video/public/clips/naybr.mp4
```

## The photographs

Eleven photographs from Wikimedia Commons, every one public domain or CC0, so none asks for credit: archival ones from the U.S. National Archives, the U.S. Army, Lewis Hine and Fortepan, and modern ones, several of them Unsplash photos released under CC0. `photos` in `src/film/media.ts` lists each with what it shows, its author, licence and source page. They live in `public/photos/`, outside Git; to fetch one again, download its source page's file and save it under its key, at most 2400 px on the long side.

## The app

The product is the real desktop app, filmed in a sandbox: `packages/desktop/e2e/launch.ts` starts the e2e build (`pnpm --dir packages/desktop build:e2e`) with a temporary home, an empty store and the suite's scripted model, so no one's sessions show, and Playwright drives it in the dark theme at 1512×949 points, 2×. A DevTools screencast records each take, encoded at 30 fps. The takes:
- **restaurant:** scenario U's "find me a random restaurant nearby": the skill loads, the places MCP server answers, the canvas paints, the agent asks to run a command and answers.
- **agents:** `/agents`, two subagents reporting back.
- Stills of the window, the composer on this Mac, and github.com/interfaces-lab/nyte; the TUI shots are the docs' (`packages/docs/public/tui`).

`app` in `src/film/media.ts` lists them; they live in `public/footage/`, outside Git. The shoot script is not checked in yet.

## Voice

`video/voice.ts` records each line with ElevenLabs and trims the take clean:

```sh
ELEVENLABS_API_KEY=… pnpm --dir packages/lab video:voice record [line,…]   # every line unless named, then trims
pnpm --dir packages/lab video:voice trim                                    # trim the takes already recorded
```

- **Takes** land in `video/out/voice/` with ElevenLabs' character timings.
- **Trimming** cuts on the waveform, anchored on those timings: the take starts at the first word's onset, so an inhale before it goes; it ends where the last word's sound runs out, so a breath or click after it goes; breaths in the pauses between phrases are gated out.
- **Level:** every line gets one gain, to −18 dBFS speech, with a look-ahead limiter holding peaks under −1.5 dBFS.
- **Output:** the trimmed takes go to `public/voice/`, which stays out of Git like the score. Their word timings go to `src/film/voice.json`, which is committed, because the cut is built from them.

## How it is cut

`src/film/cut.ts` builds the cut from the timings. Each line starts on the first beat of the score after a breath, longer where the film turns. The score's beats land a frame after each half second, so every line, and with it every picture cut, falls on frame 15k + 1. Pictures cut on the words they illustrate (`findWord`), and captions break into phrases at the same words. There are no sound effects: the score plays under the whole film and ducks while she speaks.

## The project

`src/project.ts` is the film's project file, the way an After Effects project holds its comps and footage. It lists:
- **Compositions:** `nyte`, the film; `ending`, the closing flicker and lockup on their own.
- **Footage:** the score and the narration under `public/`; the gameplay, photographs and app footage are listed in `src/film/media.ts`.
- **Fonts and sources:** the fonts the film sets and the files that make it.

Each composition carries its layers and markers. The Remotion CLI registers the compositions from this file, and the lab's studio reads the same file.

## Studio

`pnpm --dir packages/lab dev`, then open `/studio`. It works like After Effects:
- **Project panel:** compositions, footage you can play, font specimens and sources.
- **Viewer:** the open composition, playing in Remotion's Player.
- **Timeline:** labelled layers, a marker on every line, and a playhead. Space plays; ← → step one frame, with Shift ten. Double-click a precomp to open it.
- **Director:** a Nyte core session on the lab's `lab-director` agent. Each message carries what is on screen, like `[ending · frame 96 · 3.20 s · film frame 1524 · layer "Moon and name"]`. The agent edits the files here, and Vite reloads the viewer when it saves.

The director uses `anthropic/claude-opus-5-5` when it is signed in, otherwise the catalog's default; set `NYTE_LAB_STUDIO_MODEL=provider/id` to choose. Footage is served at `/video/`, which Remotion's `staticFile()` reads in the studio.

## How it is made

- `src/film/film.tsx`: the film, its sound and silences, and its timeline layers.
- `src/film/scenes.tsx`: the gameplay, the photographs and the product, each cut on its words and pushing in slowly.
- `src/film/media.ts`: the gameplay, photographs and app footage, with their sources.
- `src/film/frame.tsx`: a region of a picture or take, covering a box.
- `src/film/words.tsx`: the narration as text: captions, statements, headlines and the sentence.
- `src/film/ending.tsx`: the closing flicker and lockup.
- `src/film/dither.tsx` and `src/film/type.tsx`: the dissolves and the moon from the landing plate; the type, all of it in Geist.

Two motions come from [snapcn](https://snapcn.dev), copied from its source (`snapcndev/snapcn`, MIT) rather than installed with the shadcn CLI, and owned here:
- **Logo Flicker** (`src/snap-cn/logo-flicker.tsx`, [docs](https://snapcn.dev/docs/logos/logo-flicker)) closes the film. The film's own pictures, the archive first and the product last, cut in full-frame on the score's eighth notes, then its quarter notes, and dissolve into the moon and the name.
- **Check Cycle** (`src/snap-cn/check-cycle.tsx`, [docs](https://snapcn.dev/docs/text/check-cycle)): "Your ☑ …" over the product, rolling each part in as the narrator names it while the app cuts to it, set in Geist beside snapcn's own ticked box.

```sh
pnpm --dir packages/lab dev            # the lab; the film's studio is /studio
pnpm --dir packages/lab video          # Remotion's own studio
pnpm --dir packages/lab video:render   # video/out/nyte.mp4
pnpm --dir packages/lab video:ending   # video/out/ending.mp4
```

The film and its studio UI (`studio/`) are a sketch: they are outside the workspace's lint and format runs. The lab's typecheck reaches them through `/studio`, and `video/voice.ts` through `tsconfig.node.json`.
