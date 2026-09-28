import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getEventListeners, once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalShell, type ShellExecution, type ShellProcess } from "./local-shell.ts";

function quote(value: string) {
  return process.platform === "win32" ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
}

function logPath(output: string) {
  return /^\[Output truncated\. Full output: (.+)\]\n/u.exec(output)?.[1];
}

describe("local shell", () => {
  let cwd = "";
  const executions: ShellProcess[] = [];
  const servers: Server[] = [];
  const sockets: Socket[] = [];

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "nyte-shell-test-"));
  });

  afterEach(async () => {
    for (const execution of executions) execution.cancel();
    for (const execution of executions) {
      const result = await execution.done;
      const path = logPath(result.output);
      if (path) await rm(path, { force: true });
    }
    for (const socket of sockets) socket.destroy();
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    executions.length = 0;
    servers.length = 0;
    sockets.length = 0;
    await rm(cwd, { recursive: true, force: true });
  });

  function start(
    command: string,
    options: {
      onUpdate?: (snapshot: ShellExecution) => void;
      signal?: AbortSignal;
      cwd?: string;
    } = {},
  ) {
    const execution = startLocalShell({
      command,
      cwd: options.cwd ?? cwd,
      onUpdate: options.onUpdate ?? (() => {}),
      signal: options.signal ?? AbortSignal.timeout(5000),
    });
    executions.push(execution);
    return execution;
  }

  async function script(source: string) {
    await writeFile(join(cwd, "command.mjs"), source);
    return `${quote(process.execPath)} command.mjs`;
  }

  async function connection() {
    const connected = Promise.withResolvers<Socket>();
    const server = createServer((socket) => {
      sockets.push(socket);
      connected.resolve(socket);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    return { port: address.port, socket: connected.promise };
  }

  test("returns ownership synchronously and combines separately decoded streams with native exit 7", async () => {
    const peer = await connection();
    const command = await script(`
      import { connect } from "node:net";
      const socket = connect(${peer.port}, "127.0.0.1");
      socket.once("connect", () => {
        process.stdout.write("stdout first\\n");
        process.stdout.write(Buffer.from([0xf0, 0x9f]));
        process.stderr.write("stderr first 🚀\\n");
      });
      socket.once("data", () => {
        process.stdout.write(Buffer.from([0x98, 0x80]));
        process.stdout.write(" stdout last\\n");
        process.stderr.write("stderr last\\n");
        socket.end();
        process.exitCode = 7;
      });
    `);
    const before = Date.now();
    const updates: ShellExecution[] = [];
    const ready = Promise.withResolvers<void>();
    const execution = start(command, {
      onUpdate: (snapshot) => {
        updates.push(snapshot);
        if (snapshot.output.includes("stderr first 🚀")) ready.resolve();
      },
    });
    expect(execution.snapshot.state).toBe("running");
    expect(execution.snapshot.kind).toBe("shell");
    expect(execution.snapshot.command).toBe(command);
    expect(execution.snapshot.id).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
    expect(execution.snapshot.startedAt).toBeGreaterThanOrEqual(before);
    expect(execution.snapshot.startedAt).toBeLessThanOrEqual(Date.now());
    expect(updates).toHaveLength(0);
    const socket = await peer.socket;
    await ready.promise;
    socket.write("continue");
    const result = await execution.done;
    expect(result.state).toBe("exited");
    if (result.state !== "exited") throw new Error(`Unexpected ${result.state}`);
    expect(result.exitCode).toBe(7);
    expect(result.finishedAt).toBeGreaterThanOrEqual(result.startedAt);
    expect(result.startedAt).toBe(execution.snapshot.startedAt);
    expect(result.output).toContain("stdout first\n");
    expect(result.output).toContain("😀 stdout last\n");
    expect(result.output).toContain("stderr first 🚀\n");
    expect(result.output).toContain("stderr last\n");
    expect(result.output).not.toContain("�");
    expect(result.output.indexOf("stdout first")).toBeLessThan(
      result.output.indexOf("stdout last"),
    );
    expect(result.output.indexOf("stderr first")).toBeLessThan(
      result.output.indexOf("stderr last"),
    );
    expect(updates.at(-1)).toBe(result);
    expect(execution.snapshot).toBe(result);
    execution.cancel();
    expect(execution.snapshot).toBe(result);
  });

  test("passes cwd to the OS without changing global cwd and uses shell syntax", async () => {
    const original = process.cwd();
    const directory = join(cwd, "directory ' with spaces & symbols");
    await mkdir(directory);
    const command =
      process.platform === "win32"
        ? "echo first> value.txt && type value.txt"
        : "printf '%s' first > value.txt && cat < value.txt";
    const result = await start(command, { cwd: directory }).done;
    expect(result.state).toBe("exited");
    expect(result.output.trim()).toBe("first");
    expect((await readFile(join(directory, "value.txt"), "utf8")).trim()).toBe("first");
    expect(process.cwd()).toBe(original);
    const nativeCwd = await start(await script("process.stdout.write(process.cwd());")).done;
    expect(nativeCwd.output).toBe(await realpath(cwd));
  });

  test("cancellation kills an owned child, closes inherited stdio, and settles once", async () => {
    const peer = await connection();
    await writeFile(
      join(cwd, "child.mjs"),
      `
      import { connect } from "node:net";
      process.on("SIGTERM", () => {});
      const socket = connect(${peer.port}, "127.0.0.1");
      socket.once("connect", () => process.stdout.write("child ready\\n"));
      setInterval(() => {}, 60_000);
    `,
    );
    const command = await script(`
      import { spawn } from "node:child_process";
      spawn(process.execPath, ["child.mjs"], { stdio: "inherit" });
    `);
    const abort = new AbortController();
    const ready = Promise.withResolvers<void>();
    const updates: ShellExecution[] = [];
    const execution = start(command, {
      signal: abort.signal,
      onUpdate: (snapshot) => {
        updates.push(snapshot);
        if (snapshot.output.includes("child ready")) ready.resolve();
      },
    });
    const socket = await peer.socket;
    const closed = once(socket, "close");
    await ready.promise;
    abort.abort();
    execution.cancel();
    execution.cancel();
    const result = await execution.done;
    await closed;
    expect(result.state).toBe("cancelled");
    expect(result.output).toContain("child ready");
    expect(socket.destroyed).toBe(true);
    expect(updates.filter((snapshot) => snapshot.state !== "running")).toEqual([result]);
    expect(updates.at(-1)).toBe(result);
    execution.cancel();
    expect(execution.snapshot).toBe(result);
  });

  test.skipIf(process.platform === "win32")(
    "cleans up descendants even when the shell exits first",
    async () => {
      const peer = await connection();
      await writeFile(
        join(cwd, "child.mjs"),
        `
      import { connect } from "node:net";
      const socket = connect(${peer.port}, "127.0.0.1");
      socket.once("connect", () => process.send("ready"));
      setInterval(() => {}, 60_000);
    `,
      );
      const command = await script(`
      import { spawn } from "node:child_process";
      const child = spawn(process.execPath, ["child.mjs"], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      child.once("message", () => process.exit(3));
    `);
      const execution = start(command);
      const socket = await peer.socket;
      const closed = once(socket, "close");
      const result = await execution.done;
      await closed;
      expect(result.state).toBe("exited");
      if (result.state !== "exited") throw new Error(`Unexpected ${result.state}`);
      expect(result.exitCode).toBe(3);
      expect(socket.destroyed).toBe(true);
    },
  );

  test("bounds noisy Unicode output, throttles updates, and flushes the complete overflow log", async () => {
    const peer = await connection();
    const line = "0123456789😀雪\n";
    const count = 80_000;
    const checkpoints = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
    const command = await script(`
      import { writeSync } from "node:fs";
      import { connect } from "node:net";
      const socket = connect(${peer.port}, "127.0.0.1");
      const line = ${JSON.stringify(line)};
      let batch = 0;
      function writeBatch() {
        if (batch === ${checkpoints.length}) {
          writeSync(1, "last line\\n");
          socket.end();
          return;
        }
        for (let index = 0; index < ${count}; index++) writeSync(1, line);
        writeSync(1, "checkpoint " + batch++ + "\\n");
      }
      socket.once("connect", () => {
        writeSync(1, "first line\\n");
        writeBatch();
      });
      socket.on("data", writeBatch);
    `);
    const updates: { snapshot: ShellExecution; at: number }[] = [];
    const execution = start(command, {
      onUpdate: (snapshot) => {
        updates.push({ snapshot, at: performance.now() });
        for (const [index, checkpoint] of checkpoints.entries()) {
          if (snapshot.output.includes(`checkpoint ${index}\n`)) checkpoint.resolve();
        }
      },
    });
    const socket = await peer.socket;
    for (const checkpoint of checkpoints) {
      await checkpoint.promise;
      socket.write("next");
    }
    const result = await execution.done;
    expect(result.state).toBe("exited");
    expect(result.output).toContain("Output truncated");
    expect(result.output.endsWith("last line\n")).toBe(true);
    expect(result.output).not.toContain("�");
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(50 * 1024);
    const path = logPath(result.output);
    if (!path) throw new Error("Expected full-output log path");
    const fullOutput =
      "first line\n" +
      checkpoints.map((_, index) => line.repeat(count) + `checkpoint ${index}\n`).join("") +
      "last line\n";
    expect(await readFile(path, "utf8")).toBe(fullOutput);
    const running = updates.filter((update) => update.snapshot.state === "running");
    expect(running.length).toBeGreaterThanOrEqual(checkpoints.length);
    for (const [index, update] of running.entries()) {
      expect(Buffer.byteLength(update.snapshot.output)).toBeLessThanOrEqual(50 * 1024);
      const previous = running[index - 1];
      if (previous) expect(update.at - previous.at).toBeGreaterThanOrEqual(80);
    }
    expect(updates.at(-1)?.snapshot).toBe(result);
    expect(execution.snapshot).toBe(result);
  });

  test("pre-aborted signals do not execute the command or notify synchronously", async () => {
    const command = await script(`
      import { writeFileSync } from "node:fs";
      writeFileSync("should-not-exist", "executed");
    `);
    const updates: ShellExecution[] = [];
    const execution = start(command, {
      signal: AbortSignal.abort(),
      onUpdate: (snapshot) => updates.push(snapshot),
    });
    expect(updates).toHaveLength(0);
    const result = await execution.done;
    expect(result.state).toBe("cancelled");
    expect(result.output).toBe("");
    expect(existsSync(join(cwd, "should-not-exist"))).toBe(false);
    expect(updates).toEqual([result]);
  });

  test("immediate cancellation does not launch a process", async () => {
    const command = await script(`
      import { writeFileSync } from "node:fs";
      writeFileSync("should-not-exist", "executed");
    `);
    const execution = start(command);
    execution.cancel();
    execution.cancel();
    expect((await execution.done).state).toBe("cancelled");
    expect(existsSync(join(cwd, "should-not-exist"))).toBe(false);
  });

  test("launch failure resolves with a failed terminal snapshot", async () => {
    const updates: ShellExecution[] = [];
    const execution = start("echo unreachable", {
      cwd: join(cwd, "missing"),
      onUpdate: (snapshot) => updates.push(snapshot),
    });
    expect(updates).toHaveLength(0);
    const result = await execution.done;
    expect(result.state).toBe("failed");
    if (result.state !== "failed") throw new Error(`Unexpected ${result.state}`);
    expect(result.message.length).toBeGreaterThan(0);
    expect(updates).toEqual([result]);
  });

  test.skipIf(process.platform === "win32")(
    "reports native signals rather than guessing from output or exit codes",
    async () => {
      const command = await script(`process.kill(process.pid, "SIGTERM");`);
      const result = await start(`exec ${command}`).done;
      expect(result.state).toBe("signalled");
      if (result.state !== "signalled") throw new Error(`Unexpected ${result.state}`);
      expect(result.signal).toBe("SIGTERM");
      const exited = await start("printf 'Terminated\\n'; exit 143").done;
      expect(exited.state).toBe("exited");
      if (exited.state !== "exited") throw new Error(`Unexpected ${exited.state}`);
      expect(exited.exitCode).toBe(143);
    },
  );

  test("stdin is closed and small output does not create an overflow log", async () => {
    const abort = new AbortController();
    const command = await script(`
      process.stdin.resume();
      process.stdin.once("end", () => process.stdout.write("stdin closed\\n"));
    `);
    const listeners = getEventListeners(abort.signal, "abort").length;
    const execution = start(command, { signal: abort.signal });
    const result = await execution.done;
    expect(result.state).toBe("exited");
    expect(result.output).toBe("stdin closed\n");
    expect(logPath(result.output)).toBeUndefined();
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(listeners);
    abort.abort();
    expect(execution.snapshot).toBe(result);
  });
});
