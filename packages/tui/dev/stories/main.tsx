import process from "node:process";
import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { TUI_RENDERER_CONFIG } from "../../src/services/rendering.ts";
import { registerSyntaxParsers } from "../../src/services/syntax-parsers.ts";
import { findStory, STORIES } from "./index.ts";

/** Runs one story full screen until it quits; an unknown id lists the stories and fails. */
export async function runStory(id: string): Promise<number> {
  const story = findStory(id);

  if (story === null) {
    const known = STORIES.map((entry) => `  ${entry.id}  ${entry.title}\n`).join("");
    process.stderr.write(`Unknown story "${id}". Stories:\n${known}`);

    return 2;
  }

  registerSyntaxParsers();

  const renderer = await createCliRenderer({
    ...TUI_RENDERER_CONFIG,
    exitOnCtrlC: false,
    autoFocus: false,
    enableMouseMovement: true,
    clearOnShutdown: true,
    openConsoleOnError: false,
  });

  const exited = Promise.withResolvers<number>();
  await render(() => <story.Root onExit={exited.resolve} />, renderer);
  const code = await exited.promise;
  renderer.destroy();
  await renderer.closed;

  return code;
}
