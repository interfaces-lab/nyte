import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { sqliteStore } from "@nyte-ai/host";
import { expect, test } from "bun:test";

const BINARY = join(import.meta.dir, "..", "src", "binary.ts");

test("`nyte service run` exits 0 with one line naming the owner when another process has the store", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-service-run-")));
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });
  const store = sqliteStore({ path: join(home, ".nyte", "nyte.db") });
  await store.open();

  try {
    const child = Bun.spawn([process.execPath, BINARY, "service", "run"], {
      env: { HOME: home, NYTE_HOME: join(home, ".nyte"), PATH: process.env["PATH"] ?? "" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect({ code, stdout }).toEqual({ code: 0, stdout: "" });
    expect(stderr.trim().split("\n")).toEqual([
      expect.stringMatching(
        new RegExp(`^error: Another Nyte process \\(pid ${String(process.pid)},`, "u"),
      ),
    ]);
  } finally {
    await store.close();
    await rm(home, { recursive: true, force: true });
  }
}, 60_000);
