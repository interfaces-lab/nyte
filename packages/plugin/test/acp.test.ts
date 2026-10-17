import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { acpAgents } from "../src/acp/index.ts";
import { installedAgents, registryEntries } from "../src/acp/registry.ts";
import { env as chatOnly, until } from "./fake-models.ts";

const AGENT = fileURLToPath(new URL("./fixtures/acp-agent.mjs", import.meta.url));

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nyte-acp-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A piped process as the local provider runs one: stdout and stderr interleaved, stdin fed by `write`. */
function pipeJob(command: readonly string[], extra: Readonly<Record<string, string>>): Job {
  const [file = "", ...args] = command;
  const child = spawn(file, args, { cwd: dir, env: { ...process.env, ...extra }, stdio: "pipe" });
  const frames: OutputFrame[] = [];
  let wake: (() => void) | undefined;

  const push = (frame: OutputFrame) => {
    frames.push(frame);
    wake?.();
  };

  child.stdout.on("data", (chunk: Buffer) => push({ kind: "bytes", data: new Uint8Array(chunk) }));
  child.stderr.on("data", (chunk: Buffer) => push({ kind: "bytes", data: new Uint8Array(chunk) }));

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
  const acp = acpAgents({
    agents: async () => [
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
    ],
  });

  const models = createModels();
  models.setProvider(acp.provider);
  await models.refresh({ providers: ["acp"], allowNetwork: false });
  const jobs: Job[] = [];

  const env: ExecutionEnv = {
    ...chatOnly,
    cwd: dir,
    exec: async (command, options) => {
      const job = pipeJob(
        typeof command === "string" ? ["/bin/sh", "-c", command] : command,
        options?.env ?? {},
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
      acp.plugin,
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
    configuration: { model: { provider: "acp", id: "crash" } },
  });

  const end = await receipt.settled();

  assert(end.kind === "failed", JSON.stringify(end));
  expect(end.failure.message).toContain("Crash Agent exited. (no config found)");
});

it("publishes the agent as a model that queues follow-ups and owns its permissions", async () => {
  await using opened = await openHost(refuseDeletes);
  const catalog = await opened.host.models.list();
  const provider = catalog.providers.find((entry) => entry.id === "acp");

  expect(provider?.name).toBe("ACP agents");
  expect(provider?.models[0]).toEqual(
    expect.objectContaining({
      ref: { provider: "acp", id: "fake" },
      name: "Fake Agent",
      capabilities: { steer: false, stopSubagent: false, ownPermissions: true },
    }),
  );
});

it("runs a turn whose tool calls ask permission through the before_tool gate", async () => {
  await using opened = await openHost(refuseDeletes);

  const { session, receipt } = await opened.host.sessions.start({
    content: "Use tools.",
    configuration: { model: { provider: "acp", id: "fake" } },
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

it("stops a run by cancelling the agent's turn", async () => {
  await using opened = await openHost(refuseDeletes);

  const { session, receipt } = await opened.host.sessions.start({
    content: "Please wait.",
    configuration: { model: { provider: "acp", id: "fake" } },
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

it("offers only the registry agents installed on this machine", async () => {
  const bin = join(dir, "prefix", "bin");
  const gemini = join(dir, "prefix", "lib", "node_modules", "@google", "gemini-cli");
  await mkdir(bin, { recursive: true });
  await mkdir(gemini, { recursive: true });
  await writeFile(join(gemini, "package.json"), JSON.stringify({ bin: { gemini: "index.js" } }));

  for (const name of ["npx", "gemini", "goose"])
    await writeFile(join(bin, name), "#!/bin/sh\n", { mode: 0o755 });

  const target = `${process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;

  const entries = registryEntries({
    agents: [
      {
        id: "gemini",
        name: "Gemini CLI",
        distribution: { npx: { package: "@google/gemini-cli@0.64.0", args: ["--acp"] } },
      },
      {
        id: "goose",
        name: "goose",
        distribution: {
          binary: {
            [target]: { archive: "https://example.test/goose.tgz", cmd: "./goose", args: ["acp"] },
          },
        },
      },
      {
        id: "copilot",
        name: "Copilot",
        distribution: { npx: { package: "@github/copilot@1.0.98", args: ["--acp"] } },
      },
      { id: "broken", distribution: {} },
    ],
  });

  expect(await installedAgents(entries, bin)).toEqual([
    { id: "gemini", name: "Gemini CLI", command: join(bin, "gemini"), args: ["--acp"], env: {} },
    { id: "goose", name: "goose", command: join(bin, "goose"), args: ["acp"], env: {} },
  ]);
});
