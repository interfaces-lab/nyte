import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModels } from "@nyte-ai/ai/models";
import { isPart, tool } from "@nyte-ai/core";
import type { ExecutionEnv, Job, Plugin } from "@nyte-ai/core";
import { memoryStore } from "@nyte-ai/core/store";
import { composeServer } from "@nyte-ai/core/testing";
import { asId } from "@nyte-ai/schema";
import type { JobEnd, OutputFrame } from "@nyte-ai/schema";
import { afterEach, assert, beforeEach, expect, it } from "vitest";
import approvalsPlugin from "../src/approvals/approvals.ts";
import { openApprovals, PERMISSIONS } from "../src/approvals/schema.ts";
import { acpAgents } from "../src/acp/index.ts";
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

async function openHost(gate: Plugin<"core">) {
  const acp = acpAgents([
    {
      id: "fake",
      name: "Fake Agent",
      command: process.execPath,
      args: [AGENT],
      env: { ACP_LOG: join(dir, "log") },
    },
    {
      id: "crash",
      name: "Crash Agent",
      command: process.execPath,
      args: ["-e", "process.stderr.write('no config found\\n'); process.exit(3)"],
      env: {},
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
    store: memoryStore(),
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
  expect(end.failure.message).toContain("Crash Agent exited. (no config found)");
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
