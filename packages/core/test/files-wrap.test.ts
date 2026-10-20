import { asId } from "@nyte-ai/schema";
import type { Json, SessionId, ToolOutcome } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { executeCall } from "../src/agent/tool-runner.ts";
import { environmentPlugin } from "../src/builtins/environment.ts";
import { EMPTY_SNAPSHOT } from "../src/engine/batches.ts";
import { ALL_AUTHORITY, LOCAL } from "../src/index.ts";
import { decodeReceiptRecord, receiptRef } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { ConnectionContext, FilesApi } from "../src/index.ts";
import { collect, world } from "./fake-env.ts";
import { configuration, main, startRun, until } from "../src/harness.ts";

const caller: ConnectionContext = {
  principal: LOCAL,
  authority: ALL_AUTHORITY,
  credential: { kind: "token", token: "x" },
  origin: null,
};

async function* streamBytes(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

async function sessionFiles(options?: Parameters<typeof world>[0]) {
  const built = await world(options);
  const { session } = await built.host.sessions.start({
    workspace: built.workspace,
    content: "Hi.",
  });
  const files: FilesApi = (await built.kernel.environments.attach(session.id)).files;

  return { ...built, session, files };
}

async function tools(kernel: Kernel, session: SessionId) {
  const run = await startRun(
    kernel,
    session,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  let calls = 0;

  return async (
    name: string,
    args: Json,
    signal = new AbortController().signal,
  ): Promise<ToolOutcome> => {
    calls += 1;

    const outcome = await executeCall(kernel, {
      session,
      runtime: kernel.plugins.runtime(session),
      head: main,
      run: run.id,
      call: asId(`call-${calls}`),
      name,
      args,
      context: caller,
      signal,
    });

    assert(outcome.kind !== "parked");

    return outcome;
  };
}

function readText(outcome: ToolOutcome): string {
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
    const blob = await files.upload(streamBytes(bytes));
    const reader = await host.blob(blob);

    expect(await collect(reader.chunks())).toEqual([bytes]);

    const receipt = await files
      .batch()
      .put({ path: "image.bin", contents: { blob } })
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

    expect(readText(await call("read", { path: "src/a.ts" }))).toBe(
      "     1\talpha\n     2\tbeta\n     3\tgamma",
    );
    expect(readText(await call("read", { path: "src/a.ts", offset: 2, limit: 1 }))).toBe(
      "     2\tbeta\n… 1 more lines; continue with offset 3.",
    );
    expect(readText(await call("read", { path: "nope.ts" }))).toBe("nope.ts does not exist.");

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
      readText(await call("write", { path: "deep/new.ts", content: "let a = 1;\nlet b = 1;\n" })),
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

    expect(readText(await call("edit", { path: "deep/new.ts", edits }))).toBe(
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

    expect(readText(await call("list", {}))).toBe("README.md\nsrc/");
    expect(readText(await call("list", { path: "src" }))).toBe("a.ts\nlib/");
    expect(readText(await call("list", { path: "src", limit: 1 }))).toBe(
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

    expect(readText(await call("bash", { command: "echo hi", description: "Greets" }))).toBe(
      "hi\n[exit code 0]",
    );
    expect(readText(await call("bash", { command: "false" }))).toBe("no\n[exit code 1]");
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
      void until(() => (progress.length > 0 ? true : undefined)).then(() => {
        process.emit("two\n");
        process.exit(0);
      });
    };

    expect(readText(await call("bash", { command: "count" }))).toBe("one\ntwo\n[exit code 0]");
    expect(progress).toEqual(["one", "one\ntwo"]);
  });

  it("runs a shell command as a job of its session and call, listed until it exits, with no exit report", async () => {
    const { kernel, host, workspace, session, provider } = await sessionFiles({
      plugins: [environmentPlugin],
    });

    const call = await tools(kernel, session.id);
    const jobs = host.workspace(workspace).jobs;
    provider.script = (process) => process.emit("built\n");
    const running = call("bash", { command: "pnpm build", description: "Builds" });
    const job = await until(async () => (await jobs.list())[0]);

    expect(job).toMatchObject({
      command: "pnpm build",
      title: "Builds",
      session: session.id,
      state: { kind: "running" },
    });
    expect((await session.view()).background).toEqual([
      { kind: "job", id: job.id, title: "Builds", state: "working", startedBy: "call-1" },
    ]);

    provider.processes[0]?.exit(0);

    expect(readText(await running)).toBe("built\n[exit code 0]");
    expect(await jobs.list()).toMatchObject([
      { id: job.id, state: { kind: "exited", code: 0, reason: "exited" } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      (await session.view()).messages.filter(
        (message) => message.kind === "user" && message.source.kind === "job",
      ),
    ).toEqual([]);
  });

  it("stops a shell command's job when its call is stopped", async () => {
    const { kernel, host, workspace, session, provider } = await sessionFiles({
      plugins: [environmentPlugin],
    });

    const call = await tools(kernel, session.id);
    const jobs = host.workspace(workspace).jobs;
    const controller = new AbortController();
    provider.script = () => undefined;
    const running = call("bash", { command: "sleep 600" }, controller.signal);
    await until(async () => (await jobs.list())[0]);
    controller.abort();

    expect(await running).toEqual({ kind: "stopped" });
    expect(await jobs.list()).toMatchObject([
      { state: { kind: "exited", code: null, reason: "terminated" } },
    ]);
  });

  it("starts a background command with its first output and tells the session when it exits", async () => {
    const { kernel, host, workspace, session, provider } = await sessionFiles({
      plugins: [environmentPlugin],
    });

    const call = await tools(kernel, session.id);
    const jobs = host.workspace(workspace).jobs;
    provider.script = (process) => process.emit("listening on :3000\n");
    const started = readText(await call("bash", { command: "pnpm dev", background: true }));
    const [job] = await jobs.list();
    assert(job !== undefined);

    expect(started).toBe(
      `listening on :3000\n[running in the background as job ${job.id}: you are told when it exits; the job tool reads its output or stops it]`,
    );
    expect(job).toMatchObject({ session: session.id, state: { kind: "running" } });

    provider.processes[0]?.exit(1);

    expect(
      await until(async () =>
        (await session.view()).messages.find(
          (message) => message.kind === "user" && message.source.kind === "job",
        ),
      ),
    ).toMatchObject({
      content: "Job pnpm dev (pnpm dev) exited with code 1.\n\nlistening on :3000",
      source: { kind: "job", job: job.id },
      delivery: "attach",
    });
  });

  it("moves a running shell command to the background on its part's action, then reads and stops it with the job tool", async () => {
    const { kernel, host, workspace, session, provider } = await sessionFiles({
      plugins: [environmentPlugin],
    });

    const call = await tools(kernel, session.id);
    const jobs = host.workspace(workspace).jobs;
    const progress: (string | undefined)[] = [];

    kernel.bus.subscribe(session.id, (event) => {
      if (event.kind === "patch" && "progress" in event && event.part === "call-1")
        progress.push(event.progress.text);
    });
    provider.script = (process) => process.emit("watching\n");
    const running = call("bash", { command: "pnpm test" });
    await until(() => progress[0]);

    expect(await session.part(asId("call-1")).act("background", {})).toEqual({
      kind: "ok",
      output: undefined,
    });

    const [job] = await jobs.list();
    assert(job !== undefined);

    expect(readText(await running)).toBe(
      `watching\n[running in the background as job ${job.id}: you are told when it exits; the job tool reads its output or stops it]`,
    );
    expect(readText(await call("job", { id: job.id, action: "output" }))).toBe(
      `Job ${job.id} is running:\nwatching`,
    );
    expect(readText(await call("job", { id: job.id, action: "stop" }))).toBe(
      `Job ${job.id} ended (terminated) with code none:\nwatching`,
    );
    expect(
      await until(async () =>
        (await session.view()).messages.find(
          (message) => message.kind === "user" && message.source.kind === "job",
        ),
      ),
    ).toMatchObject({
      content: "Job pnpm test (pnpm test) ended (terminated) with code none.\n\nwatching",
      source: { kind: "job", job: job.id },
    });
  });

  it("names the workspace root in the cwd prompt section", async () => {
    const { kernel, session } = await sessionFiles({ plugins: [environmentPlugin] });

    expect(kernel.plugins.runtime(session.id).registries.prompt.list()).toEqual(
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
