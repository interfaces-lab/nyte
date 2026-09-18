import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  truncate,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, vi } from "vitest";
import { readWorkspaceFile, saveWorkspaceFile } from "../src/workspace-files.ts";
import { searchWorkspaceFiles, WorkspaceSearchError } from "../src/workspace-search.ts";

async function fixture(): Promise<{ readonly root: string; readonly file: string }> {
  const root = await mkdtemp(join(tmpdir(), "nyte-files-"));
  const file = join(root, "index.ts");
  await writeFile(file, "export const value = 1;\n");
  return { root, file };
}

describe("workspace files", () => {
  test("reads and saves one text file without overwriting a newer version", async () => {
    const { root, file } = await fixture();
    try {
      const document = await readWorkspaceFile(root, file);
      assert.equal(document.kind, "text");
      if (document.kind !== "text") return;

      const saved = await saveWorkspaceFile(root, {
        path: file,
        contents: "export const value = 2;\n",
        version: document.version,
      });
      assert.equal(saved.kind, "saved");
      assert.equal(await readFile(file, "utf8"), "export const value = 2;\n");

      const conflict = await saveWorkspaceFile(root, {
        path: file,
        contents: "stale\n",
        version: document.version,
      });
      assert.deepEqual(conflict, { kind: "conflict" });
      assert.equal(await readFile(file, "utf8"), "export const value = 2;\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps binary files and symlinks outside the workspace out of the editor", async () => {
    const { root } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "nyte-files-outside-"));
    try {
      const binary = join(root, "image.bin");
      await writeFile(binary, new Uint8Array([0, 255, 0]));
      assert.deepEqual(await readWorkspaceFile(root, binary), {
        kind: "binary",
        path: binary,
        size: 3,
      });

      const target = join(outside, "secret.txt");
      const link = join(root, "outside.txt");
      await writeFile(target, "secret\n");
      await symlink(target, link);
      await assert.rejects(readWorkspaceFile(root, link), /outside the open workspace/);
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });
});

describe("workspace search", () => {
  test("searches the workspace with gitignore, glob filters, word boundaries and draft overrides", async () => {
    const { root, file } = await fixture();
    try {
      await mkdir(join(root, "nested"));
      await writeFile(join(root, ".gitignore"), "ignored.txt\n");
      await writeFile(join(root, "ignored.txt"), "value");
      await writeFile(join(root, "nested", "other.ts"), "Value values value_ value\nVALUE\n");
      await writeFile(join(root, "notes.txt"), "value");
      const result = await searchWorkspaceFiles(root, {
        query: "value",
        wholeWord: true,
        include: ["**/*.ts"],
        drafts: [{ path: file, contents: "draft VALUE\n" }],
      });
      assert.equal(result.truncated, false);
      assert.equal(result.matchCount, 4);
      assert.deepEqual(
        result.files.map((entry) => [entry.displayPath, entry.source]),
        [
          ["index.ts", "draft"],
          ["nested/other.ts", "disk"],
        ],
      );
      assert.deepEqual(result.files[0]?.matches[0], {
        line: 1,
        column: 7,
        length: 5,
        snippet: "draft VALUE",
        snippetColumn: 1,
      });
      const sensitive = await searchWorkspaceFiles(root, {
        query: "value",
        caseSensitive: true,
        wholeWord: true,
        exclude: ["**/*.txt", "index.ts", ".gitignore"],
      });
      assert.equal(sensitive.matchCount, 1);
      assert.equal(sensitive.files[0]?.matches[0]?.column, 21);
      const ignored = await searchWorkspaceFiles(root, {
        query: "value",
        include: ["ignored.txt"],
        drafts: [{ path: join(root, "ignored.txt"), contents: "value" }],
      });
      assert.equal(ignored.matchCount, 0);
      assert.equal(await readFile(file, "utf8"), "export const value = 1;\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("bounds matches, snippets and file sizes, and accepts safe regexes", async () => {
    const { root, file } = await fixture();
    try {
      await writeFile(file, `${" ".repeat(300)}hit hit\n`);
      await writeFile(join(root, "binary"), "other\0");
      await writeFile(join(root, "large"), "hit".repeat(700_000));
      const result = await searchWorkspaceFiles(root, {
        query: "h.t",
        regex: true,
        maxMatches: 1,
      });
      assert.equal(result.matchCount, 1);
      assert.equal(result.truncated, true);
      assert.equal(result.files[0]?.matches[0]?.column, 301);
      assert.equal(result.files[0]?.matches[0]?.snippetColumn, 221);
      assert.ok((result.files[0]?.matches[0]?.snippet.length ?? 0) <= 240);
      const all = await searchWorkspaceFiles(root, {
        query: "hit",
        maxMatches: 2,
      });
      assert.equal(all.truncated, false);
      assert.equal(all.matchCount, 2);
      assert.equal(all.skipped, null);
      const empty = await searchWorkspaceFiles(root, {
        query: "^",
        regex: true,
      });
      assert.equal(empty.matchCount, 1);
      assert.equal(empty.files[0]?.matches[0]?.length, 0);
      await assert.rejects(
        searchWorkspaceFiles(root, { query: "(?=hit)", regex: true }),
        /look-around.*not supported/,
      );
      await assert.rejects(
        searchWorkspaceFiles(root, { query: "[", regex: true }),
        /Invalid search regular expression/,
      );
      await writeFile(file, `${"a".repeat(100_000)}!`);
      const nonBacktracking = await searchWorkspaceFiles(root, {
        query: "(a+)+$",
        regex: true,
      });
      assert.equal(nonBacktracking.matchCount, 0);
      assert.equal(nonBacktracking.truncated, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports UTF-16 selections for UTF-8 disk files, CRLF lines and unsaved drafts", async () => {
    const { root, file } = await fixture();
    try {
      await writeFile(file, "\uFEFFλ😀 hit\r\nΩ HIT\r\n");
      const draftPath = join(root, "draft.txt");
      await writeFile(draftPath, "hit hit hit");
      const result = await searchWorkspaceFiles(root, {
        query: "hit",
        drafts: [{ path: draftPath, contents: "\uFEFF😀hit" }],
      });
      assert.equal(result.matchCount, 3);
      assert.deepEqual(
        result.files.map((entry) => ({
          path: entry.displayPath,
          source: entry.source,
          matches: entry.matches.map(({ line, column, length, snippet }) => ({
            line,
            column,
            length,
            snippet,
          })),
        })),
        [
          {
            path: "draft.txt",
            source: "draft",
            matches: [{ line: 1, column: 4, length: 3, snippet: "\uFEFF😀hit" }],
          },
          {
            path: "index.ts",
            source: "disk",
            matches: [
              { line: 1, column: 5, length: 3, snippet: "λ😀 hit" },
              { line: 2, column: 3, length: 3, snippet: "Ω HIT" },
            ],
          },
        ],
      );
      const anchored = await searchWorkspaceFiles(root, {
        query: "^λ😀 hit$",
        regex: true,
      });
      assert.equal(anchored.matchCount, 1);
      assert.equal(anchored.files[0]?.matches[0]?.column, 1);
      assert.equal(await readFile(draftPath, "utf8"), "hit hit hit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps hidden files, nested ignore rules and literal paths without following symlinks", async () => {
    const { root, file } = await fixture();
    const outside = await fixture();
    try {
      await writeFile(file, "no match");
      await mkdir(join(root, "nested"));
      await mkdir(join(root, ".git"));
      await writeFile(join(root, ".git", "config"), "--files");
      await writeFile(join(root, ".gitignore"), "nested/*.txt\n");
      await writeFile(join(root, "nested", ".gitignore"), "!keep.txt\n");
      await writeFile(join(root, "nested", "keep.txt"), "--files");
      await writeFile(join(root, "nested", "ignored.txt"), "--files");
      const name = process.platform === "win32" ? "-λ[].txt" : "-λ[]\n.txt";
      await writeFile(join(root, name), "--files");
      await writeFile(join(root, ".hidden"), "--files");
      await writeFile(outside.file, "--files");
      await symlink(outside.file, join(root, "outside.txt"));
      const result = await searchWorkspaceFiles(root, { query: "--files" });
      assert.deepEqual(
        result.files.map((entry) => entry.displayPath).toSorted(),
        [name, ".hidden", "nested/keep.txt"].toSorted(),
      );
      assert.equal(result.matchCount, 3);
      assert.equal(result.truncated, false);
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside.root, { recursive: true, force: true }),
      ]);
    }
  });

  test("searches past the mention list's 5,000-entry limit", async () => {
    const { root, file } = await fixture();
    try {
      await Promise.all(
        Array.from({ length: 5_001 }, (_, index) =>
          writeFile(join(root, `file-${String(index).padStart(5, "0")}`), "no match\n"),
        ),
      );
      await rename(file, join(root, "zz-last.ts"));
      const result = await searchWorkspaceFiles(root, {
        query: "value",
      });
      assert.equal(result.matchCount, 1);
      assert.equal(result.files[0]?.path, await realpath(join(root, "zz-last.ts")));
      assert.equal(result.truncated, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps zero-width matches on final lines and empty drafts", async () => {
    const { root, file } = await fixture();
    try {
      await writeFile(file, "hit");
      const disk = await searchWorkspaceFiles(root, { query: "$", regex: true });
      assert.equal(disk.matchCount, 1);
      assert.equal(disk.files[0]?.matches[0]?.column, 4);
      assert.equal(disk.files[0]?.matches[0]?.length, 0);
      const draft = await searchWorkspaceFiles(root, {
        query: "^$",
        regex: true,
        drafts: [{ path: file, contents: "" }],
      });
      assert.equal(draft.matchCount, 1);
      assert.equal(draft.files[0]?.source, "draft");
      assert.equal(draft.files[0]?.matches[0]?.column, 1);
      assert.equal(await readFile(file, "utf8"), "hit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("validates unsupported patterns even when filters select no files", async () => {
    const { root } = await fixture();
    try {
      await assert.rejects(
        searchWorkspaceFiles(root, {
          query: "(a)\\1",
          regex: true,
          include: ["missing/**"],
        }),
        /backreferences are not supported/,
      );
      const literal = await searchWorkspaceFiles(root, {
        query: "[",
        include: ["missing/**"],
      });
      assert.equal(literal.matchCount, 0);
      assert.equal(literal.truncated, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("concurrent drafts sharing a version cannot both acknowledge different saved text", async () => {
  const { root, file } = await fixture();
  try {
    const original = await readWorkspaceFile(root, file);
    assert.equal(original.kind, "text");
    if (original.kind !== "text") return;
    const contents = ["first draft", "second draft"];
    const outcomes = await Promise.all(
      contents.map((text) =>
        saveWorkspaceFile(root, {
          path: file,
          contents: text,
          version: original.version,
        }),
      ),
    );
    assert.equal(outcomes.filter((outcome) => outcome.kind === "saved").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "conflict").length, 1);
    assert.equal(
      await readFile(file, "utf8"),
      contents[outcomes.findIndex((outcome) => outcome.kind === "saved")],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("searches without temporary snapshots and leaves disk contents unchanged", async () => {
  const { root, file } = await fixture();
  vi.stubEnv(process.platform === "win32" ? "TEMP" : "TMPDIR", join(root, "missing-scratch"));
  try {
    const complete = await searchWorkspaceFiles(root, { query: "value" });
    assert.equal(complete.matchCount, 1);
    await writeFile(file, "value value\n");
    const limited = await searchWorkspaceFiles(root, { query: "value", maxMatches: 1 });
    assert.equal(limited.matchCount, 1);
    assert.equal(limited.truncated, true);
    assert.equal(await readFile(file, "utf8"), "value value\n");
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

for (const regex of [true, false]) {
  test(`rejects NUL and newline queries before searching, regex=${String(regex)}`, async () => {
    const { root } = await fixture();
    try {
      for (const query of ["a\0b", "a\nb", "a\rb"]) {
        await assert.rejects(
          searchWorkspaceFiles(root, { query, regex, include: ["missing/**"] }),
          (error: unknown) =>
            error instanceof WorkspaceSearchError &&
            error.reason === "invalid_query" &&
            /NUL or newline/.test(error.message),
        );
      }
      await assert.rejects(
        searchWorkspaceFiles(root, { query: "[", regex: true }),
        (error: unknown) =>
          error instanceof WorkspaceSearchError &&
          error.reason === "invalid_regex" &&
          /unclosed character class/.test(error.message) &&
          !/lookaround or backreferences/.test(error.message),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("bounds existing save bytes and refuses oversized drafts without changing disk", async () => {
  const { root, file } = await fixture();
  try {
    const original = await readWorkspaceFile(root, file);
    assert.equal(original.kind, "text");
    if (original.kind !== "text") return;
    await assert.rejects(
      saveWorkspaceFile(root, {
        path: file,
        contents: "x".repeat(2_000_001),
        version: original.version,
      }),
      /too large/,
    );
    assert.equal(await readFile(file, "utf8"), original.contents);
    await truncate(file, 1_000_000_000);
    assert.equal((await readWorkspaceFile(root, file)).kind, "too_large");
    await assert.rejects(
      saveWorkspaceFile(root, { path: file, contents: "short", version: original.version }),
      /too large/,
    );
    assert.equal((await fs.stat(file)).size, 1_000_000_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const operation of ["read", "save"] as const) {
  test.skipIf(process.platform === "win32")(
    `rejects a leaf symlink swapped in before ${operation} opens it`,
    async () => {
      const { root, file } = await fixture();
      const outside = await fixture();
      const original = await readWorkspaceFile(root, file);
      assert.equal(original.kind, "text");
      if (original.kind !== "text") return;
      const originalOpen = fs.open;
      const spy = vi.spyOn(fs, "open").mockImplementationOnce(async (path, flags, mode) => {
        await rm(file);
        await symlink(outside.file, file);
        return originalOpen(path, flags, mode);
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(
          operation === "read"
            ? readWorkspaceFile(root, file)
            : saveWorkspaceFile(root, {
                path: file,
                contents: "overwrite",
                version: original.version,
              }),
        );
        assert.equal(await readFile(outside.file, "utf8"), original.contents);
      } finally {
        spy.mockRestore();
        syncBuiltinESMExports();
        await Promise.all([
          rm(root, { recursive: true, force: true }),
          rm(outside.root, { recursive: true, force: true }),
        ]);
      }
    },
  );
}

for (const operation of ["read", "save"] as const) {
  test.skipIf(process.platform === "win32")(
    `rejects an ancestor swapped before ${operation} opens it`,
    async () => {
      const { root } = await fixture();
      const outside = await fixture();
      const directory = join(root, "nested");
      await mkdir(directory);
      const file = join(directory, "index.ts");
      await writeFile(file, "inside\n");
      const original = await readWorkspaceFile(root, file);
      assert.equal(original.kind, "text");
      if (original.kind !== "text") return;
      const originalOpen = fs.open;
      const spy = vi.spyOn(fs, "open").mockImplementationOnce(async (path, flags, mode) => {
        await rename(directory, join(root, "moved"));
        await symlink(outside.root, directory);
        return originalOpen(path, flags, mode);
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(
          operation === "read"
            ? readWorkspaceFile(root, file)
            : saveWorkspaceFile(root, {
                path: file,
                contents: "overwrite",
                version: original.version,
              }),
        );
        assert.equal(await readFile(outside.file, "utf8"), "export const value = 1;\n");
        assert.equal(await readFile(join(root, "moved", "index.ts"), "utf8"), original.contents);
      } finally {
        spy.mockRestore();
        syncBuiltinESMExports();
        await Promise.all([
          rm(root, { recursive: true, force: true }),
          rm(outside.root, { recursive: true, force: true }),
        ]);
      }
    },
  );
}

test.skipIf(process.platform === "win32")(
  "a save never reopens a path replaced after handle validation",
  async () => {
    const { root, file } = await fixture();
    const outside = await fixture();
    const original = await readWorkspaceFile(root, file);
    assert.equal(original.kind, "text");
    if (original.kind !== "text") return;
    const originalOpen = fs.open;
    const moved = join(root, "moved.ts");
    const spy = vi.spyOn(fs, "open").mockImplementationOnce(async (path, flags, mode) => {
      const handle = await originalOpen(path, flags, mode);
      const read = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementationOnce(async (...args) => {
        await rename(file, moved);
        await symlink(outside.file, file);
        return read(...args);
      });
      return handle;
    });
    syncBuiltinESMExports();
    try {
      assert.equal(
        (
          await saveWorkspaceFile(root, {
            path: file,
            contents: "short",
            version: original.version,
          })
        ).kind,
        "saved",
      );
      assert.equal(await readFile(moved, "utf8"), "short");
      assert.equal(await readFile(outside.file, "utf8"), original.contents);
    } finally {
      spy.mockRestore();
      syncBuiltinESMExports();
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside.root, { recursive: true, force: true }),
      ]);
    }
  },
);

test("direct disk search has a per-file limit, not a 50 MB cumulative scan promise", async () => {
  const { root } = await fixture();
  try {
    const contents = `${"x".repeat(999)}\n`.repeat(2_000);
    await Promise.all(
      Array.from({ length: 26 }, (_, index) =>
        writeFile(join(root, `file-${String(index).padStart(2, "0")}`), contents),
      ),
    );
    await writeFile(join(root, "zz-last"), "needle\n");
    await writeFile(join(root, "too-large"), `${contents}needle\n`);
    const result = await searchWorkspaceFiles(root, { query: "needle" });
    assert.equal(result.truncated, false);
    assert.equal(result.skipped, null);
    assert.deepEqual(
      result.files.map((file) => file.displayPath),
      ["zz-last"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disk search follows rg decoding and binary-prefix semantics, not editor validation", async () => {
  const { root, file } = await fixture();
  try {
    await writeFile(file, Buffer.from([255, 104, 105, 116, 10]));
    await writeFile(join(root, "binary"), "hit\0");
    assert.equal((await readWorkspaceFile(root, file)).kind, "binary");
    const result = await searchWorkspaceFiles(root, { query: "hit" });
    assert.equal(result.matchCount, 2);
    assert.equal(result.skipped, null);
    assert.equal(
      result.files.find((entry) => entry.displayPath === "index.ts")?.matches[0]?.snippet,
      "�hit",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
