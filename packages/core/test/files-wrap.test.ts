import { asId } from "@nyte-ai/schema";
import type { Json, ToolOutcome } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import {
  ALL_AUTHORITY,
  EMPTY_SNAPSHOT,
  LOCAL,
  decodeReceiptRecord,
  environmentPlugin,
  executeCall,
  receiptRef,
  startRun,
} from "../src/index.ts";
import type { ConnectionContext, FilesApi, Kernel } from "../src/index.ts";
import { collect, world } from "./fake-env.ts";
import { configuration, main, until } from "./harness.ts";

const caller: ConnectionContext = {
  principal: LOCAL,
  authority: ALL_AUTHORITY,
  credential: { kind: "token", token: "x" },
  origin: null,
};

/** Returns a byte stream of one chunk. */
async function* streamOf(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/** Returns a session on the fake world and its environment's wrapped files. */
async function sessionFiles(options?: Parameters<typeof world>[0]) {
  const built = await world(options);
  const session = await built.host.sessions.create({ workspace: built.workspace });
  const files: FilesApi = (await built.kernel.env(session.id)).files;

  return { ...built, session, files };
}

/** Returns a function running one tool call in a fresh live run on main. */
async function tools(kernel: Kernel, session: Parameters<Kernel["env"]>[0]) {
  const run = await startRun(
    kernel,
    session,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  let calls = 0;

  return async (name: string, args: Json): Promise<ToolOutcome> => {
    calls += 1;

    const outcome = await executeCall(kernel, {
      session,
      head: main,
      run: run.id,
      call: asId(`call-${calls}`),
      name,
      args,
      context: caller,
      signal: new AbortController().signal,
    });

    assert(outcome.kind !== "parked");

    return outcome;
  };
}

/** Returns the text of an `ok` outcome's text items. */
function textOf(outcome: ToolOutcome): string {
  assert(outcome.kind === "ok");

  return outcome.content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join("\n");
}

describe("file batches", () => {
  it("applies a plan as a durable receipt in the session, leaving each plan immutable", async () => {
    const { kernel, session, files, disk } = await sessionFiles();
    disk.put("/work/project/old.txt", "old\n");
    const empty = files.batch();

    const plan = empty
      .put({ path: "a.txt", contents: "A\n", expect: "absent" })
      .put({ path: "deep/b.txt", contents: "B\n" })
      .remove({ path: "old.txt" });

    const receipt = await plan.apply();
    const outcome = await receipt.settled();

    assert(outcome.kind === "applied");
    expect(outcome.paths).toEqual(["a.txt", "deep/b.txt", "old.txt"]);
    expect(outcome.snapshot).not.toBe(EMPTY_SNAPSHOT);
    expect([
      disk.text("/work/project/a.txt"),
      disk.text("/work/project/deep/b.txt"),
      disk.text("/work/project/old.txt"),
    ]).toEqual(["A\n", "B\n", undefined]);
    expect(await session.receipt(receipt.id).status()).toEqual({ kind: "settled", outcome });

    const ref = await kernel.store.refs.get(receiptRef(session.id, receipt.id));

    const record = decodeReceiptRecord(
      ref?.target ? await kernel.store.objects.get(ref.target) : null,
    );

    expect(record).toMatchObject({ kind: "batch", digest: expect.any(String), outcome });
    expect(await (await empty.apply()).settled()).toMatchObject({ kind: "applied", paths: [] });
  });

  it("answers stale before writing anything when any expect moved", async () => {
    const { files, disk } = await sessionFiles();
    disk.put("/work/project/a.txt", "A\n");
    const version = disk.files.get("/work/project/a.txt")?.version;
    assert(version !== undefined);
    disk.put("/work/project/a.txt", "A2\n");
    disk.put("/work/project/taken.txt", "already\n");

    const receipt = await files
      .batch()
      .put({ path: "new.txt", contents: "N\n" })
      .put({ path: "a.txt", contents: "A3\n", expect: version })
      .put({ path: "taken.txt", contents: "T\n", expect: "absent" })
      .apply();

    expect(await receipt.settled()).toEqual({ kind: "stale", paths: ["a.txt", "taken.txt"] });
    expect(disk.text("/work/project/new.txt")).toBeUndefined();
  });

  it("stops part way as partial when an entry fails, naming what was and was not applied", async () => {
    const { files, disk } = await sessionFiles();

    const receipt = await files
      .batch()
      .put({ path: "a.txt", contents: "A\n" })
      .remove({ path: "missing.txt" })
      .put({ path: "c.txt", contents: "C\n" })
      .apply();

    expect(await receipt.settled()).toEqual({
      kind: "partial",
      applied: ["a.txt"],
      remaining: ["missing.txt", "c.txt"],
      reason: "missing.txt moved while the batch ran.",
    });
    expect(disk.text("/work/project/c.txt")).toBeUndefined();
  });

  it("stops before the next entry when the receipt is stopped", async () => {
    const { session, files, disk } = await sessionFiles();
    const release = disk.pause();

    const receipt = await files
      .batch()
      .put({ path: "a.txt", contents: "A\n" })
      .put({ path: "b.txt", contents: "B\n" })
      .apply();

    await until(() => (disk.held === 1 ? true : undefined));
    expect(await session.receipt(receipt.id).stop()).toEqual({ kind: "requested" });
    release();

    expect(await receipt.settled()).toEqual({ kind: "stopped", applied: ["a.txt"] });
    expect(disk.text("/work/project/b.txt")).toBeUndefined();
  });

  it("holds a batch applied outside a session in memory, and puts uploaded blobs by id", async () => {
    const { kernel, host, disk, workspace } = await world();
    const capability = await host.workspace(workspace).files();
    assert(capability.kind === "available");
    const files = capability.api;
    const bytes = new Uint8Array([0, 1, 2, 250]);
    const blob = await files.upload(streamOf(bytes));
    const reader = await host.blob(blob);

    expect(await collect(reader.chunks())).toEqual([bytes]);

    const receipt = await files
      .batch()
      .put({ path: "image.bin", contents: blob })
      .put({ path: "note.txt", contents: "hi\n" })
      .apply();

    const outcome = await receipt.settled();

    expect(outcome).toMatchObject({ kind: "applied", paths: ["image.bin", "note.txt"] });
    expect(await receipt.status()).toEqual({ kind: "settled", outcome });
    expect(await receipt.stop()).toEqual({ kind: "settled", outcome });
    expect(disk.files.get("/work/project/image.bin")?.contents).toEqual(bytes);
    expect((await kernel.store.refs.list("sessions/")).map((ref) => ref.name)).not.toEqual(
      expect.arrayContaining([expect.stringContaining(receipt.id)]),
    );
  });
});

describe("environment tools", () => {
  it("reads text as numbered lines, binary as an uploaded file, and says when a file is missing", async () => {
    const { kernel, host, session, disk } = await sessionFiles({ plugins: [environmentPlugin] });
    const call = await tools(kernel, session.id);
    disk.put("/work/project/src/a.ts", "alpha\nbeta\ngamma\n");
    const image = new Uint8Array([137, 80, 78, 71]);
    disk.put("/work/project/logo.png", image);

    expect(textOf(await call("read", { path: "src/a.ts" }))).toBe(
      "     1\talpha\n     2\tbeta\n     3\tgamma",
    );
    expect(textOf(await call("read", { path: "src/a.ts", offset: 2, limit: 1 }))).toBe(
      "     2\tbeta\n… 1 more lines; continue with offset 3.",
    );
    expect(textOf(await call("read", { path: "nope.ts" }))).toBe("nope.ts does not exist.");

    const binary = await call("read", { path: "logo.png" });

    assert(binary.kind === "ok");
    expect(binary.content[0]).toEqual({ kind: "text", text: "logo.png is binary: 4 bytes." });
    const file = binary.content[1];
    assert(file?.kind === "file");
    expect(file).toMatchObject({ mime: "image/png", name: "logo.png" });
    expect(await collect((await host.blob(file.blob)).chunks())).toEqual([image]);
  });

  it("writes whole files with parents, and edits by unique exact replacement", async () => {
    const { kernel, session, disk } = await sessionFiles({ plugins: [environmentPlugin] });
    const call = await tools(kernel, session.id);

    expect(
      textOf(await call("write", { path: "deep/new.ts", content: "let a = 1;\nlet b = 1;\n" })),
    ).toBe("Wrote 22 bytes to deep/new.ts.");
    expect(disk.text("/work/project/deep/new.ts")).toBe("let a = 1;\nlet b = 1;\n");

    expect(
      await call("edit", { path: "deep/new.ts", edits: [{ oldText: "= 1;", newText: "= 2;" }] }),
    ).toEqual({
      kind: "failed",
      message: "Edit 1: oldText occurs 2 times in deep/new.ts; make it unique.",
    });
    expect(
      await call("edit", { path: "deep/new.ts", edits: [{ oldText: "let c", newText: "let d" }] }),
    ).toEqual({
      kind: "failed",
      message: "Edit 1: no match for oldText in deep/new.ts.",
    });

    const edits = [
      { oldText: "let a = 1;", newText: "let a = 2;" },
      { oldText: "let b = 1;", newText: "let b = 3;" },
    ];

    expect(textOf(await call("edit", { path: "deep/new.ts", edits }))).toBe(
      "Edited deep/new.ts: 2 replacements.",
    );
    expect(disk.text("/work/project/deep/new.ts")).toBe("let a = 2;\nlet b = 3;\n");
    expect(await call("edit", { path: "deep/new.ts", edits })).toEqual({
      kind: "failed",
      message: "Edit 1: no match for oldText in deep/new.ts.",
    });
    expect(disk.text("/work/project/deep/new.ts")).toBe("let a = 2;\nlet b = 3;\n");
  });

  it("lists one directory level, directories ending in a slash, and runs shell commands with their exit code", async () => {
    const { kernel, session, disk, provider } = await sessionFiles({
      plugins: [environmentPlugin],
    });

    const call = await tools(kernel, session.id);
    disk.put("/work/project/src/a.ts", "a\n");
    disk.put("/work/project/src/lib/b.ts", "b\n");
    disk.put("/work/project/README.md", "r\n");

    expect(textOf(await call("list", {}))).toBe("README.md\nsrc/");
    expect(textOf(await call("list", { path: "src" }))).toBe("a.ts\nlib/");
    expect(textOf(await call("list", { path: "src", limit: 1 }))).toBe(
      "a.ts\n… 1 more entries not shown.",
    );

    provider.script = (process) => {
      if (process.command === "false") {
        process.emit("no\n");
        process.exit(1);

        return;
      }

      process.emit("hi\n");
      process.exit(0);
    };

    expect(textOf(await call("bash", { command: "echo hi", description: "Greets" }))).toBe(
      "hi\n[exit code 0]",
    );
    expect(textOf(await call("bash", { command: "false" }))).toBe("no\n[exit code 1]");
  });

  it("publishes a running shell call's output tail as its part's progress", async () => {
    const { kernel, session, provider } = await sessionFiles({ plugins: [environmentPlugin] });
    const call = await tools(kernel, session.id);
    const progress: (string | undefined)[] = [];

    kernel.bus.subscribe(session.id, (event) => {
      if (event.kind === "patch" && "progress" in event && event.part === "call-1")
        progress.push(event.progress.text);
    });
    provider.script = (process) => {
      process.emit("one\n");
      process.emit("two\n");
      process.exit(0);
    };

    expect(textOf(await call("bash", { command: "count" }))).toBe("one\ntwo\n[exit code 0]");
    expect(progress).toEqual(["one", "one\ntwo"]);
  });

  it("names the workspace root in the cwd prompt section", async () => {
    const { kernel, session } = await sessionFiles({ plugins: [environmentPlugin] });

    expect(kernel.pluginsFor(session.id).registries.prompt.list()).toEqual(
      expect.arrayContaining([
        {
          id: "cwd",
          order: 100,
          text: "The workspace root is /work/project. Tool paths are relative to it.",
        },
      ]),
    );
  });
});
