import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { SdkError } from "@nyte-ai/schema";
import { afterEach, expect, it } from "vitest";
import { sqliteStore } from "../src/index.ts";

const HOLD_STORE = join(import.meta.dirname, "fixtures", "hold-store.ts");

const folders: string[] = [];

const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function storePath(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "nyte-store-owner-"));
  folders.push(folder);

  return join(folder, "nyte.db");
}

async function holdStore(path: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [HOLD_STORE, path], { stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (output += chunk));

  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: string) => {
      output += chunk;

      if (output.includes("held")) resolve();
    });
    child.once("exit", () => reject(new Error(`The holder exited: ${output}`)));
  });

  return child;
}

it("refuses a store another live process owns, naming its pid", async () => {
  const path = await storePath();
  const holder = await holdStore(path);
  const opening = sqliteStore({ path }).open();

  await expect(opening).rejects.toBeInstanceOf(SdkError);
  await expect(opening).rejects.toMatchObject({
    code: "unavailable",
    message: expect.stringContaining(`pid ${String(holder.pid)}`),
  });
});

it("takes over the store once its owner dies without releasing it", async () => {
  const path = await storePath();
  const holder = await holdStore(path);
  holder.kill("SIGKILL");
  await once(holder, "exit");
  const store = sqliteStore({ path });

  await store.open();
  await store.close();
});

it("lets stores of one path in this process share the claim, and frees it after the last closes", async () => {
  const path = await storePath();
  const left = sqliteStore({ path });
  const right = sqliteStore({ path });

  await Promise.all([left.open(), right.open()]);
  await left.close();
  const contender = new DatabaseSync(`${path}.owner`, { timeout: 0 });

  expect(() => contender.exec("BEGIN IMMEDIATE")).toThrow(/locked/);
  await right.close();
  contender.exec("BEGIN IMMEDIATE");
  contender.close();
});
