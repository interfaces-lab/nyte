import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isJson, isJsonObject } from "@nyte-ai/schema";
import { afterEach, assert, beforeEach, expect, it } from "vitest";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nyte-acp-crash-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("E15 never resends an uncertain dispatch after killing its SQLite host", async () => {
  const fixture = fileURLToPath(new URL("./fixtures/acp-crash.mjs", import.meta.url));

  const run = (mode: "dispatch" | "recover") => {
    const child = fork(fixture, [dir, mode], {
      env: { ...process.env, HOME: dir, NYTE_HOME: join(dir, "home") },
      silent: true,
    });

    const message = Promise.withResolvers<unknown>();
    const exited = Promise.withResolvers<void>();
    let stderr = "";
    child.stderr?.on("data", (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    child.once("message", (value: unknown) => message.resolve(value));
    child.once("error", (error) => message.reject(error));
    child.once("exit", (code, signal) => {
      exited.resolve();

      if (code !== 0 && signal !== "SIGKILL") message.reject(new Error(stderr));
    });

    return { child, message: message.promise, exited: exited.promise };
  };

  const first = run("dispatch");

  try {
    expect(await first.message).toEqual({ kind: "effect-observed" });
  } finally {
    first.child.kill("SIGKILL");
    await first.exited;
  }

  const second = run("recover");

  try {
    const value = await second.message;
    assert(isJson(value) && isJsonObject(value));
    expect(value.kind).toBe("recovered");
    expect(value.effects).toBe("charged\n");
    assert(isJsonObject(value.outcome));
    expect(value.outcome.kind).toBe("failed");
  } finally {
    if (second.child.exitCode === null) second.child.kill("SIGTERM");
    await second.exited;
  }
}, 30_000);
