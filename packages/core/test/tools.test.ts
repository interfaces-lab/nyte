import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhotonImage } from "@cf-wasm/photon/node";
import { describe, test } from "vitest";
import { createLocalBashOperations } from "../src/tools/bash.ts";
import { applyEditsToNormalizedContent } from "../src/tools/edit-diff.ts";
import { createEditTool } from "../src/tools/edit.ts";
import { createLsTool } from "../src/tools/ls.ts";
import { createReadTool } from "../src/tools/read.ts";
import { createWriteTool } from "../src/tools/write.ts";
import { toolResultText } from "../src/utils/tool-result.ts";

test("read preserves small images and bounds converted, oversized, and oriented images", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-read-image-"));
  const small = new PhotonImage(new Uint8Array(4 * 8 * 4).fill(255), 8, 4);
  const large = new PhotonImage(new Uint8Array(4 * 2400 * 1200).fill(255), 2400, 1200);
  try {
    const png = Buffer.from(small.get_bytes());
    const jpeg = Buffer.from(large.get_bytes_jpeg(80));
    // JPEG APP1 with EXIF orientation 6, a clockwise quarter-turn.
    const exif = Buffer.from(
      "ffe1002245786966000049492a0008000000010012010300010000000600000000000000",
      "hex",
    );
    const fixtures = [
      { name: "small", bytes: png, width: 8, height: 4 },
      { name: "large", bytes: large.get_bytes(), width: 2000, height: 1000 },
      {
        name: "payload",
        bytes: Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]),
        width: 8,
        height: 4,
      },
      {
        name: "oriented",
        bytes: Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]),
        width: 1000,
        height: 2000,
      },
      {
        name: "bitmap",
        bytes: Buffer.from(
          "424d3a0000000000000036000000280000000100000001000000010018000000000004000000000000000000000000000000000000000000ff00",
          "hex",
        ),
        width: 1,
        height: 1,
      },
    ];
    const tool = createReadTool(directory);
    for (const fixture of fixtures) {
      await writeFile(join(directory, fixture.name), fixture.bytes);
      const result = await tool.execute("read", { path: fixture.name });
      const image = result.content.find((part) => part.type === "image");
      assert.ok(image, `${fixture.name} returns an attachment`);
      assert.equal(result.title, fixture.name);
      assert.ok(image.data.length <= 4.5 * 1024 * 1024);
      if (fixture.name === "small") assert.equal(image.data, png.toString("base64"));
      if (fixture.name === "bitmap") assert.equal(image.mimeType, "image/png");
      const decoded = PhotonImage.new_from_byteslice(Buffer.from(image.data, "base64"));
      try {
        assert.equal(decoded.get_width(), fixture.width, fixture.name);
        assert.equal(decoded.get_height(), fixture.height, fixture.name);
      } finally {
        decoded.free();
      }
    }
  } finally {
    small.free();
    large.free();
    await rm(directory, { recursive: true, force: true });
  }
});

describe("ls tool", () => {
  test("observes aborts while an operation is in flight", async () => {
    let finishRead: ((entries: string[]) => void) | undefined;
    const entries = new Promise<string[]>((resolve) => {
      finishRead = resolve;
    });
    const tool = createLsTool("/workspace", {
      operations: {
        exists: () => true,
        stat: () => ({ isDirectory: () => true }),
        readdir: () => entries,
      },
    });
    const controller = new AbortController();

    const execution = tool.execute("call_1", {}, controller.signal);
    controller.abort();
    finishRead?.([]);

    await assert.rejects(execution, /Operation aborted/);
  });
});

describe("file mutation tools", () => {
  test("write returns a patch for creates and overwrites", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-write-tool-"));
    const path = "nested/example.ts";
    const absolutePath = join(directory, path);
    const tool = createWriteTool(directory);

    try {
      const created = await tool.execute("call_1", { path, content: "first\nkept\n" });
      assert.equal(toolResultText(created.content), `Wrote ${path}.`);
      assert.match(created.details.patch, /@@ -0,0 \+1,2 @@/u);
      assert.match(created.details.diff, /\+1 first\n\+2 kept/u);
      assert.equal(created.details.firstChangedLine, 1);

      const updated = await tool.execute("call_2", { path, content: "changed\nkept\n" });
      assert.match(updated.details.patch, /-first\n\+changed/u);
      assert.match(updated.details.diff, /-1 first\n\+1 changed/u);
      assert.equal(await readFile(absolutePath, "utf8"), "changed\nkept\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("edit returns the shared patch details", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-edit-tool-"));
    const path = "example.ts";

    try {
      await writeFile(join(directory, path), "before\nkept\n");
      const result = await createEditTool(directory).execute("call_1", {
        path,
        edits: [{ oldText: "before", newText: "after" }],
      });
      assert.equal(toolResultText(result.content), `Replaced 1 block(s) in ${path}.`);
      assert.match(result.details.patch, /-before\n\+after/u);
      assert.match(result.details.diff, /-1 before\n\+1 after/u);
      assert.equal(result.details.firstChangedLine, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("edit replacements", () => {
  test("re-matches exact edits after fuzzy normalization shifts their offsets", () => {
    const content = "untouched  \nﬁrst  \nexact target\nkept ‘quotes’  \n";
    assert.deepEqual(
      applyEditsToNormalizedContent(
        content,
        [
          { oldText: "exact target", newText: "exact replacement" },
          { oldText: "first", newText: "fuzzy replacement" },
        ],
        "example.txt",
      ),
      {
        baseContent: content,
        newContent: "untouched  \nfuzzy replacement\nexact replacement\nkept ‘quotes’  \n",
      },
    );
  });

  test("rejects a fuzzy-only duplicate even when the needle matches exactly", () => {
    assert.throws(
      () =>
        applyEditsToNormalizedContent(
          "first\nﬁrst\n",
          [{ oldText: "first", newText: "changed" }],
          "example.txt",
        ),
      /Found 2 occurrences of the text in example.txt/,
    );
  });

  test("assembles three same-line replacements after a fuzzy first match changes the length", () => {
    const content = "kept ‘header’  \nprefix ﬁrst / second / third suffix\nkept footer  \n";
    assert.deepEqual(
      applyEditsToNormalizedContent(
        content,
        [
          { oldText: "first", newText: "longer first replacement" },
          { oldText: "second", newText: "" },
          { oldText: "third", newText: "3" },
        ],
        "example.txt",
      ),
      {
        baseContent: content,
        newContent:
          "kept ‘header’  \nprefix longer first replacement /  / 3 suffix\nkept footer  \n",
      },
    );
  });
});

describe("local bash lifecycle", () => {
  test(
    "abort kills the active shell process group",
    { skip: process.platform === "win32" },
    async () => {
      const operations = createLocalBashOperations();
      const controller = new AbortController();
      let resolvePid: ((pid: number) => void) | undefined;
      const childPid = new Promise<number>((resolve) => {
        resolvePid = resolve;
      });
      let output = "";
      const execution = operations.exec("sleep 30 & child=$!; echo $child; wait $child", "/tmp", {
        signal: controller.signal,
        onData: (chunk) => {
          output += chunk.toString("utf8");
          const pid = Number.parseInt(output.trim(), 10);
          if (Number.isSafeInteger(pid) && pid > 0) resolvePid?.(pid);
        },
      });
      const pid = await childPid;

      controller.abort();
      await assert.rejects(execution, /aborted/);
      let alive = true;
      for (let attempt = 0; attempt < 50 && alive; attempt += 1) {
        try {
          process.kill(pid, 0);
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
        } catch {
          alive = false;
        }
      }
      assert.equal(alive, false);
    },
  );
});
