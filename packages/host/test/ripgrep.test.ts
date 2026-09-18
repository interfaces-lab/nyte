import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "vitest";
import { findRipgrepFiles, grepRipgrep, InvalidRipgrepPattern } from "../src/ripgrep.ts";
import type { RipgrepMatch } from "../src/ripgrep.ts";

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nyte-rg-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("core ripgrep", () => {
  test("enumerates hidden paths and nested ignore rules without following symlinks", async () => {
    const cwd = await fixture();
    const outside = await fixture();
    await mkdir(join(cwd, "src"));
    await mkdir(join(cwd, ".git"));
    await writeFile(join(cwd, ".git", "config"), "");
    await writeFile(join(cwd, ".gitignore"), "*.log\n");
    await writeFile(join(cwd, "src", ".gitignore"), "!keep.log\n");
    await writeFile(join(cwd, "src", "keep.log"), "");
    await writeFile(join(cwd, "drop.log"), "");
    await writeFile(join(cwd, ".hidden"), "");
    const unusual = process.platform === "win32" ? "-λ[].txt" : "-λ[]\n.txt";
    await writeFile(join(cwd, unusual), "");
    await writeFile(join(outside, "secret.txt"), "");
    await symlink(join(outside, "secret.txt"), join(cwd, "link.txt"));
    const result = await findRipgrepFiles({ cwd });
    assert.deepEqual(
      result.files.toSorted(),
      [".gitignore", ".hidden", "src/.gitignore", "src/keep.log", unusual].toSorted(),
    );
    assert.equal(result.truncated, false);
    const limited = await findRipgrepFiles({ cwd, limit: 1 });
    assert.equal(limited.files.length, 1);
    assert.equal(limited.truncated, true);
    const exact = await findRipgrepFiles({ cwd, limit: 5 });
    assert.equal(exact.files.length, 5);
    assert.equal(exact.truncated, false);
    const visible = await findRipgrepFiles({ cwd, glob: "**/*", hidden: false });
    assert.ok(visible.files.every((path) => !path.split("/").some((part) => part.startsWith("."))));
    const excluded = await findRipgrepFiles({ cwd, exclude: ["src/**"] });
    assert.ok(excluded.files.every((path) => !path.startsWith("src/")));
  });

  test("returns structured byte offsets and treats option-like patterns literally", async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, "index.ts"), "λ😀 --files\r\n--FILES\r\n");
    const matches: RipgrepMatch[] = [];
    const result = await grepRipgrep({
      cwd,
      source: { kind: "directory" },
      pattern: "--files",
      literal: true,
      caseSensitive: false,
      signal: new AbortController().signal,
      onMatch(match) {
        matches.push(match);
        return true;
      },
    });
    assert.equal(result.truncated, false);
    assert.equal(matches.length, 2);
    assert.deepEqual(
      matches[0]?.submatches.map(({ start, end }) => ({ start, end })),
      [{ start: 7, end: 14 }],
    );
    assert.equal(matches[1]?.line_number, 2);
    const absent = await grepRipgrep({
      cwd,
      source: { kind: "directory" },
      pattern: "missing",
      signal: new AbortController().signal,
      onMatch() {
        assert.fail("unexpected match");
      },
    });
    assert.equal(absent.truncated, false);
  });

  test("searches stdin without reading disk and rejects unsupported regex syntax", async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, "index.ts"), "disk only");
    const matches: RipgrepMatch[] = [];
    await grepRipgrep({
      cwd,
      pattern: "draft",
      source: { kind: "text", text: "draft\n" },
      signal: new AbortController().signal,
      onMatch(match) {
        matches.push(match);
        return true;
      },
    });
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0]?.lines, { text: "draft\n" });
    for (const pattern of ["(?=draft)", "first\nsecond", "nul\0query"]) {
      await assert.rejects(
        grepRipgrep({
          cwd,
          pattern,
          source: { kind: "text", text: "" },
          signal: new AbortController().signal,
          onMatch: () => true,
        }),
        InvalidRipgrepPattern,
      );
    }
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps records already produced when ripgrep reports partial read failures",
    async () => {
      const cwd = await fixture();
      await mkdir(join(cwd, "open"));
      await mkdir(join(cwd, "sealed"));
      await writeFile(join(cwd, "open", "a.txt"), "needle\n");
      await writeFile(join(cwd, "sealed", "b.txt"), "needle\n");
      await chmod(join(cwd, "sealed"), 0o000);
      try {
        const found = await findRipgrepFiles({ cwd });
        assert.deepEqual(found.files, ["open/a.txt"]);
        assert.equal(found.truncated, true);
        const matches: RipgrepMatch[] = [];
        const searched = await grepRipgrep({
          cwd,
          source: { kind: "directory" },
          pattern: "needle",
          signal: new AbortController().signal,
          onMatch(match) {
            matches.push(match);
            return true;
          },
        });
        assert.equal(matches.length, 1);
        assert.equal(searched.truncated, true);
      } finally {
        await chmod(join(cwd, "sealed"), 0o700);
      }
    },
  );

  test("terminates a running search on cancellation or a caller's result limit", async () => {
    const cwd = await fixture();
    const controller = new AbortController();
    await assert.rejects(
      grepRipgrep({
        cwd,
        pattern: "hit",
        source: { kind: "text", text: "hit\n".repeat(100_000) },
        signal: controller.signal,
        onMatch() {
          controller.abort();
          return true;
        },
      }),
      /abort/iu,
    );
    let count = 0;
    const limited = await grepRipgrep({
      cwd,
      pattern: "hit",
      source: { kind: "text", text: "hit\n".repeat(100_000) },
      signal: new AbortController().signal,
      onMatch() {
        count += 1;
        return false;
      },
    });
    assert.equal(count, 1);
    assert.equal(limited.truncated, true);
  });

  test("bounds pathological JSON expansion rather than buffering an entire huge record", async () => {
    const cwd = await fixture();
    const result = await grepRipgrep({
      cwd,
      pattern: ".",
      source: { kind: "text", text: "a".repeat(300_000) },
      signal: new AbortController().signal,
      onMatch: () => true,
    });
    assert.equal(result.truncated, true);
  });
});
