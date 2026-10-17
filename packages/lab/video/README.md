# Nyte Core introduction

An 80-second scientific explainer at 1920×1080, 30 fps. A researcher and a worker avatar explain what Nyte Core owns, how work survives an execution process, and how developers compose their own agent applications.

The film uses original SVG characters, animated diagrams, Inter and an instrumental score. Headings carry the explanation. Every frame is drawn in 2D with Remotion.

## Render

```sh
pnpm --dir packages/lab video:render
pnpm --dir packages/lab video:poster
```

The outputs are `out/nyte-introduction.mp4` and `out/nyte-introduction-poster.jpg`. The poster uses frame 165. `video` opens Remotion Studio for editing. The render checks that `public/music/introduction.mp3` exists before it starts.

`src/introduction.ts` holds the timing and copy. `src/film.tsx` stages the characters and chapters. `src/avatars.tsx` draws the characters, while `src/execution-scenes.tsx` and `src/composition-scenes.tsx` draw the mechanisms.

## The explanation

The opening names the runtime immediately. A message enters a session and returns an admission receipt. Execution calls a model and tools, while the session records its history. Immutable objects and an atomic ref batch explain how the runtime publishes state. An interrupted tool step introduces recovery and replay policy. Named heads then share a prefix and develop separate continuations.

A tool's stored question connects the runtime to a person. Another SDK client answers it, the tool resumes, and the run completes. The final chapters show model providers, plugins, environments, custom renderers and host compositions. The closing argument is "Build agents that can continue."

## Grounding

`core-proof.json` contains identities and content hashes from an actual Core, SDK and native SQLite run with a scripted model. The run created a question part, answered it through a second SDK connection, forked `alternative`, advanced both heads, then reopened the database through a new store and host. Both histories and the settled receipt survived. Reading that completed state required no new model requests. Store inspection reported no integrity issues.

The diagrams use those short IDs, hashes and seven-node branch topology. The atomic batch shows `heads/main`, `runs/<id>` and `inbox/main`, matching input admission. The code examples follow the public SDK and branded head-name API.

The recovery chapter is a conceptual explanation backed by Core's existing execution, lease and tool replay tests. The concrete proof reopens completed state. An unfinished safe tool step can be replayed after the previous execution lease expires. Parked question waits release their lease. Tool replay policy determines what recovery may do with an interrupted call.

The terminal, web and mobile panels illustrate renderers for the custom `film/direction` part. Clients supply those renderers. The question is an application interaction. Named heads share a workspace. Local, server and edge hosts are alternative compositions; the edge example is chat-only.

Primary contracts live in `packages/core/src`, `packages/lab/sdk-shape.ts`, `packages/sdk/src` and `packages/schema/src`. Host and environment adapters live in `packages/host/src`. The terminal, app, desktop, mobile, canvas, lab and demo packages inform the client examples.

## Media

Keep ten generated media files: seven PNG plates in `public/plates`, the MP3 score, the final MP4 and its JPEG poster. Plates are review outputs, not inputs to the animation. Generated media stays out of Git and Vercel source uploads. Obsolete captures and renders are removed after the replacement is verified.

The score reuses the retained project soundtrack and runs for 78 seconds. The final two seconds hold in silence. The encoded score measures −18.0 LUFS integrated and −3.3 dB true peak.
