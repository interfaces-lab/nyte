/**
 * auth.json is shared by every Nyte client, so these run the real file store:
 * real processes for the cross-process lock, real crash residue for recovery.
 */
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FileCredentialStore } from "../src/auth/store.ts";

const STORE_URL = new URL("../src/auth/store.ts", import.meta.url).href;
const runNode = promisify(execFile);

let home = "";
const authPath = () => join(home, "auth.json");
const lockPath = () => `${authPath()}.lock`;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nyte-auth-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A separate process, so the lock is exercised the way two clients exercise it. */
function modifyInChildProcess(providerId: string, holdMs: number): Promise<unknown> {
  return runNode(process.execPath, [
    "--input-type=module",
    "-e",
    `
      const { FileCredentialStore } = await import(${JSON.stringify(STORE_URL)});
      const store = new FileCredentialStore(${JSON.stringify(authPath())});
      await store.modify(${JSON.stringify(providerId)}, async () => {
        await new Promise((resolve) => setTimeout(resolve, ${holdMs}));
        return { type: "api_key", key: ${JSON.stringify(providerId)} };
      });
    `,
  ]);
}

async function exitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""]);
  const { pid } = child;
  if (pid === undefined) throw new Error("child process has no pid");
  await once(child, "exit");
  return pid;
}

function ageLock(seconds: number): void {
  const aged = new Date(Date.now() - seconds * 1000);
  utimesSync(lockPath(), aged, aged);
}
function storedJson(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(authPath(), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("auth.json is not an object");
  }
  return { ...parsed };
}

describe("file credential store", () => {
  test("stores a credential for later reads", async () => {
    const store = new FileCredentialStore(authPath());
    await store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }));

    expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "secret" });
    expect(await store.list()).toEqual([{ providerId: "anthropic", type: "api_key" }]);
    expect(await new FileCredentialStore(authPath()).read("anthropic")).toEqual({
      type: "api_key",
      key: "secret",
    });
    if (process.platform !== "win32") {
      expect(statSync(authPath()).mode & 0o777).toBe(0o600);
    }
  });

  test("reads no credentials before anything is stored", async () => {
    const store = new FileCredentialStore(authPath());

    expect(await store.read("anthropic")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  test("keeps a credential it cannot read instead of dropping it", async () => {
    writeFileSync(
      authPath(),
      JSON.stringify({ future: { type: "passkey", handle: "abc" }, openai: { type: "api_key" } }),
    );
    const store = new FileCredentialStore(authPath());

    expect(await store.read("future")).toBeUndefined();
    expect(await store.list()).toEqual([{ providerId: "openai", type: "api_key" }]);

    await store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }));
    expect(storedJson()["future"]).toEqual({ type: "passkey", handle: "abc" });
  });

  test("keeps provider extras on the credential through a refresh", async () => {
    const store = new FileCredentialStore(authPath());
    await store.modify("openai-codex", async () => ({
      type: "oauth",
      access: "old",
      refresh: "rotating",
      expires: 1,
      accountId: "account-1",
    }));

    await store.modify("openai-codex", async (current) => {
      expect(current).toEqual({
        type: "oauth",
        access: "old",
        refresh: "rotating",
        expires: 1,
        accountId: "account-1",
      });
      return current === undefined ? undefined : { ...current, access: "new" };
    });

    expect(await store.read("openai-codex")).toEqual({
      type: "oauth",
      access: "new",
      refresh: "rotating",
      expires: 1,
      accountId: "account-1",
    });
  });

  test("fails a corrupt file instead of replacing it", async () => {
    writeFileSync(authPath(), "{ not json");
    const store = new FileCredentialStore(authPath());

    await expect(store.read("anthropic")).rejects.toThrow("is not valid JSON");
    await expect(store.list()).rejects.toThrow("is not valid JSON");
    await expect(
      store.modify("anthropic", async () => ({ type: "api_key", key: "secret" })),
    ).rejects.toThrow("is not valid JSON");
    expect(readFileSync(authPath(), "utf8")).toBe("{ not json");
  });

  test("rejects a file that is not keyed by provider", async () => {
    writeFileSync(authPath(), JSON.stringify(["anthropic"]));

    await expect(new FileCredentialStore(authPath()).list()).rejects.toThrow(
      "does not hold credentials keyed by provider",
    );
  });

  test("keeps both credentials when two providers are written at once", async () => {
    const store = new FileCredentialStore(authPath());

    await Promise.all([
      store.modify("anthropic", async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { type: "api_key", key: "anthropic-key" };
      }),
      store.modify("openai", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { type: "api_key", key: "openai-key" };
      }),
    ]);

    const stored = await store.list();
    expect(stored.map((info) => info.providerId).sort()).toEqual(["anthropic", "openai"]);
  });

  test("reads while another process holds the lock", async () => {
    const store = new FileCredentialStore(authPath());
    await store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }));
    writeFileSync(lockPath(), `${process.pid} ${hostname()}`);

    expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "secret" });
    expect(await store.list()).toEqual([{ providerId: "anthropic", type: "api_key" }]);
  });

  test("persists a credential produced before the caller aborted", async () => {
    const store = new FileCredentialStore(authPath());
    const controller = new AbortController();

    await store.modify(
      "anthropic",
      async () => {
        controller.abort();
        return { type: "oauth", access: "rotated", refresh: "next", expires: 1 };
      },
      { signal: controller.signal },
    );

    expect(await store.read("anthropic")).toEqual({
      type: "oauth",
      access: "rotated",
      refresh: "next",
      expires: 1,
    });
  });

  test("keeps every credential when separate processes write at once", async () => {
    const providers = ["anthropic", "openai", "github-copilot", "opencode"];

    await Promise.all(providers.map((providerId) => modifyInChildProcess(providerId, 120)));

    const stored = await new FileCredentialStore(authPath()).list();
    expect(stored.map((info) => info.providerId).sort()).toEqual([...providers].sort());
  });

  test("keeps every credential when processes recover from a crashed lock together", async () => {
    const providers = ["anthropic", "openai", "github-copilot", "opencode"];
    writeFileSync(lockPath(), `${await exitedProcessId()} ${hostname()}`);

    await Promise.all(providers.map((providerId) => modifyInChildProcess(providerId, 60)));

    const stored = await new FileCredentialStore(authPath()).list();
    expect(stored.map((info) => info.providerId).sort()).toEqual([...providers].sort());
    expect(readdirSync(home)).toEqual(["auth.json"]);
  });

  test("takes over a lock whose owner is gone", async () => {
    writeFileSync(lockPath(), `${await exitedProcessId()} ${hostname()}`);
    const store = new FileCredentialStore(authPath());

    await store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }));

    expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "secret" });
    expect(readdirSync(home)).toEqual(["auth.json"]);
  });

  test("takes over after a crash during an earlier takeover", async () => {
    writeFileSync(lockPath(), `${await exitedProcessId()} ${hostname()}`);
    const recoveryPath = `${lockPath()}.recovery`;
    writeFileSync(recoveryPath, `${await exitedProcessId()} ${hostname()}`);
    const aged = new Date(Date.now() - 5000);
    utimesSync(recoveryPath, aged, aged);
    const store = new FileCredentialStore(authPath());

    await store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }));

    expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "secret" });
    expect(readdirSync(home)).toEqual(["auth.json"]);
  });

  test("takes over an aged-out lock whose owner cannot be checked", async () => {
    // Another machine's pid on a shared home directory, and a pid this machine reused.
    for (const owner of [`${process.pid} other-host`, `${process.pid} ${hostname()}`]) {
      writeFileSync(lockPath(), owner);
      ageLock(120);

      await new FileCredentialStore(authPath()).modify("anthropic", async () => ({
        type: "api_key",
        key: owner,
      }));

      expect(readdirSync(home)).toEqual(["auth.json"]);
    }
  });

  test("waits for a live lock from another machine instead of taking it", async () => {
    writeFileSync(lockPath(), `${process.pid} other-host`);
    const store = new FileCredentialStore(authPath());

    await expect(
      store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }), {
        signal: AbortSignal.timeout(100),
      }),
    ).rejects.toThrow();

    expect(readFileSync(lockPath(), "utf8")).toBe(`${process.pid} other-host`);
  });

  test("refuses to write once its lock has been taken over", async () => {
    const store = new FileCredentialStore(authPath());
    await store.modify("openai", async () => ({ type: "api_key", key: "kept" }));
    const takeover = `${process.pid} takeover ${"11111111-2222-3333-4444-555555555555"}`;

    await expect(
      store.modify("anthropic", async () => {
        writeFileSync(lockPath(), takeover);
        return { type: "api_key", key: "lost" };
      }),
    ).rejects.toThrow("took over");

    expect(storedJson()).toEqual({ openai: { type: "api_key", key: "kept" } });
    // Releasing must leave the new owner's lock alone.
    expect(readFileSync(lockPath(), "utf8")).toBe(takeover);
  });

  test("refuses to write once a second write in this process took over its aged lock", async () => {
    const store = new FileCredentialStore(authPath());
    await store.modify("openai", async () => ({ type: "api_key", key: "kept" }));
    let sibling: Promise<unknown> = Promise.resolve();

    const reclaimed = store.modify("anthropic", async () => {
      // Suspend/resume and a refresh without its own timeout both age a held lock.
      ageLock(300);
      sibling = store.modify("github-copilot", async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { type: "api_key", key: "sibling" };
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { type: "api_key", key: "reclaimed" };
    });

    await expect(reclaimed).rejects.toThrow("took over");
    await sibling;
    expect(storedJson()).toEqual({
      openai: { type: "api_key", key: "kept" },
      "github-copilot": { type: "api_key", key: "sibling" },
    });
  });

  test("waits for a live lock and gives up when the caller aborts", async () => {
    writeFileSync(lockPath(), `${process.pid} ${hostname()}`);
    const store = new FileCredentialStore(authPath());

    await expect(
      store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }), {
        signal: AbortSignal.timeout(100),
      }),
    ).rejects.toThrow();

    expect(readdirSync(home)).toEqual(["auth.json.lock"]);
  });

  test("never publishes a file a reader can catch half-written", async () => {
    const store = new FileCredentialStore(authPath());
    const bulky = "k".repeat(20_000);
    await store.modify("anthropic", async () => ({ type: "api_key", key: bulky }));
    const reader = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      `
        import { readFileSync } from "node:fs";
        const until = Date.now() + 600;
        let reads = 0;
        let partial = 0;
        while (Date.now() < until) {
          try {
            JSON.parse(readFileSync(${JSON.stringify(authPath())}, "utf8"));
            reads++;
          } catch (error) {
            if (error.code !== "ENOENT") partial++;
          }
        }
        console.log(JSON.stringify({ reads, partial }));
      `,
    ]);
    let report = "";
    reader.stdout.on("data", (chunk: Buffer) => {
      report += chunk.toString();
    });

    const until = Date.now() + 500;
    while (Date.now() < until) {
      await store.modify("anthropic", async () => ({ type: "api_key", key: bulky }));
    }
    await once(reader, "exit");

    const parsed: unknown = JSON.parse(report);
    expect(parsed).toEqual({ reads: expect.any(Number), partial: 0 });
  });

  test("releases the lock when the write fails", async () => {
    const store = new FileCredentialStore(authPath());

    await expect(
      store.modify("anthropic", () => Promise.reject(new Error("refresh failed"))),
    ).rejects.toThrow("refresh failed");

    await store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }));
    expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "secret" });
    expect(readdirSync(home)).toEqual(["auth.json"]);
  });

  test("removes a credential on logout", async () => {
    const store = new FileCredentialStore(authPath());
    await store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }));

    await store.delete("anthropic");

    expect(await store.read("anthropic")).toBeUndefined();
    expect(readdirSync(home)).toEqual(["auth.json"]);
  });
});
