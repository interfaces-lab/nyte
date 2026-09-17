import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createClipboard } from "@opentui/core";
import { ComposerParts, createClipboardAdapter, discoverMentionFiles } from "./composer.ts";
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

test("clipboard copy strips NUL and writes text to both host and terminal", async () => {
  const hostWrites: string[] = [];
  const terminalWrites: string[] = [];
  const clipboard = createClipboardAdapter(
    createClipboard({
      host: {
        maxWriteBytes: 1024,
        async read() {
          return { status: "empty" };
        },
        async writeText(text, options) {
          expect(options?.selection).toBe("clipboard");
          hostWrites.push(text);
          return { status: "written" };
        },
        async clear() {
          return { status: "cleared" };
        },
        async dispose() {},
      },
      terminal: {
        remote: false,
        writeText(text, selection) {
          expect(selection).toBe("clipboard");
          terminalWrites.push(text);
          return { status: "attempted", capability: "supported" };
        },
        clear() {
          return { status: "attempted", capability: "supported" };
        },
      },
    }),
  );
  try {
    await clipboard.write("alpha\0 beta\0\ngamma");
    expect(hostWrites).toEqual(["alpha beta\ngamma"]);
    expect(terminalWrites).toEqual(["alpha beta\ngamma"]);
  } finally {
    await clipboard.dispose();
  }
});

test("mention discovery preserves cancellation and filesystem failures for the TUI", async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-tui-mentions-"));
  try {
    const reason = new Error("mention request replaced");
    // bun:test types its async matchers as void; the assertions are promises and
    // dropping the await would pass this test before either rejection settles.
    /* oxlint-disable typescript/await-thenable */
    await expect(discoverMentionFiles(root, AbortSignal.abort(reason))).rejects.toBe(reason);
    await expect(discoverMentionFiles(join(root, "missing"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    /* oxlint-enable typescript/await-thenable */
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
