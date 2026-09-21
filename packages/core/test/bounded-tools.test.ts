import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "vitest";
import { createLocalBashOperations } from "../src/tools/bash.ts";
import { createReadTool } from "../src/tools/read.ts";
import { OutputAccumulator } from "../src/tools/support/output-accumulator.ts";
import { toolResultText } from "../src/kernel/loop/tool-result.ts";

describe("bounded shell output", () => {
  test("persists every byte before accepting more output", async () => {
    const accumulator = new OutputAccumulator({ maxBytes: 1024, maxLines: 10_000 });
    const data = Buffer.alloc(2 * 1024 * 1024, "x");

    await accumulator.append(data);
    await accumulator.finish();
    const snapshot = accumulator.snapshot();
    await accumulator.closeTempFile();

    assert.equal(snapshot.truncation.truncated, true);
    assert.ok(snapshot.fullOutputPath);
    try {
      assert.deepEqual(await readFile(snapshot.fullOutputPath), data);
    } finally {
      await rm(snapshot.fullOutputPath, { force: true });
    }
  });

  test("reports spill-file errors during append", async () => {
    const accumulator = new OutputAccumulator({
      maxBytes: 1,
      tempFilePrefix: join(`nyte-missing-${randomUUID()}`, "output"),
    });

    const append = accumulator.append(Buffer.from("too large"));
    const earlyError = accumulator.waitForTempFileError();

    await assert.rejects(append, /ENOENT/u);
    await assert.rejects(
      earlyError.then((error) => {
        throw error;
      }),
      /ENOENT/u,
    );
  });

  test(
    "serializes stdout and stderr delivery",
    { skip: process.platform === "win32" },
    async () => {
      const operations = createLocalBashOperations();
      let activeCallbacks = 0;
      let maxActiveCallbacks = 0;
      let output = "";
      let delayedFirstChunk = false;

      const result = await operations.exec(
        "for i in {1..2000}; do printf 'out-%04d\\n' \"$i\"; printf 'err-%04d\\n' \"$i\" >&2; done",
        "/tmp",
        {
          onData: async (chunk) => {
            activeCallbacks++;
            maxActiveCallbacks = Math.max(maxActiveCallbacks, activeCallbacks);
            if (!delayedFirstChunk) {
              delayedFirstChunk = true;
              await new Promise<void>((resolve) => setTimeout(resolve, 150));
            } else {
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
            output += chunk.toString("utf8");
            activeCallbacks--;
          },
        },
      );

      assert.equal(result.exitCode, 0);
      assert.equal(maxActiveCallbacks, 1);
      assert.match(output, /out-2000/u);
      assert.match(output, /err-2000/u);
    },
  );
});

describe("bounded text reads", () => {
  test("preserves a byte-order mark and Unicode across read chunks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-unicode-read-"));
    try {
      const content = `\ufeff${"x".repeat(65_532)}🐈\nnext`;
      await writeFile(join(directory, "unicode.txt"), content);
      const tool = createReadTool(directory);
      const tail = await tool.execute("read", { path: "unicode.txt", offset: 2 });
      assert.equal(toolResultText(tail.content), "next");
      await writeFile(join(directory, "unicode.txt"), "\ufeffhello");
      const head = await tool.execute("read", { path: "unicode.txt" });
      assert.equal(toolResultText(head.content), "\ufeffhello");
      await assert.rejects(tool.execute("read", { path: directory }), /regular file/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects device files", { skip: process.platform === "win32" }, async () => {
    await assert.rejects(
      createReadTool("/tmp").execute("read", { path: "/dev/zero", limit: 1 }),
      /regular file/u,
    );
  });

  test("counts the file without retaining text past the output limits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-bounded-read-"));
    const lines = Array.from(
      { length: 10_000 },
      (_, index) => `line-${String(index + 1).padStart(5, "0")}`,
    );
    try {
      await writeFile(join(directory, "large.txt"), lines.join("\n"));
      const tool = createReadTool(directory);

      const truncated = await tool.execute("read", { path: "large.txt" });
      assert.equal(truncated.details?.truncation?.truncatedBy, "lines");
      assert.equal(truncated.details?.truncation?.totalLines, 10_000);
      assert.match(toolResultText(truncated.content), /Showing lines 1-2000 of 10000/u);

      const selected = await tool.execute("read", {
        path: "large.txt",
        offset: 9001,
        limit: 5,
      });
      assert.equal(
        toolResultText(selected.content),
        `${lines.slice(9000, 9005).join("\n")}\n\n[995 more lines in file. Use offset=9006 to continue.]`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("preserves a trailing newline at the line limit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-trailing-newline-read-"));
    const content = `${Array.from({ length: 2000 }, () => "x").join("\n")}\n`;
    try {
      await writeFile(join(directory, "lines.txt"), content);
      const result = await createReadTool(directory).execute("read", { path: "lines.txt" });

      assert.equal(toolResultText(result.content), content);
      assert.equal(result.details, undefined);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("measures an oversized first line without retaining it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-long-line-read-"));
    try {
      await writeFile(join(directory, "long.txt"), `${"x".repeat(60 * 1024)}\ntail`);
      const result = await createReadTool(directory).execute("read", { path: "long.txt" });

      assert.match(toolResultText(result.content), /Line 1 is 60\.0KB, exceeds 50\.0KB limit/u);
      assert.equal(result.details?.truncation?.firstLineExceedsLimit, true);
      assert.equal(result.details?.truncation?.totalBytes, 60 * 1024 + 5);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("stops a text scan when aborted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-aborted-read-"));
    try {
      await writeFile(join(directory, "large.txt"), Buffer.alloc(8 * 1024 * 1024, "x"));
      const controller = new AbortController();
      const execution = createReadTool(directory).execute(
        "read",
        { path: "large.txt" },
        controller.signal,
      );
      controller.abort();

      await assert.rejects(execution, /Operation aborted|AbortError/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
