import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { ConnectView } from "@nyte-ai/connect";
import { afterEach, expect, it, vi } from "vitest";
import { tryLockFile } from "@nyte-ai/connect/host";
import { RELAY_ELECT_MS, Sharing } from "../src/sharing.ts";
import type { SharedConnect } from "../src/sharing.ts";

const HOLD = join(import.meta.dirname, "fixtures", "hold-relay.ts");

const folders: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "nyte-sharing-"));
  folders.push(folder);
  await mkdir(join(folder, ".nyte"));

  return folder;
}

const UNAVAILABLE: ConnectView = { kind: "unavailable", reason: "not_configured" };

const LINKED: ConnectView = {
  kind: "linked",
  account: { kind: "unavailable" },
  owner: { id: "owner", label: "Owner" },
  environment: { id: "environment", name: "Mac", address: "mac.example" },
  enabled: true,
  connection: { kind: "stopped" },
  lease: { kind: "stopped" },
  devices: [],
};

function fakeConnect(served: string[], name: string, view = LINKED): SharedConnect {
  return {
    view: async () => view,
    link: async () => UNAVAILABLE,
    setEnabled: async () => UNAVAILABLE,
    unlink: async () => undefined,
    retryUnlinks: async () => undefined,
    stop: async () => UNAVAILABLE,
    async autostart() {
      served.push(name);
    },
  };
}

it("lets one process at a time carry the relay, and hands it on within one election once the holder closes", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const shared = await home();
  const served: string[] = [];

  const share = async () => ({
    port: 0,
    close: async () => undefined,
    disconnectClients: () => undefined,
  });

  const first = new Sharing({ connect: fakeConnect(served, "first"), share, home: shared });
  const second = new Sharing({ connect: fakeConnect(served, "second"), share, home: shared });

  first.start();
  await vi.waitFor(() => expect(first.holder).toBe(true));
  second.start();
  await vi.advanceTimersByTimeAsync(RELAY_ELECT_MS * 3);

  expect(second.holder).toBe(false);
  expect(new Set(served)).toEqual(new Set(["first"]));

  await first.close();
  await vi.advanceTimersByTimeAsync(RELAY_ELECT_MS);

  expect(second.holder).toBe(true);
  expect(served.at(-1)).toBe("second");
  await second.close();
});

it("frees the relay when the process carrying it dies without closing", async () => {
  const shared = await home();
  const path = join(shared, ".nyte", "relay.lock");
  const holder = spawn(process.execPath, [HOLD, path], { stdio: ["pipe", "pipe", "inherit"] });
  holder.stdout.setEncoding("utf8");
  const [first] = await once(holder.stdout, "data");

  expect(String(first)).toBe("held\n");
  expect(tryLockFile(path)).toBeNull();

  holder.kill("SIGKILL");
  await once(holder, "exit");
  const release = tryLockFile(path);

  expect(release).not.toBeNull();
  release?.();
});

it("leaves the relay to a process that can carry it when this one is not linked", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const shared = await home();
  const served: string[] = [];

  const share = async () => ({
    port: 0,
    close: async () => undefined,
    disconnectClients: () => undefined,
  });

  const unlinked = new Sharing({
    connect: fakeConnect(served, "unlinked", UNAVAILABLE),
    share,
    home: shared,
  });

  const linked = new Sharing({ connect: fakeConnect(served, "linked"), share, home: shared });

  unlinked.start();
  await vi.advanceTimersByTimeAsync(RELAY_ELECT_MS);
  linked.start();
  await vi.waitFor(() => expect(linked.holder).toBe(true));

  expect(unlinked.holder).toBe(false);
  expect(new Set(served)).toEqual(new Set(["linked"]));
  await unlinked.close();
  await linked.close();
});
