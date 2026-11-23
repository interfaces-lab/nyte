import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModels } from "@nyte-ai/ai/models";
import { isPart, tool } from "@nyte-ai/core";
import type { ExecutionEnv, Job, Plugin, PluginApi } from "@nyte-ai/core";
import { memoryStore } from "@nyte-ai/core/store";
import { composeServer } from "@nyte-ai/core/testing";
import { asId } from "@nyte-ai/schema";
import type { JobEnd, OutputFrame } from "@nyte-ai/schema";
import { afterEach, assert, beforeEach, expect, it } from "vitest";
import approvalsPlugin from "../src/approvals/approvals.ts";
import { openApprovals, PERMISSIONS } from "../src/approvals/schema.ts";
import { acpAgents, antigravityProfile } from "../src/acp/index.ts";
import { env as chatOnly, until } from "./fake-models.ts";

const AGENT = fileURLToPath(new URL("./fixtures/acp-agent.mjs", import.meta.url));

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nyte-acp-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pipeJob(
  command: readonly string[],
  extra: Readonly<Record<string, string>>,
  protocol: boolean,
): Job {
  const [file = "", ...args] = command;
  const child = spawn(file, args, { cwd: dir, env: { ...process.env, ...extra }, stdio: "pipe" });
  const frames: OutputFrame[] = [];
  let wake: (() => void) | undefined;

  const push = (frame: OutputFrame) => {
    frames.push(frame);
    wake?.();
  };

  child.stdout.on("data", (chunk: Buffer) => push({ kind: "bytes", data: new Uint8Array(chunk) }));
  child.stderr.on("data", (chunk: Buffer) =>
    push(
      protocol
        ? { kind: "bytes", data: new Uint8Array(chunk), stream: "stderr" }
        : { kind: "bytes", data: new Uint8Array(chunk) },
    ),
  );

  const ended = new Promise<JobEnd>((resolve) =>
    child.on("close", (code) => {
      push({ kind: "exit", code });
      resolve({ kind: "exited", code, reason: "exited" });
    }),
  );

  return {
    id: asId(`job-${String(child.pid)}`),
    key: null,
    write: async (bytes) => {
      child.stdin.write(bytes);
    },
    async *output() {
      for (;;) {
        const frame = frames.shift();

        if (frame === undefined) {
          await new Promise<void>((resolve) => (wake = resolve));
          continue;
        }

        yield frame;

        if (frame.kind === "exit") return;
      }
    },
    resize: async () => ({ kind: "not-pty" }),
    idle: async () => false,
    stop: async () => {
      child.kill("SIGTERM");

      return { kind: "settled", outcome: await ended };
    },
    settled: () => ended,
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };
}

async function openHost(gate: Plugin<"core">, store = memoryStore(), resume = "") {
  const acp = acpAgents([
    {
      id: "fake",
      name: "Fake Agent",
      command: process.execPath,
      env: { ACP_LOG: join(dir, "log"), ASTRA_RESUME: resume },
      behavior: resume === "" ? undefined : antigravityProfile,
      launch: { args: [AGENT] },
    },
    {
      id: "crash",
      name: "Crash Agent",
      command: process.execPath,
      env: {},
      launch: {
        args: ["-e", String.raw`process.stderr.write('no config found\n'); process.exit(3)`],
      },
    },
  ]);

  const models = createModels();
  const jobs: Job[] = [];

  const env: ExecutionEnv = {
    ...chatOnly,
    cwd: dir,
    exec: async (command, options) => {
      const job = pipeJob(
        typeof command === "string" ? ["/bin/sh", "-c", command] : command,
        options?.env ?? {},
        options?.stdio === "protocol",
      );

      jobs.push(job);

      return job;
    },
  };

  const { host } = await composeServer({
    store,
    models,
    plugins: [
      {
        id: "chat-only",
        environment: {
          kind: "chat-only",
          inspect: async () => ({
            identity: env.identity,
            availability: { kind: "available" },
            projectSources: [],
          }),
          attach: async () => env,
        },
      },
      ...acp,
      gate,
    ],
    workspace: { kind: "chat-only", locator: null },
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });

  return {
    host,
    async [Symbol.asyncDispose]() {
      await host.close();
      await Promise.all(jobs.map((job) => job.settled()));
    },
  };
}

async function readLog(): Promise<readonly unknown[]> {
  const text = await readFile(join(dir, "log"), "utf8").catch(() => "");

  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));
}

const refuseDeletes: Plugin<"core"> = {
  id: "refuse-deletes",
  hooks: {
    before_tool: (call) =>
      call.class.kind === "shell" && call.class.command.startsWith("rm ")
        ? { action: "reject", reason: "Deleting is off." }
        : { action: "continue" },
  },
};

it("fails the turn with the agent's last words when it exits before answering", async () => {
  await using opened = await openHost(refuseDeletes);

  const { receipt } = await opened.host.sessions.start({
    content: "Hi.",
    configuration: { model: { provider: "crash", id: "crash" } },
  });

  const end = await receipt.settled();

  assert(end.kind === "failed", JSON.stringify(end));
  expect(end.failure.message).toContain("Crash Agent exited with code 3. (no config found)");
});

it("publishes the agent as a model that queues follow-ups", async () => {
  await using opened = await openHost(refuseDeletes);
  const catalog = await opened.host.models.list();
  const provider = catalog.providers.find((entry) => entry.id === "fake");

  expect(provider?.name).toBe("Fake Agent");
  expect(provider?.agent).toBe(true);
  expect(provider?.models[0]).toEqual(
    expect.objectContaining({
      ref: { provider: "fake", id: "fake" },
      name: "Fake Agent",
      capabilities: { steer: false },
    }),
  );
});

it("runs a turn whose tool calls ask permission through the before_tool gate", async () => {
  await using opened = await openHost(refuseDeletes);

  const { session, receipt } = await opened.host.sessions.start({
    content: "Use tools.",
    configuration: { model: { provider: "fake", id: "fake" } },
  });

  const end = await receipt.settled();

  assert(end.kind === "completed", JSON.stringify(end));
  const view = await session.view();
  const calls = view.messages.flatMap((message) => (isPart(message, tool) ? [message.state] : []));

  expect(calls).toEqual([
    expect.objectContaining({
      name: "acp",
      class: { kind: "shell", command: "ls" },
      phase: "settled",
      outcome: expect.objectContaining({ kind: "ok", content: [{ kind: "text", text: "a.txt" }] }),
    }),
    expect.objectContaining({
      name: "acp",
      class: { kind: "shell", command: "rm -rf build" },
      phase: "settled",
      outcome: { kind: "rejected", reason: "Deleting is off." },
    }),
  ]);

  expect(JSON.stringify(view.messages)).toContain("Done: t1 yes, t2 no.");
  expect(await readLog()).toEqual(
    expect.arrayContaining([
      { permission: "t1", outcome: "yes" },
      { permission: "t2", outcome: "no" },
    ]),
  );
});

it.each([
  ["Please move.", "yes"],
  ["Please move, always.", "cancelled"],
])(
  "asks about %o by the path outside the folder and answers the agent %o",
  async (content, answered) => {
    await using opened = await openHost(approvalsPlugin);
    expect(await opened.host.settings.apply(PERMISSIONS, "auto-edit")).toEqual({
      kind: "applied",
    });

    const { session, receipt } = await opened.host.sessions.start({
      content,
      configuration: { model: { provider: "fake", id: "fake" } },
    });

    const [asked] = await until(async () => {
      const pending = openApprovals(await session.view());

      return pending.length > 0 ? pending : undefined;
    });

    assert(asked !== undefined);
    expect(asked).toMatchObject({
      tool: "move",
      reason: "outside",
      class: { kind: "edit", path: "/etc/notes.txt" },
    });
    await session.part(asked.part).act("once", {});

    expect((await receipt.settled()).kind).toBe("completed");
    expect(openApprovals(await session.view())).toEqual([]);
    expect(await readLog()).toContainEqual({ permission: "m1", outcome: answered });
  },
);

it("stops a run by cancelling the agent's turn", async () => {
  await using opened = await openHost(refuseDeletes);

  const { session, receipt } = await opened.host.sessions.start({
    content: "Please wait.",
    configuration: { model: { provider: "fake", id: "fake" } },
  });

  await until(async () =>
    JSON.stringify((await session.view()).messages).includes("Working.") ? true : undefined,
  );

  const run = await until(async () => {
    const execution = (await session.view()).execution;

    return execution.kind === "live" ? execution.run.id : undefined;
  });

  expect(await session.run(run).stop()).toEqual({ kind: "requested" });
  expect(await receipt.settled()).toEqual({ kind: "stopped" });
  expect(
    await until(async () => {
      const log = await readLog();

      return log.some(
        (entry) => JSON.stringify(entry) === JSON.stringify({ method: "session/cancel" }),
      )
        ? log
        : undefined;
    }),
  ).toContainEqual({ method: "session/cancel" });
});

const main = asId<"head">("main");

const fake = { model: { provider: "fake", id: "fake" } } as const;

it.each([
  { id: "E1", content: "Fake Agent continued on its own.", next: null, expected: "literal" },
  { id: "E2", content: "repeat1", next: "repeat2", expected: "reused-call" },
  { id: "E3", content: "parallel", next: null, expected: "parallel" },
  { id: "E4", content: "incomplete", next: null, expected: "incomplete" },
  { id: "E5", content: "late", next: "next", expected: "late" },
  { id: "E6", content: "first", next: null, expected: "heads" },
  { id: "E8", content: "expired", next: null, expected: "auth" },
  { id: "E9", content: "child-first", next: null, expected: "child-first" },
  { id: "E10", content: "child-fail", next: null, expected: "child-fail" },
  { id: "E11", content: "idle-ask", next: "second", expected: "idle-ask" },
])("$id protects $expected", async (row) => {
  await using opened = await openHost(refuseDeletes);

  const { session, receipt } = await opened.host.sessions.start({
    content: row.content,
    configuration: fake,
  });

  const end = await receipt.settled();

  if (row.expected === "auth") {
    assert(end.kind === "failed");
    expect(end.failure.message).toMatch(/sign in/iu);

    return;
  }

  expect(end.kind).toBe("completed");

  if (row.expected === "late" || row.expected === "idle-ask") {
    await until(async () =>
      JSON.stringify(await readLog()).includes('"barrier"') ? true : undefined,
    );
  }

  if (row.next !== null) {
    expect((await (await session.head(main).send(row.next)).settled()).kind).toBe("completed");
  }
  const view = await session.view();
  const calls = view.messages.flatMap((message) => (isPart(message, tool) ? [message.state] : []));
  const log = await readLog();

  switch (row.expected) {
    case "literal":
      expect(
        log.filter((entry) =>
          JSON.stringify(entry).includes('"prompt":"Fake Agent continued on its own."'),
        ),
      ).toHaveLength(1);
      break;
    case "reused-call":
      expect(calls).toHaveLength(2);
      expect(JSON.stringify(calls)).toContain("repeat1");
      expect(JSON.stringify(calls)).toContain("repeat2");
      break;
    case "parallel":
      expect(JSON.stringify(calls)).toContain("final-a");
      expect(JSON.stringify(calls)).toContain("final-b");
      break;
    case "incomplete":
      expect(calls[0]?.phase === "settled" ? calls[0].outcome.kind : undefined).not.toBe("ok");
      expect(JSON.stringify(calls)).toContain("did not report a result");
      break;
    case "late":
      expect(JSON.stringify(view.messages)).not.toContain("LATE-OLD");
      break;
    case "heads": {
      const side = asId<"head">("side");
      await session.heads.create(side);
      expect((await (await session.head(side).send("side")).settled()).kind).toBe("completed");

      const prompts = (await readLog()).flatMap((entry) =>
        typeof entry === "object" && entry !== null && "prompt" in entry && "pid" in entry
          ? [entry.pid]
          : [],
      );

      expect(new Set(prompts).size).toBe(2);
      break;
    }

    case "child-first":
      expect(JSON.stringify(calls)).toContain("RESULT-EARLY");
      break;
    case "child-fail":
      expect(calls[0]?.phase === "settled" ? calls[0].outcome.kind : undefined).not.toBe("ok");
      expect(calls).toHaveLength(1);
      break;
    case "idle-ask":
      expect(log).toContainEqual({ permission: "orphan", outcome: "cancelled" });
      break;
  }
});

it("delivers two replies on agent-owned runs without a user wake", async () => {
  const mode = "detach";
  await using opened = await openHost(approvalsPlugin, memoryStore(), mode);

  const { session, receipt } = await opened.host.sessions.start({
    content: mode === "detach" ? "detach" : "first",
    configuration: fake,
  });

  expect((await receipt.settled()).kind).toBe("completed");
  await until(async () =>
    JSON.stringify((await session.view()).messages).includes("REPORT-TWO") ? true : undefined,
  );
  const view = await session.view();
  expect(view.messages.filter((message) => message.kind === "user")).toHaveLength(1);
  expect(JSON.stringify(view.messages).match(/REPORT-ONE/gu)).toHaveLength(1);
  expect(JSON.stringify(view.messages).match(/REPORT-TWO/gu)).toHaveLength(1);
  const methods = (await readLog()).filter((entry) => JSON.stringify(entry).includes('"prompt":'));
  expect(methods).toHaveLength(1);
});

it.each(["E12", "E13", "E14"] as const)(
  "%s fences setup, policy and auxiliary ownership",
  async (row) => {
    if (row === "E12") {
      const store = memoryStore();
      const first = await openHost(approvalsPlugin, store, "report");

      const { session, receipt } = await first.host.sessions.start({
        content: "first",
        configuration: fake,
      });

      expect((await receipt.settled()).kind).toBe("completed");
      await first[Symbol.asyncDispose]();
      await using second = await openHost(approvalsPlugin, store, "report");
      const restored = second.host.session(session.id);
      expect((await (await restored.head(main).send("next")).settled()).kind).toBe("completed");
      expect(JSON.stringify((await restored.view()).messages)).toContain("PRE-REGISTER-REPORT");
      const log = await readLog();
      expect(log.filter((entry) => JSON.stringify(entry).includes('"prompt":"next"'))).toHaveLength(
        1,
      );
      expect(log).toContainEqual({ method: "session/resume" });

      return;
    }

    if (row === "E13") {
      await using opened = await openHost(approvalsPlugin);

      const { receipt } = await opened.host.sessions.start({
        content: "block-policy",
        configuration: fake,
      });

      await until(async () =>
        JSON.stringify(await readLog()).includes('"gate":"policy"') ? true : undefined,
      );
      expect(await opened.host.settings.apply(PERMISSIONS, "ask")).toEqual({ kind: "applied" });
      await writeFile(join(dir, "release"), "go");
      expect((await receipt.settled()).kind).not.toBe("completed");
      expect(
        (await readLog()).some(
          (entry) => typeof entry === "object" && entry !== null && "acted" in entry,
        ),
      ).toBe(false);

      return;
    }

    const bound = Promise.withResolvers<PluginApi<"core">>();

    await using opened = await openHost({
      id: "bound",
      activate(api) {
        bound.resolve(api);

        return {};
      },
    });

    const { session, receipt } = await opened.host.sessions.start({
      content: "wait",
      configuration: fake,
    });

    await until(async () =>
      JSON.stringify((await session.view()).messages).includes("Working.") ? true : undefined,
    );

    const auxiliary = await (
      await bound.promise
    ).request({
      model: { provider: "crash", id: "crash" },
      messages: [{ role: "user", content: "title", timestamp: 0 }],
    });

    expect(auxiliary.kind).toBe("failed");
    const execution = (await session.view()).execution;
    assert(execution.kind === "live");
    await session.run(execution.run.id).stop();
    expect((await receipt.settled()).kind).toBe("stopped");
  },
);
