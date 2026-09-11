import { describe, expect, test } from "vitest";
import type { MentionFile } from "@nyte-ai/core/views";
import { createMentionSuggestionRanking } from "./composer-suggestion-ranking.ts";

function file(label: string, displayPath = `/project/${label}`): MentionFile {
  return { label, displayPath, path: displayPath, url: `file://${displayPath}` };
}

describe("mention suggestion ranking", () => {
  test("prefixes precede label substrings, then description matches, with catalog-order ties", () => {
    const rank = createMentionSuggestionRanking([
      file("notes.md", "/needle/notes.md"),
      file("a-needle.ts"),
      file("NEEDLE-z.ts"),
      file("needle-a.ts"),
      file("z-needle.ts"),
      file("other.md", "/needle/other.md"),
      file("unrelated.ts"),
    ]);
    expect(rank("  NeEdLe  ", false).map((suggestion) => suggestion.label)).toEqual([
      "NEEDLE-z.ts",
      "needle-a.ts",
      "a-needle.ts",
      "z-needle.ts",
      "notes.md",
      "other.md",
    ]);
    expect(rank("missing", false)).toEqual([]);
  });

  test("matching context stays above files without consuming a file slot", () => {
    const rank = createMentionSuggestionRanking(
      Array.from({ length: 25 }, (_, index) => file(`context-${index}.ts`)),
    );
    const results = rank("context", true);
    expect(results).toHaveLength(21);
    expect(results[0]).toEqual({
      kind: "mention",
      id: "current-conversation",
      label: "Current conversation",
      description: "Use this conversation as context",
      icon: "more",
    });
    expect(results.slice(1).map((suggestion) => suggestion.label)).toEqual(
      Array.from({ length: 20 }, (_, index) => `context-${index}.ts`),
    );
    expect(rank("context", false)).toHaveLength(20);
    expect(rank("context-24", true).map((suggestion) => suggestion.label)).toEqual([
      "context-24.ts",
    ]);
  });

  test("empty queries only read the first twenty files and preserve file payloads", () => {
    let tailReads = 0;
    const folder = file("src/", "/project/src/");
    const first = [folder, ...Array.from({ length: 19 }, (_, index) => file(`${index}.ts`))];
    const tail: MentionFile = {
      ...file("tail.ts"),
      get label() {
        tailReads += 1;
        return "tail.ts";
      },
    };
    const rank = createMentionSuggestionRanking([...first, tail]);
    const results = rank(" \t ", true);
    expect(results.map((suggestion) => suggestion.label)).toEqual([
      "Current conversation",
      ...first.map((entry) => entry.label),
    ]);
    expect(results[1]).toEqual({
      kind: "file",
      id: `file:${folder.path}`,
      label: folder.label,
      description: folder.displayPath,
      icon: "folder",
      file: folder,
    });
    expect(tailReads).toBe(0);
  });

  test("replacement catalogs use new search fields and original file payloads", () => {
    const oldFile = file("old.ts");
    const oldRank = createMentionSuggestionRanking([oldFile]);
    expect(oldRank("old", false)).toHaveLength(1);
    const replacement = file("new.ts", oldFile.path);
    const rank = createMentionSuggestionRanking([replacement]);
    expect(rank("old", false)[0]?.label).toBe("new.ts");
    expect(rank("new", false)[0]).toMatchObject({ file: replacement });
    expect(createMentionSuggestionRanking([])("old", false)).toEqual([]);
  });

  test("late stronger matches displace a large corpus of weaker matches", () => {
    const descriptions = Array.from({ length: 10_000 }, (_, index) =>
      file(`note-${index}.md`, `/target/note-${index}.md`),
    );
    const substrings = Array.from({ length: 30 }, (_, index) => file(`a-target-${index}.ts`));
    const prefixes = [file("target-z.ts"), file("target-a.ts")];
    const rank = createMentionSuggestionRanking([...descriptions, ...substrings, ...prefixes]);
    expect(rank("target", false).map((suggestion) => suggestion.label)).toEqual([
      "target-z.ts",
      "target-a.ts",
      ...Array.from({ length: 18 }, (_, index) => `a-target-${index}.ts`),
    ]);
    expect(rank("note-9999", false).map((suggestion) => suggestion.label)).toEqual([
      "note-9999.md",
    ]);
  });

  test("a full prefix page retains catalog order and excludes all weaker matches", () => {
    const rank = createMentionSuggestionRanking([
      file("notes.md", "/match/notes.md"),
      file("a-match.ts"),
      ...Array.from({ length: 100 }, (_, index) => file(`match-${100 - index}.ts`)),
    ]);
    expect(rank("match", false).map((suggestion) => suggestion.label)).toEqual(
      Array.from({ length: 20 }, (_, index) => `match-${100 - index}.ts`),
    );
  });

  test("subsequent searches reuse normalized catalog fields", () => {
    let reads = 0;
    const entry: MentionFile = {
      ...file("example.ts"),
      get label() {
        reads += 1;
        return "example.ts";
      },
    };
    const rank = createMentionSuggestionRanking([entry]);
    expect(rank("absent", false)).toEqual([]);
    const initialReads = reads;
    expect(rank("also-absent", false)).toEqual([]);
    expect(reads).toBe(initialReads);
    expect(rank("example", false)[0]?.label).toBe("example.ts");
  });
});
