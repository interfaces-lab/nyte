/**
 * The completion state machine over the draft mirror: which token is under
 * the cursor, when Esc's dismissal ends, what accepting does to the draft,
 * and how `@` mentions rank.
 */
import { describe, expect, test } from "bun:test";
import { SLASH_COMMANDS } from "../../src/lib/slash.ts";
import {
  CLOSED,
  completionEdit,
  completionModel,
  completionToken,
  dismissCompletion,
  inlineTokenRange,
  mentionSuggestions,
  nextCompletion,
  splice,
} from "../../src/model/completion.ts";
import type { CompletionModel } from "../../src/model/completion.ts";

const SOURCES = {
  commands: [
    ...SLASH_COMMANDS,
    { name: "review", description: "Review code", kind: "prompt" as const },
  ],
  files: ["src/app.ts", "src/", "test/app.test.ts", "README.md"],
};

function at(text: string, cursor = text.length) {
  return { text, cursor };
}

function model(text: string): CompletionModel | null {
  return completionModel(nextCompletion(CLOSED, at(text)), at(text), SOURCES);
}

describe("tokens", () => {
  test("a /cd path first, then a / or @ word under the cursor", () => {
    expect(completionToken(at("/cd ~/sr"))).toEqual({
      trigger: "cd",
      query: "~/sr",
      from: 4,
      to: 8,
    });
    expect(completionToken(at("fix @src/a"))).toEqual({
      trigger: "@",
      query: "src/a",
      from: 4,
      to: 10,
    });
    expect(completionToken(at("a/b"))).toBeNull();
  });

  test("Esc keeps the menu closed until its token disappears", () => {
    const dismissed = dismissCompletion(nextCompletion(CLOSED, at("/re")));

    expect(nextCompletion(dismissed, at("/res"))).toBe(dismissed);
    expect(nextCompletion(nextCompletion(dismissed, at("")), at("/re")).kind).toBe("open");
  });

  test("mid-prompt, a slash with no matches is a path, not a menu", () => {
    expect(model("see 1/zzz")).toBeNull();
  });
});

describe("accepting", () => {
  test("a leading action runs; followed by text it only completes", () => {
    const leading = model("/usa");
    const item = leading?.items[0];

    expect(
      leading === null || item === undefined
        ? null
        : completionEdit(leading, item, at("/usa"), "return", SOURCES, "/w"),
    ).toEqual({
      kind: "execute",
      name: "usage",
      leading: true,
      from: 0,
      to: 4,
    });

    const draft = at("/usa and more", 4);
    const withText = completionModel(nextCompletion(CLOSED, draft), draft, SOURCES);
    const first = withText?.items[0];

    expect(
      withText === null || first === undefined
        ? null
        : completionEdit(withText, first, draft, "return", SOURCES, "/w"),
    ).toEqual({
      kind: "replace",
      from: 0,
      to: 4,
      text: "/usage",
    });
  });

  test("a skill completes `/name ` and can be queued", () => {
    const skill = model("/revi");

    expect(skill?.queueable).toBe(true);
    expect(
      skill === null || skill.items[0] === undefined
        ? null
        : completionEdit(skill, skill.items[0], at("/revi"), "return", SOURCES, "/w"),
    ).toEqual({
      kind: "replace",
      from: 0,
      to: 5,
      text: "/review ",
    });
  });

  test("an inline action removes its token and one adjacent space", () => {
    expect(inlineTokenRange("fix /usage now", 4, 10)).toEqual({ from: 4, to: 11 });
    expect(inlineTokenRange("fix /usage", 4, 10)).toEqual({ from: 3, to: 10 });
  });

  test("a trailing space is not doubled when the tail already has one", () => {
    expect(splice("/re rest", 0, 3, "/review ")).toEqual({
      text: "/review rest",
      cursor: 7,
      inserted: "/review",
    });
  });
});

describe("@ mentions", () => {
  test("prefix matches on the name or path come first, then letters in order", () => {
    expect(mentionSuggestions("app", SOURCES.files)).toEqual(["src/app.ts", "test/app.test.ts"]);
    expect(mentionSuggestions("rdm", SOURCES.files)).toEqual(["README.md"]);
    expect(mentionSuggestions("", SOURCES.files)).toHaveLength(4);
  });

  test("a directory is offered as one", () => {
    expect(model("@sr")?.items.find((item) => item.id === "src/")).toMatchObject({
      kind: "directory",
      label: "src/",
    });
  });
});
