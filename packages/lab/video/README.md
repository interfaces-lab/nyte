# Video lab

A launch film for Nyte, 57 seconds long. Remotion draws the type and interface, Blender renders the moon, and ElevenLabs reads the script and makes the score. The script lives in `script.ts`. The voice sets the timing: each line rounds up to whole bars of the 80 BPM score, so cuts land on downbeats. The score is made to those bar lengths afterwards.

## Run

```sh
pnpm --dir packages/lab video:research   # optional: fetch and transcribe the reference films
pnpm --dir packages/lab video:moon       # Blender, headless, about 3 minutes
ELEVENLABS_API_KEY=… pnpm --dir packages/lab video:voice    # narration; run before the score
ELEVENLABS_API_KEY=… pnpm --dir packages/lab video:music    # score, cut to the narrated timings
pnpm --dir packages/lab video:music --mix                   # re-level the kept takes, no API call
pnpm --dir packages/lab video            # Remotion Studio
pnpm --dir packages/lab video:render     # video/out/nyte.mp4
```

Without a recording, the film runs on estimated timings. A recording made from older wording is ignored line by line, so edit `script.ts` and run `video:voice` again, then `video:music`, because the bar counts change. Without `public/music/score.mp3` there's no music.

`ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID` override the voice (Brian) and the model (`eleven_multilingual_v2`). Set `BLENDER` if Blender isn't in `/Applications`.

## Voice, music and words

This follows the Notion film. The voice carries the film, and the music sits about 11 LU under it. Measured on Notion's soundtrack, the voice is -15 LUFS and the music -26.

Every spoken word is on screen once, in one of two ways, never both:

- **Subtitles** under the picture: short phrases, broken after punctuation or at six words, 64 px Inter 400, about 56 px from the bottom. Pictures sit above a 240 px band, so a subtitle never crosses an image.
- **One word at a time on black**, as it's said, at 128 px Inter 600. This is for the thesis, "Speed got cheap. Care didn't."

A line whose words the picture already shows has no subtitle: the counters and the end card. Subtitles are white on `#0c1020` at night and `#16181d` on `#ececec` by day, both above 15:1. Labels in the picture are 24 px or larger. Inter loads with its optical-size axis, so large type uses the display cut.

## Music

`video:music` first asks the ElevenLabs Music API for one composed piece, with a section for each act in `score` held to that act's length. The Music API needs a paid plan. On a free plan the script falls back to the sound model: one take per act, looped where the music carries through a cut. The takes are kept in `public/music/takes`. Each one is levelled to its act's `level`, so Together is the loudest point and the turn drops away. Then the takes are joined at the cuts and run through a limiter.

The sound model doesn't hold a tempo. Take lengths, and the cuts at section changes, are exact. Beats inside a take only roughly follow 80 BPM, so listen before publishing.

To use a track from a library instead, save it as `public/music/score.mp3` and set `tempo` in `script.ts` to its BPM. Shazam identifies the Notion film's music as Brice Davoli, "Petit Trianon". The rajz track isn't recognised.

## What the references taught

**Notion, "Think Together"** (Ivan Zhao, 125 s). The film argues instead of demoing.

- It opens on someone else's words: Apollo 11, "The Eagle has landed". Archive film, before any thesis.
- The thesis arrives as one white word at a time on black, each word as it's said: "most", "meaningful", "things", "were", "never", "built", "alone". There's no subtitle while a word is up.
- It names the opposing story (headlines, the solo founder behind a chat window, "humans are friction") before answering it.
- The answer is concrete. Three real teams, each with a place and a size: a fintech in New York, healthcare in Australia, three founders in Lagos.
- The voice is calm, about 2 words a second, over Brice Davoli's "Petit Trianon" about 11 LU below it. Every word is on screen, one way at a time: alone in white on black as it's said, about 130 px, or as a yellow subtitle about 64 px on the black below a letterboxed picture.
- It ends quietly: a small logo and "Think together".

**rajz** (29 s, music only, about 136 BPM). The craft vocabulary.

- Cuts land on the beat, and type types itself.
- Bracket corners frame a word or a value: `{ in one place }`.
- A render-pass reveal: the heat pass resolves into the finished render.
- Step lists that tick through ("Processing", "Generating", "Assemble") show work happening.

## The film

Notion's structure and restraint, with rajz's motion only where Nyte shows its work. Nyte's story is care. AI made building fast, so the scarce thing is someone taking the time to get it right. The name and the moon icon give that a setting: night, the time you sleep on a decision.

| Line | Picture | Why it's there |
| --- | --- | --- |
| This year, anyone can ship an AI app in a weekend. | A chat box types itself, then becomes twenty identical ones. | The opposing story, stated fairly. |
| Most of them feel the same. Close the window, and the work is gone. | The copies wink out; day goes to black. | The cost of speed, in the user's terms. |
| Speed got cheap. Care didn't. | Each word alone on black as it's said, while the music drops to one note. | The thesis. |
| Nyte took longer. | The moon's heat pass resolves into the render as the camera swings round. | The turn into night. |
| Four hundred and sixty-seven commits. Fifty-eight of them in the core. | Counters in brackets over the real commit log, each landing as it's said. No subtitle: the counters are the words. | Proof from the repository, not adjectives. |
| Every step is saved, like a commit. Close the app, and nothing is lost. | A session drawn as commits with a branch; the window closes and the commits stay. | The mechanism behind the care, from `docs/kernel/architecture`. |
| Come back tomorrow. Or check in from your phone while it works. | A large 23:48 becomes 07:12 on the beat; a phone picks up the same steps while they are still running. | What that means for the user, from `docs/remote-access`. |
| No army of agents. One person and one agent, thinking it through. | A field of flickering agents collapses to two squares taking turns. | Notion's ethos, said in Nyte's terms. |
| Good work takes more than one night. | The Blender moon goes through its phases. | The idea, said once more in the setting. |
| Nyte. Sleep on it. | The icon assembles, square by square. | The end card. |

Every product claim is in the docs. The figures came from `git log` on 12 October 2026: 467 commits, and 58 commits touching `packages/core/src/kernel`. Recount before publishing. The film no longer says the home page was drawn five times, because the history doesn't show it.
