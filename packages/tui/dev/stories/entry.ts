import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";

const MAIN = fileURLToPath(new URL("main.tsx", import.meta.url));

/** Swaps the CLI entry for one story, so `NYTE_STORY=<id>` runs it without the CLI or a host. */
export function storyEntry(id: string) {
  return {
    name: "nyte-story",
    setup(build) {
      build.onLoad({ filter: /[/\\]tui[/\\]src[/\\]index\.ts$/u }, () => ({
        loader: "ts",
        contents: [
          `import process from "node:process";`,
          `import { runStory } from ${JSON.stringify(MAIN)};`,
          `process.exit(await runStory(${JSON.stringify(id)}));`,
        ].join("\n"),
      }));
    },
  } satisfies BunPlugin;
}
