import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutputFrame } from "@nyte-ai/schema";
import type { Job } from "@nyte-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { localExec } from "../src/index.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-exec-")));
  folders.push(made);

  return made;
}

const decoder = new TextDecoder();

async function read(
  job: Job,
): Promise<{ readonly text: string; readonly frames: readonly OutputFrame[] }> {
  const frames: OutputFrame[] = [];

  for await (const frame of job.output()) frames.push(frame);

  return {
    text: frames
      .map((frame) => (frame.kind === "bytes" ? decoder.decode(frame.data) : ""))
      .join(""),
    frames,
  };
}

const ptyLoads =
  process.platform !== "win32" &&
  (await localExec(tmpdir())("true", { pty: { columns: 80, rows: 24 } }).then(
    async (job) => (await job.settled()).kind === "exited",
    () => false,
  ));

describe("localExec over pipes", () => {
  it("runs a string through the shell in the root, interleaving stdout and stderr, then exit", async () => {
    const root = await folder();
    const job = await localExec(root)("pwd; echo out; echo err 1>&2; exit 3");
    const { text, frames } = await read(job);

    expect(text).toBe(`${root}\nout\nerr\n`);
    expect(frames.at(-1)).toEqual({ kind: "exit", code: 3 });
    expect(await job.settled()).toEqual({ kind: "exited", code: 3, reason: "exited" });
    expect(job.key).toBeNull();
    expect(await job.idle()).toBe(false);
    expect(await job.resize({ columns: 80, rows: 24 })).toEqual({ kind: "not-pty" });
  });

  it("runs an argv directly in a cwd under the root with env laid over", async () => {
    const root = await folder();
    const exec = localExec(root);
    await (await exec(["mkdir", "sub"])).settled();

    const job = await exec(["sh", "-c", 'printf "%s %s" "$PWD" "$NYTE_TEST"'], {
      cwd: "sub",
      env: { NYTE_TEST: "yes" },
    });

    expect((await read(job)).text).toBe(`${join(root, "sub")} yes`);
    await expect(exec(["definitely-not-a-program-nyte"])).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(exec([])).rejects.toMatchObject({ code: "invalid" });
  });

  it("feeds stdin through write", async () => {
    const job = await localExec(await folder())(["head", "-n", "1"]);
    await job.write(new TextEncoder().encode("typed line\nrest\n"));

    expect((await read(job)).text).toBe("typed line\n");
  });

  it("stops with SIGTERM to the process group, SIGKILL after the grace, and reports terminated", async () => {
    const exec = localExec(await folder());
    const job = await exec("sleep 30 & sleep 30; wait");
    const started = Date.now();

    expect(await job.stop()).toEqual({
      kind: "settled",
      outcome: { kind: "exited", code: null, reason: "terminated" },
    });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(await job.stop()).toMatchObject({ kind: "settled" });

    const stubborn = await exec(["sh", "-c", "trap '' TERM; echo ready; sleep 30"]);
    const reader = stubborn.output()[Symbol.asyncIterator]();
    await reader.next();
    const before = Date.now();

    expect(await stubborn.stop()).toMatchObject({
      kind: "settled",
      outcome: { reason: "terminated" },
    });
    expect(Date.now() - before).toBeGreaterThanOrEqual(1_900);
  }, 10_000);

  it("stops when the call's signal aborts, and refuses an aborted signal", async () => {
    const exec = localExec(await folder());
    const controller = new AbortController();
    const job = await exec("sleep 30", { signal: controller.signal });
    controller.abort();

    expect(await job.settled()).toEqual({ kind: "exited", code: null, reason: "terminated" });
    await expect(exec("true", { signal: controller.signal })).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("rejects an aborted settled wait without stopping the process", async () => {
    const job = await localExec(await folder())("sleep 0.3; echo done");
    const controller = new AbortController();
    const waiting = job.settled({ signal: controller.signal });
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ code: "unavailable" });
    expect(await job.settled()).toMatchObject({ code: 0 });
  });

  it("gives a reader that opens late a gap where output was dropped, never stalling the process", async () => {
    const job = await localExec(await folder())(
      "node -e \"process.stdout.write('x'.repeat(3 * 1024 * 1024)); process.stdout.write('END')\"",
    );

    await job.settled();
    const { text, frames } = await read(job);

    expect(frames[0]).toEqual({ kind: "gap" });
    expect(text.endsWith("END")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(1024 * 1024 + 65_536);
    expect(frames.at(-1)).toEqual({ kind: "exit", code: 0 });
  });

  it("detaches readers on close and on the environment's signal, leaving the process running", async () => {
    const environment = new AbortController();
    const exec = localExec(await folder(), { signal: environment.signal });
    const job = await exec("sleep 0.4; echo late");
    const first = job.output()[Symbol.asyncIterator]();
    const pending = first.next();
    await job.close();

    expect(await pending).toEqual({ done: true, value: undefined });
    const second = job.output()[Symbol.asyncIterator]();
    const waiting = second.next();
    environment.abort();

    expect(await waiting).toEqual({ done: true, value: undefined });
    expect(await job.settled()).toEqual({ kind: "exited", code: 0, reason: "exited" });
    expect((await read(job)).text).toBe("late\n");
  });
});

describe("localExec where the pty module does not load (§41a)", () => {
  it("answers a pty job unavailable when the loader throws or returns no pty module, and still runs pipes", async () => {
    const root = await folder();

    const failing = (): never => {
      throw new Error("No prebuilt binary for this platform.");
    };

    for (const loadPty of [failing, () => ({})]) {
      const exec = localExec(root, { loadPty });

      for (const command of [[], "echo hi"])
        await expect(exec(command, { pty: { columns: 80, rows: 24 } })).rejects.toMatchObject({
          code: "unavailable",
        });
    }

    expect((await read(await localExec(root, { loadPty: failing })("echo piped"))).text).toBe(
      "piped\n",
    );
  });
});

describe.skipIf(!ptyLoads)("localExec in a pty", () => {
  it("runs a command in a terminal, resizes it, and reports its exit", async () => {
    const exec = localExec(await folder());
    const job = await exec('printf "%s %s" "$TERM" "$COLORTERM"; sleep 0.2', {
      pty: { columns: 80, rows: 24 },
    });

    expect(await job.resize({ columns: 100, rows: 30 })).toEqual({ kind: "resized" });
    const { text, frames } = await read(job);

    expect(text).toContain("xterm-256color truecolor");
    expect(frames.at(-1)).toEqual({ kind: "exit", code: 0 });
    expect(await job.resize({ columns: 80, rows: 24 })).toEqual({ kind: "missing" });
  });

  it("runs the login shell for an empty command, takes keystrokes, and reads a prompt as idle", async () => {
    const exec = localExec(await folder(), { shell: () => "/bin/sh" });
    const job = await exec([], { pty: { columns: 80, rows: 24 } });
    const reader = job.output()[Symbol.asyncIterator]();
    let text = "";

    const until = async (done: () => boolean): Promise<void> => {
      while (!done()) {
        const next = await reader.next();

        if (next.done === true) return;

        if (next.value.kind === "bytes") text += decoder.decode(next.value.data);
      }
    };

    await job.write(new TextEncoder().encode("PS1='nyte$ '; echo ready-$((1+1))\r"));
    await until(() => text.includes("ready-2"));
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await job.idle()).toBe(true);
    await job.write(new TextEncoder().encode("sleep 2\r"));
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await job.idle()).toBe(false);
    expect(await job.stop()).toMatchObject({ kind: "settled", outcome: { reason: "terminated" } });
  }, 10_000);

  it("answers idle by OSC 133 prompt markers once the shell sends them", async () => {
    const job = await localExec(await folder())(
      "printf '\\033]133;A\\007$ '; sleep 0.5; printf '\\033]133;C\\007'; sleep 2",
      { pty: { columns: 80, rows: 24 } },
    );

    const reader = job.output()[Symbol.asyncIterator]();
    await reader.next();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await job.idle()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await job.idle()).toBe(false);
    await job.stop();
  }, 10_000);
});
