import { describe, expect, test } from "bun:test";
import { ComposerParts } from "./composer.ts";
import { parseComposerSubmission } from "./slash.ts";

describe("shell context", () => {
  test("sends one exact shell block and rebuilds the same context from history", async () => {
    const run = {
      command: `printf '%s' "a&b"\nprintf '<done>'`,
      output: "first line\nlast line\n\n",
      exitCode: 7,
    };
    const parts = new ComposerParts();
    const marker = parts.addShell(run);
    const prepared = await parts.prepare(`${marker} explain the failure`);
    if (typeof prepared.content !== "string") throw new Error("Expected a text-only prompt");

    expect(prepared.displayText).toBe(
      `[Shell printf '%s' "a&b" printf '<done>'] explain the failure`,
    );
    expect(prepared.content).toBe(
      `<shell command="printf '%s' &quot;a&amp;b&quot;&#10;printf '&lt;done>'" exit="7">\nfirst line\nlast line\n\n</shell> explain the failure`,
    );
    expect(prepared.content.match(/first line/gu)).toHaveLength(1);

    const restored = new ComposerParts();
    const historyText = restored.load(prepared.content);
    expect(historyText).toBe(prepared.displayText);
    expect((await restored.prepare(historyText)).content).toBe(prepared.content);
  });
});

test("a recalled bang-prefixed message stays chat text", async () => {
  const parts = new ComposerParts();
  const draft = parts.load("!echo chat text");
  expect(parseComposerSubmission(draft).kind).toBe("prompt");
  const prepared = await parts.prepare(draft);
  expect(prepared.content).toBe("!echo chat text");
  expect(parseComposerSubmission(prepared.displayText).kind).toBe("prompt");
});
