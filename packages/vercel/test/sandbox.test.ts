import assert from "node:assert/strict";
import { scheduler } from "node:timers/promises";
import type { ExecutionEnv, Workspace } from "@nyte-ai/core/plugins";
import { test, vi } from "vitest";
import {
  vercelSandboxPlugin,
  type VercelSandbox,
  type VercelSandboxCommand,
} from "../src/sandbox.ts";

interface Log {
  readonly stream: "stdout" | "stderr";
  readonly data: string;
}

type RunParams = Parameters<VercelSandbox["runCommand"]>[0];

const WORKSPACE: Workspace = {
  kind: "vercel-sandbox",
  id: "0b6f2c0e-4f4b-4d8e-9a57-5d1f7c3e2a10",
  cwd: "/vercel/sandbox",
  locator: { name: "box" },
};

/** A command the test drives: it writes logs and exits when told, and records kills. */
function fakeCommand() {
  const pending: Log[] = [];
  const exit = Promise.withResolvers<{ exitCode: number }>();
  const kills: (string | undefined)[] = [];
  let exited = false;
  let wake = () => {};

  const command: VercelSandboxCommand = {
    async *logs() {
      while (true) {
        const log = pending.shift();

        if (log !== undefined) yield log;
        else if (exited) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
    wait: () => exit.promise,
    kill: async (signal) => {
      kills.push(signal);
    },
  };

  return {
    command,
    kills,
    write: (log: Log) => {
      pending.push(log);
      wake();
    },
    exit: (exitCode: number) => {
      exited = true;
      exit.resolve({ exitCode });
      wake();
    },
  };
}

type FakeCommand = ReturnType<typeof fakeCommand>;

function finished(exitCode: number, logs: readonly Log[] = []): FakeCommand {
  const command = fakeCommand();

  for (const log of logs) command.write(log);
  command.exit(exitCode);

  return command;
}

function fakeSandbox(start: (params: RunParams) => FakeCommand | Promise<FakeCommand>) {
  const runs: RunParams[] = [];

  const sandbox: VercelSandbox = {
    fs: { mkdir: () => Promise.resolve(undefined) },
    readFileToBuffer: () => Promise.resolve(null),
    writeFiles: () => Promise.resolve(undefined),
    runCommand: async (params) => {
      runs.push(params);

      return (await start(params)).command;
    },
  };

  return { sandbox, runs };
}

async function open(sandbox: VercelSandbox): Promise<ExecutionEnv> {
  const provider = vercelSandboxPlugin({ connect: () => Promise.resolve(sandbox) }).environment;

  return provider.open(WORKSPACE);
}

test("opens under the workspace id and resolves POSIX paths against its cwd", async () => {
  const { sandbox } = fakeSandbox(() => finished(0));
  const provider = vercelSandboxPlugin({ connect: () => Promise.resolve(sandbox) }).environment;

  assert.equal(provider.kind, "vercel-sandbox");
  const env = await provider.open(WORKSPACE);

  assert.equal(env.id, WORKSPACE.id);
  assert.equal(env.cwd, WORKSPACE.cwd);
  assert.equal(env.resolve("src/../a.ts"), "/vercel/sandbox/a.ts");
  assert.equal(env.resolve("/etc", "hosts"), "/etc/hosts");
});

test("open connects nothing; each operation connects, and a failed connect fails it", async () => {
  const { sandbox } = fakeSandbox(() => finished(0));
  const connected: Workspace[] = [];

  const provider = vercelSandboxPlugin({
    connect: (workspace) => {
      connected.push(workspace);

      return Promise.resolve({ ...sandbox, readFileToBuffer: async () => Buffer.from("hi") });
    },
  }).environment;

  const env = await provider.open(WORKSPACE);

  assert.deepEqual(connected, []);
  assert.equal((await env.readFile("a.ts")).toString("utf-8"), "hi");
  assert.deepEqual(connected, [WORKSPACE]);
  await assert.rejects(provider.open({ ...WORKSPACE, cwd: "work" }), /not absolute/);

  const lost = new Error("Sandbox not found");
  const failing = vercelSandboxPlugin({ connect: () => Promise.reject(lost) }).environment;

  const unreachable = await failing.open(WORKSPACE);

  await assert.rejects(unreachable.readFile("a.ts"), (error) => error === lost);
  await assert.rejects(unreachable.exec("true", { onData: () => {} }), (error) => error === lost);
});

test("exec streams stdout and stderr as they arrive and resolves the exit code", async () => {
  const command = fakeCommand();
  const { sandbox, runs } = fakeSandbox(() => command);
  const env = await open(sandbox);
  const chunks: string[] = [];
  const running = env.exec("make", { onData: (data) => chunks.push(data.toString("utf-8")) });

  command.write({ stream: "stdout", data: "out\n" });
  await vi.waitFor(() => assert.deepEqual(chunks, ["out\n"]));
  command.write({ stream: "stderr", data: "err\n" });
  command.exit(3);

  assert.deepEqual(await running, { exitCode: 3 });
  assert.deepEqual(chunks, ["out\n", "err\n"]);
  assert.deepEqual(
    runs.map(({ cmd, args, cwd }) => ({ cmd, args, cwd })),
    [{ cmd: "/bin/bash", args: ["-lc", "make"], cwd: "/vercel/sandbox" }],
  );
});

test("a 137 after the deadline is a timeout; an exit before it keeps its code", async () => {
  const slow = fakeSandbox(async () => {
    await scheduler.wait(20);

    return finished(137);
  });

  await assert.rejects(
    (await open(slow.sandbox)).exec("sleep 60", { onData: () => {}, timeout: 0.01 }),
    { name: "ToolError", reason: { kind: "timeout" } },
  );
  assert.equal(slow.runs[0]?.timeoutMs, 10);

  const killed = await open(fakeSandbox(() => finished(137)).sandbox);

  assert.deepEqual(await killed.exec("kill -9 $$", { onData: () => {}, timeout: 60 }), {
    exitCode: 137,
  });
});

test("an abort while the command starts kills it, waits for its exit, then rejects", async () => {
  const command = fakeCommand();
  const started = Promise.withResolvers<void>();

  const { sandbox, runs } = fakeSandbox(async () => {
    await started.promise;

    return command;
  });

  const env = await open(sandbox);
  const controller = new AbortController();
  let settled = false;

  const running = env
    .exec("sleep 60", { onData: () => {}, signal: controller.signal })
    .finally(() => (settled = true));

  await vi.waitFor(() => assert.equal(runs.length, 1));
  controller.abort();
  started.resolve();
  await vi.waitFor(() => assert.deepEqual(command.kills, ["SIGKILL"]));
  assert.equal(settled, false);
  command.exit(137);

  await assert.rejects(running, { name: "ToolError", reason: { kind: "interrupted" } });
});

test("an abort while connecting starts no command", async () => {
  const { sandbox, runs } = fakeSandbox(() => finished(0));
  const connecting = Promise.withResolvers<VercelSandbox>();
  const plugin = vercelSandboxPlugin({ connect: () => connecting.promise });
  const env = await plugin.environment.open(WORKSPACE);
  const controller = new AbortController();
  const running = env.exec("sleep 60", { onData: () => {}, signal: controller.signal });

  controller.abort();
  connecting.resolve(sandbox);

  await assert.rejects(running, { name: "ToolError", reason: { kind: "interrupted" } });
  assert.deepEqual(runs, []);
});

test("an abort while the command runs kills it and forwards output until it exits", async () => {
  const command = fakeCommand();
  const { sandbox } = fakeSandbox(() => command);
  const env = await open(sandbox);
  const controller = new AbortController();
  const chunks: string[] = [];
  let settled = false;

  const running = env
    .exec("sleep 60", {
      onData: (data) => chunks.push(data.toString("utf-8")),
      signal: controller.signal,
    })
    .finally(() => (settled = true));

  command.write({ stream: "stdout", data: "tick\n" });
  await vi.waitFor(() => assert.deepEqual(chunks, ["tick\n"]));
  controller.abort();
  await vi.waitFor(() => assert.deepEqual(command.kills, ["SIGKILL"]));
  command.write({ stream: "stderr", data: "Killed\n" });
  await vi.waitFor(() => assert.deepEqual(chunks, ["tick\n", "Killed\n"]));
  assert.equal(settled, false);
  command.exit(137);

  await assert.rejects(running, { name: "ToolError", reason: { kind: "interrupted" } });
});

test("readdir splits NUL-delimited names, keeping a newline inside one", async () => {
  const { sandbox, runs } = fakeSandbox(() =>
    finished(0, [
      { stream: "stdout", data: "a.ts\0line\nbr" },
      { stream: "stdout", data: "eak\0.hidden\0" },
    ]),
  );

  const env = await open(sandbox);

  assert.deepEqual(await env.readdir("src"), ["a.ts", "line\nbreak", ".hidden"]);
  assert.equal(runs[0]?.args.at(-1), "/vercel/sandbox/src");
});

test("stat reports each kind, nothing for a missing path, and fails on a shell error", async () => {
  const replies = [
    finished(0, [{ stream: "stdout", data: "file\n" }]),
    finished(0, [{ stream: "stdout", data: "directory\n" }]),
    finished(0, [{ stream: "stdout", data: "other\n" }]),
    finished(0),
    finished(2, [{ stream: "stderr", data: "sh: permission denied\n" }]),
  ];

  const env = await open(fakeSandbox(() => replies.shift() ?? finished(0)).sandbox);

  assert.deepEqual(await env.stat("a.ts"), { kind: "file" });
  assert.deepEqual(await env.stat("src"), { kind: "directory" });
  assert.deepEqual(await env.stat("fifo"), { kind: "other" });
  assert.equal(await env.stat("missing"), undefined);
  await assert.rejects(env.stat("locked"), /permission denied/);
});

test("realpath returns the resolved path, and nothing for a missing one", async () => {
  const replies = [
    finished(0, [{ stream: "stdout", data: "/vercel/sandbox/real\n" }]),
    finished(0),
  ];

  const env = await open(fakeSandbox(() => replies.shift() ?? finished(0)).sandbox);

  assert.equal(await env.realpath("link"), "/vercel/sandbox/real");
  assert.equal(await env.realpath("missing"), undefined);
});
