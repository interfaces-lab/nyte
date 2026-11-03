import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import type { Job } from "@nyte-ai/core";
import type { OutputFrame } from "@nyte-ai/schema";
import { localExec } from "../src/index.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-bun-pty-")));
  folders.push(made);

  return made;
}

const decoder = new TextDecoder();

const encoder = new TextEncoder();

function follow(job: Job): (pattern: RegExp) => Promise<string> {
  const reader = job.output()[Symbol.asyncIterator]();
  let text = "";

  return async (pattern) => {
    while (!pattern.test(text)) {
      const next = await reader.next();

      if (next.done === true) break;

      if (next.value.kind === "bytes") text += decoder.decode(next.value.data);
    }

    return text;
  };
}

describe.skipIf(process.platform === "win32")("localExec in Bun's pty", () => {
  it("runs a login shell in the cwd with the env, echoes writes, resizes and reports the exit code", async () => {
    const root = await folder();
    const job = await localExec(root, { shell: () => "/bin/sh" })([], {
      pty: { columns: 80, rows: 24 },
      env: { NYTE_PTY: "bun" },
    });
    const read = follow(job);

    await job.write(encoder.encode('echo "hi-$((40+2)) $(pwd) $NYTE_PTY $TERM"\r'));

    expect(await read(/hi-42 \S+ bun \S+/)).toContain(`hi-42 ${root} bun xterm-256color`);
    expect(await job.resize({ columns: 120, rows: 40 })).toEqual({ kind: "resized" });
    await job.write(encoder.encode("echo size-$(stty size | tr ' ' x)\r"));

    expect(await read(/size-\d+x\d+/)).toContain("size-40x120");
    await job.write(encoder.encode("exit 3\r"));

    expect(await job.settled()).toEqual({ kind: "exited", code: 3, reason: "exited" });
    expect(await job.resize({ columns: 80, rows: 24 })).toEqual({ kind: "missing" });
  }, 20_000);

  it("hangs up a login shell on stop without needing SIGKILL", async () => {
    const job = await localExec(await folder(), { shell: () => "/bin/sh" })([], {
      pty: { columns: 80, rows: 24 },
    });
    const read = follow(job);
    await job.write(encoder.encode("echo ready-$((1+1))\r"));
    await read(/ready-2/);
    const started = Date.now();

    expect(await job.stop()).toMatchObject({
      kind: "settled",
      outcome: { kind: "exited", reason: "terminated" },
    });
    expect(Date.now() - started).toBeLessThan(1_500);
  }, 20_000);

  it("keeps the newest 8 MiB of a flood no one reads, behind one gap, without pausing the program", async () => {
    const job = await localExec(await folder())(
      "head -c 10485760 /dev/zero | tr '\\0' x; printf END",
      { pty: { columns: 80, rows: 24 } },
    );

    expect(await job.settled()).toEqual({ kind: "exited", code: 0, reason: "exited" });
    const frames: OutputFrame[] = [];

    for await (const frame of job.output()) frames.push(frame);
    const text = frames
      .map((frame) => (frame.kind === "bytes" ? decoder.decode(frame.data) : ""))
      .join("");

    expect(frames.filter((frame) => frame.kind === "gap")).toHaveLength(1);
    expect(frames[0]).toEqual({ kind: "gap" });
    expect(text.endsWith("END")).toBe(true);
    expect(text.length).toBeGreaterThan(7 * 1024 * 1024);
    expect(text.length).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(frames.at(-1)).toEqual({ kind: "exit", code: 0 });
  }, 20_000);
});
