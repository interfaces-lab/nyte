import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhotonImage } from "@cf-wasm/photon/node";
import { describe, expect, test } from "vitest";
import { createRegistries } from "../src/plugins/host.ts";
import { createBashToolDefinition } from "../src/tools/bash.ts";
import { applyEditsToNormalizedContent } from "../src/tools/edit-diff.ts";
import { createEditToolDefinition } from "../src/tools/edit.ts";
import { bindEnv, builtinTools } from "./builtin-tools.ts";
import { createReadToolDefinition } from "../src/tools/read.ts";
import { createWriteToolDefinition } from "../src/tools/write.ts";
import { ToolError, ToolStop, toolResultText } from "../src/kernel/loop/tool-result.ts";
import type { ExecutionEnv } from "../src/kernel/loop/env.ts";
import { localEnv, toolCall } from "./kernel/helpers.ts";

test(
  "read preserves small images and bounds converted, oversized, and oriented images",
  { timeout: 20_000 },
  async () => {
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

      const tool = bindEnv({ ...createReadToolDefinition(), name: "read" }, localEnv(directory));
      for (const fixture of fixtures) {
        await writeFile(join(directory, fixture.name), fixture.bytes);
        const result = await tool.execute({ path: fixture.name }, toolCall("read"));
        const image = result.content.find((part) => part.type === "image");
        assert.ok(image, `${fixture.name} returns an attachment`);
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
  },
);

test("builtin registry contributions retain identity through rebuilds", () => {
  const registries = createRegistries();
  const tools = builtinTools("/tmp");
  registries.tools.add("builtin", 0, (draft) => {
    for (const tool of tools) draft.set(tool.name, tool);
  });
  assert.equal(registries.tools.rebuild().added.length, tools.length);
  assert.deepEqual(registries.tools.rebuild(), { added: [], removed: [], changed: [], errors: [] });
});

describe("file mutation tools", () => {
  test("write creates and overwrites files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-write-tool-"));
    const path = "nested/example.ts";
    const absolutePath = join(directory, path);
    const tool = bindEnv({ ...createWriteToolDefinition(), name: "write" }, localEnv(directory));

    try {
      const created = await tool.execute({ path, content: "first\nkept\n" }, toolCall("call_1"));
      assert.equal(toolResultText(created.content), `Successfully wrote to ${path}`);
      assert.deepEqual(created.details, {
        patch: `--- ${path}\n+++ ${path}\n@@ -0,0 +1,2 @@\n+first\n+kept\n`,
      });
      assert.equal(await readFile(absolutePath, "utf8"), "first\nkept\n");

      const updated = await tool.execute({ path, content: "changed\nkept\n" }, toolCall("call_2"));
      assert.equal(toolResultText(updated.content), `Successfully wrote to ${path}`);
      assert.deepEqual(updated.details, {
        patch: `--- ${path}\n+++ ${path}\n@@ -1,2 +1,2 @@\n-first\n+changed\n kept\n`,
      });
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
      const edit = bindEnv({ ...createEditToolDefinition(), name: "edit" }, localEnv(directory));

      const result = await edit.execute(
        {
          path,
          edits: [{ oldText: "before", newText: "after" }],
        },
        toolCall("call_1"),
      );
      assert.equal(toolResultText(result.content), `Successfully replaced 1 block(s) in ${path}.`);
      assert.ok(result.details);
      assert.match(result.details.patch, /-before\n\+after/u);
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
      const operations = localEnv("/tmp");
      const controller = new AbortController();
      let resolvePid: ((pid: number) => void) | undefined;
      const childPid = new Promise<number>((resolve) => {
        resolvePid = resolve;
      });
      let output = "";
      const execution = operations.exec("sleep 30 & child=$!; echo $child; wait $child", {
        signal: controller.signal,
        onData: async (chunk) => {
          output += chunk.toString("utf8");
          const pid = Number.parseInt(output.trim(), 10);
          if (Number.isSafeInteger(pid) && pid > 0) resolvePid?.(pid);
        },
      });
      const pid = await childPid;

      controller.abort();
      await assert.rejects(execution, /Command interrupted/);
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

  test("coding defaults expose four tools and structured shell results", async () => {
    assert.deepEqual(
      builtinTools(process.cwd()).map((tool) => tool.name),
      ["read", "bash", "edit", "write"],
    );
    const tool = bindEnv({ ...createBashToolDefinition(), name: "bash" }, localEnv(process.cwd()));
    const present = { runId: "run_1", head: "main", callId: "bash" };
    assert.deepEqual(Object.keys(tool.parameters.properties), ["command", "timeout"]);
    const result = await tool.execute({ command: "printf done" }, toolCall("bash"));
    expect(result.content).toEqual([{ type: "text", text: "done" }]);
    expect(result.structuredContent).toMatchObject({ output: "done", exit_code: 0 });
    assert.deepEqual(tool.present?.({ command: "printf done" }, present), {
      kind: "shell",
      command: "printf done",
    });
    const settled = tool.present?.({ command: "printf done" }, present, result);
    assert.ok(settled?.kind === "shell" && settled.facts !== undefined);
    assert.equal(settled.facts.truncated, false);
    assert.equal(settled.facts.fullOutputPath, undefined);
    assert.ok(Number.isInteger(settled.facts.durationMs) && settled.facts.durationMs >= 0);
    await assert.rejects(
      tool.execute({ command: "printf failed; exit 7" }, toolCall("bash-error")),
      (error) => {
        assert.ok(error instanceof ToolError);
        assert.deepEqual(error.reason, { kind: "exit", code: 7 });
        assert.match(toolResultText(error.result.content), /failed\n\nCommand exited with code 7/u);
        expect(error.result.structuredContent).toMatchObject({ output: "failed", exit_code: 7 });
        const failed = tool.present?.({ command: "" }, present, error.result);
        assert.ok(failed?.kind === "shell");
        expect(failed.facts).toMatchObject({ truncated: false });
        return true;
      },
    );
  });

  test("a timeout, a participant's stop, and the host's stop settle with their own reasons and keep the output so far", async () => {
    const tool = bindEnv({ ...createBashToolDefinition(), name: "bash" }, localEnv(process.cwd()));
    await assert.rejects(
      tool.execute({ command: "printf partial; sleep 30", timeout: 0.2 }, toolCall("slow")),
      (error) => {
        assert.ok(error instanceof ToolError);
        assert.deepEqual(error.reason, { kind: "timeout" });
        assert.equal(
          toolResultText(error.result.content),
          "partial\n\nCommand timed out after 0.2 seconds",
        );
        assert.ok(error.result.details?.durationMs !== undefined);
        return true;
      },
    );
    const controller = new AbortController();
    const execution = tool.execute(
      { command: "printf partial; sleep 30" },
      toolCall("stopped", {
        signal: controller.signal,
        update: ({ content }) => {
          if (toolResultText(content) === "partial") controller.abort(new ToolStop("cancelled"));
        },
      }),
    );
    await assert.rejects(execution, (error) => {
      assert.ok(error instanceof ToolError);
      assert.deepEqual(error.reason, { kind: "cancelled" });
      assert.equal(toolResultText(error.result.content), "partial\n\nCommand cancelled");
      assert.ok(error.result.details?.durationMs !== undefined);
      return true;
    });
    const host = new AbortController();
    host.abort();
    await assert.rejects(
      tool.execute({ command: "printf never" }, toolCall("left", { signal: host.signal })),
      (error) => {
        assert.ok(error instanceof ToolError);
        assert.deepEqual(error.reason, { kind: "interrupted" });
        assert.equal(toolResultText(error.result.content), "Command interrupted");
        assert.ok(error.result.details?.durationMs !== undefined);
        return true;
      },
    );
  });

  test("the first stop to fire is the one reported: a timeout is not relabelled by a later abort", async () => {
    const controller = new AbortController();
    const execution = localEnv(process.cwd()).exec("printf started; sleep 30", {
      signal: controller.signal,
      timeout: 0.1,
      onData: () => {
        setTimeout(() => {
          const until = performance.now() + 100;
          while (performance.now() < until) continue;
        }, 70);
        setTimeout(() => controller.abort(new ToolStop("cancelled")), 120);
      },
    });
    await assert.rejects(execution, (error) => {
      assert.ok(error instanceof ToolError);
      assert.deepEqual(error.reason, { kind: "timeout" });
      return true;
    });
  });

  test("a spawn failure keeps what was measured", async () => {
    const failing = bindEnv(
      { ...createBashToolDefinition(), name: "bash" },
      {
        ...localEnv(process.cwd()),
        exec: async () => {
          throw new Error("spawn failed");
        },
      },
    );
    await assert.rejects(failing.execute({ command: "nothing" }, toolCall("spawn")), (error) => {
      assert.ok(error instanceof ToolError);
      assert.deepEqual(error.reason, { kind: "error" });
      assert.equal(toolResultText(error.result.content), "spawn failed");
      assert.ok(error.result.details?.durationMs !== undefined);
      return true;
    });
  });

  test("truncated output names its spill file only where the environment can see it", async () => {
    const output = Array.from({ length: 5000 }, (_, line) => String(line).padEnd(300, "x")).join(
      "\n",
    );

    const spills: string[] = [];

    const printing = (env: ExecutionEnv) =>
      bindEnv(
        { ...createBashToolDefinition(), name: "bash" },
        {
          ...env,
          exec: async (_command, { onData }) => {
            onData(Buffer.from(output));

            return { exitCode: 0 };
          },
        },
      );

    try {
      const hidden = await printing({
        ...localEnv(process.cwd()),
        stat: async (path) => {
          spills.push(path);

          return undefined;
        },
      }).execute({ command: "print" }, toolCall("hidden"));

      assert.equal(spills.length, 1);
      assert.equal(await readFile(spills[0], "utf8"), output);
      assert.match(toolResultText(hidden.content), /\[Showing lines \d+-5000 of 5000/);
      assert.doesNotMatch(toolResultText(hidden.content), /Full output/);
      assert.ok(hidden.details?.truncation);
      assert.equal(hidden.details.fullOutputPath, undefined);
      expect(hidden.structuredContent).toMatchObject({ truncated: true });
      expect(hidden.structuredContent).not.toHaveProperty("full_output_path");

      const visible = await printing(localEnv(process.cwd())).execute(
        { command: "print" },
        toolCall("visible"),
      );

      const spilled = visible.details?.fullOutputPath;

      assert.ok(spilled !== undefined);
      spills.push(spilled);
      assert.ok(toolResultText(visible.content).includes(`Full output: ${spilled}`));
      expect(visible.structuredContent).toMatchObject({ full_output_path: spilled });
    } finally {
      await Promise.all(spills.map((path) => rm(path, { force: true })));
    }
  });
});
