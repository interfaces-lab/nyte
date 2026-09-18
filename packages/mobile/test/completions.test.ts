import { completionTrigger } from "@nyte-ai/client";
import { describe, expect, it } from "vitest";
import { acceptSuggestion, parseCommandLine, skillInstruction } from "../src/chat/completions.ts";

/** The composer scans from the caret, so every case names where the caret is. */
function triggerIn(draft: string, caret = draft.length) {
  const trigger = completionTrigger(draft, caret);
  if (trigger === undefined) throw new Error(`no trigger in ${JSON.stringify(draft)}`);
  return trigger;
}

describe("acceptSuggestion", () => {
  it("writes a file mention as the `@file:` URL the desktop writes", () => {
    const draft = "look at @comp";
    expect(
      acceptSuggestion(draft, triggerIn(draft), {
        kind: "file",
        url: "file:///repo/src/composer.tsx",
        label: "composer.tsx",
        detail: "src/composer.tsx",
      }),
    ).toEqual({ draft: "look at @file:///repo/src/composer.tsx ", caret: 39 });
  });

  it("replaces only the token under the caret, keeping the rest of the draft", () => {
    const draft = "@comp and then ship it";
    expect(
      acceptSuggestion(draft, triggerIn(draft, 5), {
        kind: "file",
        url: "file:///repo/a.ts",
        label: "a.ts",
        detail: "a.ts",
      }).draft,
    ).toBe("@file:///repo/a.ts  and then ship it");
  });

  it("writes a command as its slash line with a trailing space", () => {
    const draft = "/sum";
    expect(
      acceptSuggestion(draft, triggerIn(draft), {
        kind: "command",
        name: "summarize",
        detail: "Summarize this conversation",
      }),
    ).toEqual({ draft: "/summarize ", caret: 11 });
  });

  it("moves a skill to the head as the instruction sentence, dropping the token", () => {
    const draft = "please /code review this";
    const accepted = acceptSuggestion(draft, triggerIn(draft, 12), {
      kind: "skill",
      name: "code-review",
      detail: "Review a diff",
    });
    expect(accepted.draft).toBe(`${skillInstruction("code-review")}\n\nplease  review this`);
  });

  it("does not repeat a skill instruction the draft already carries", () => {
    const draft = `${skillInstruction("code-review")}\n\nand /code`;
    expect(
      acceptSuggestion(draft, triggerIn(draft), {
        kind: "skill",
        name: "code-review",
        detail: "Review a diff",
      }).draft,
    ).toBe(`${skillInstruction("code-review")}\n\nand `);
  });
});

describe("parseCommandLine", () => {
  const commands = [{ name: "summarize", owner: "review", description: "Summarize" }];

  it("reads a whole draft that names a command, with its argument", () => {
    expect(parseCommandLine("  /summarize the last hour ", commands)).toEqual({
      name: "summarize",
      argument: "the last hour",
    });
  });

  it("reads a bare command line as one with no argument", () => {
    expect(parseCommandLine("/summarize", commands)).toEqual({ name: "summarize", argument: "" });
  });

  it("leaves a name no plugin claims as ordinary text", () => {
    expect(parseCommandLine("/unknown thing", commands)).toBeUndefined();
  });

  it("leaves a command mentioned inside a sentence as ordinary text", () => {
    expect(parseCommandLine("run /summarize for me", commands)).toBeUndefined();
  });
});
