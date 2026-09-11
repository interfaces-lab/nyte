import { describe, expect, test } from "bun:test";
import { parseComposerSubmission } from "./slash.ts";

describe("user shell submissions", () => {
  test("distinguishes retained and context-free commands without changing shell syntax", () => {
    expect(parseComposerSubmission(`!  printf '%s' "a  b" | sed 's/a/A/'  `)).toEqual({
      kind: "shell",
      command: `printf '%s' "a  b" | sed 's/a/A/'`,
      retain: true,
    });
    expect(parseComposerSubmission("!!printf 'quiet' && exit 7")).toEqual({
      kind: "shell",
      command: "printf 'quiet' && exit 7",
      retain: false,
    });
  });

  test("only the first character can enter shell mode", () => {
    for (const text of [
      "!",
      "!!  ",
      " !echo keep as text",
      "\t!!echo quiet",
      "\n!echo nope",
      "explain !echo hi",
      "hello\n!echo hi",
    ]) {
      expect(parseComposerSubmission(text)).toEqual({ kind: "prompt", text: text.trim() });
    }
    expect(parseComposerSubmission(" /settings ").kind).toBe("command");
  });
});
