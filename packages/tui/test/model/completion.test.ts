import { describe, expect, test } from "bun:test";
import { SLASH_COMMANDS } from "../../src/lib/slash.ts";
import {
  CLOSED,
  completionEdit,
  completionModel,
  completionToken,
  dismissCompletion,
  explicitMentionQuery,
  indexedMention,
  inlineTokenRange,
  mentionSuggestions,
  nextCompletion,
  splice,
} from "../../src/model/completion.ts";
import type { CompletionModel, MentionFile } from "../../src/model/completion.ts";

const SOURCES = {
  commands: [
    ...SLASH_COMMANDS,
    { name: "review", description: "Review code", kind: "prompt" as const },
  ],
  files: ["src/app.ts", "src/", "test/app.test.ts", "README.md"].map((entry) =>
    indexedMention("/w", entry),
  ),
};

function displays(query: string, files: readonly MentionFile[] = SOURCES.files): readonly string[] {
  return mentionSuggestions(query, files).map((file) => file.display);
}

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

  test("a leading slash with no matches is an empty menu that does not take Enter", () => {
    expect(model("/zzz")).toMatchObject({ items: [], loading: false, ownsEnter: false });
  });

  test("a /cd path waits for its listing", () => {
    expect(model("/cd sr")).toMatchObject({ items: [], loading: true, ownsEnter: false });
  });
});

describe("accepting", () => {
  test("a leading action runs; followed by text it only completes", () => {
    const leading = model("/usa");
    const item = leading?.items[0];

    expect(
      leading === null || item === undefined
        ? null
        : completionEdit(leading, item, at("/usa"), "return", SOURCES),
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
        : completionEdit(withText, first, draft, "return", SOURCES),
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
        : completionEdit(skill, skill.items[0], at("/revi"), "return", SOURCES),
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
  test("prefix matches on the name or path come first, then fuzzy matches", () => {
    expect(displays("app")).toEqual(["src/app.ts", "test/app.test.ts"]);
    expect(displays("rdm")).toEqual(["README.md"]);
    expect(displays("")).toHaveLength(4);
  });

  test("at most ten; an empty query lists the first ten in index order", () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      indexedMention("/w", `lib/mod${String(index)}.ts`),
    );

    expect(displays("", many)).toEqual(many.slice(0, 10).map((file) => file.display));
    expect(displays("mod", many)).toEqual(many.slice(0, 10).map((file) => file.display));
    expect(displays("lbmd1", many)).toHaveLength(5);
  });

  test("a prefix match is not repeated by the fuzzy pass", () => {
    const files = ["app.ts", "src/app.ts", "zapp.ts"].map((entry) => indexedMention("/w", entry));

    expect(displays("app", files)).toEqual(["app.ts", "src/app.ts", "zapp.ts"]);
  });

  test("a directory is offered as one, by its absolute path", () => {
    expect(model("@sr")?.items.find((item) => item.label === "src/")).toEqual({
      id: "/w/src/",
      label: "src/",
      detail: "src/",
      kind: "directory",
    });
  });

  test("queries spelled as paths are resolved on disk", () => {
    for (const query of ["./a", "../a", "~/a", "/a", "C:\\a", ".\\a"])
      expect(explicitMentionQuery(query)).toBe(true);

    for (const query of ["", "a/b", ".a", "~a", "C:a"])
      expect(explicitMentionQuery(query)).toBe(false);
  });

  test("a resolved path comes first unless the index already lists it", () => {
    const typed = at("@./src/app");
    const open = nextCompletion(CLOSED, typed);

    const resolved = (file: MentionFile) =>
      completionModel(
        open.kind === "open" ? { ...open, explicit: file } : open,
        typed,
        SOURCES,
      )?.items.map((item) => item.id);

    expect(resolved({ path: "/w/src/app.ts", display: "src/app.ts", label: "app.ts" })).toEqual([
      "/w/src/app.ts",
    ]);
    expect(
      completionModel(
        open.kind === "open"
          ? { ...open, explicit: { path: "/w/a.ts", display: "a.ts", label: "a.ts" } }
          : open,
        typed,
        { ...SOURCES, files: null },
      )?.items.map((item) => item.id),
    ).toEqual(["/w/a.ts"]);
  });
});
