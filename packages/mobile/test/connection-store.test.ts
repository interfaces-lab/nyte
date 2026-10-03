import { describe, expect, it } from "vitest";
import { createConnectionStore } from "../src/connection/connection-store.ts";
import {
  parseStoredConnection,
  serializeConnection,
  type ManagedConnection,
  type SavedConnection,
} from "../src/connection/connection.ts";

const POLICY = { origin: "https://connect.example.com" };
const MAC_ID = "0b8c9f3e-5d7a-4c1b-9e2f-3a4b5c6d7e8f";
const OTHER_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const MAC_URL = `${POLICY.origin}/r/${MAC_ID}`;

const manual = { name: "Laptop", url: "http://127.0.0.1:8787", token: "manual-token" };

const managed: ManagedConnection = {
  kind: "managed",
  connection: { name: "Studio Mac", url: MAC_URL, token: "device-bearer" },
  binding: {
    origin: POLICY.origin,
    environmentId: MAC_ID,
    deviceId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
    ownerId: "user_owner",
  },
};

/** `managed` as the Keychain holds it, with some fields replaced. */
const stored = (fields: Record<string, string>) =>
  JSON.stringify({ ...managed.connection, ...managed.binding, ...fields });

/**
 * A Keychain stand-in. `hold` delays writes, `writing` sees each write as it
 * starts, and `fail` makes the matching operations reject.
 */
function memory(
  initial: string | null,
  options: {
    readonly hold?: Promise<void>;
    readonly writing?: (text: string) => void;
    readonly fail?: (operation: "write" | "remove", text?: string) => boolean;
  } = {},
) {
  let text = initial;

  return {
    storage: {
      read: async () => text,
      write: async (next: string) => {
        options.writing?.(next);
        await options.hold;

        if (options.fail?.("write", next) === true) throw new Error("Keychain locked");
        text = next;
      },
      remove: async () => {
        if (options.fail?.("remove") === true) throw new Error("Keychain locked");
        text = null;
      },
    },
    current: () => text,
  };
}

function gate() {
  let open = () => {};
  const hold = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { hold, open: () => open() };
}

describe("saved connections", () => {
  it("reads a manual connection in the shape it has always been saved in, with or without a policy", () => {
    const text = JSON.stringify(manual);

    expect(parseStoredConnection(text, undefined)).toEqual({ kind: "manual", connection: manual });
    expect(parseStoredConnection(text, POLICY)).toEqual({ kind: "manual", connection: manual });
    expect(serializeConnection(parseStoredConnection(text, POLICY))).toBe(text);
  });

  it("round-trips an account connection with its broker and owner", () => {
    expect(parseStoredConnection(serializeConnection(managed), POLICY)).toEqual(managed);
  });

  it("restores an account connection only at this broker's relay for its own Mac", () => {
    for (const url of [
      `${POLICY.origin}/r/${OTHER_ID}`,
      `https://connect.other.example/r/${MAC_ID}`,
      `${POLICY.origin}:8443/r/${MAC_ID}`,
      `http://connect.example.com/r/${MAC_ID}`,
      `${MAC_URL}/`,
      `${MAC_URL}/v1`,
      `${MAC_URL}/../${OTHER_ID}`,
      `${POLICY.origin}/r/${OTHER_ID}/../${MAC_ID}`,
      `${POLICY.origin}/r/${MAC_ID.toUpperCase()}`,
      `${POLICY.origin}/r/%30${MAC_ID.slice(1)}`,
      `${POLICY.origin}//r/${MAC_ID}`,
      `${MAC_URL}?to=${OTHER_ID}`,
      `${MAC_URL}#${OTHER_ID}`,
      `https://user@connect.example.com/r/${MAC_ID}`,
      ` ${MAC_URL}`,
      "https://abcdefghijklmnopqrst.nyte.example",
      "http://127.0.0.1:8787",
    ])
      expect(() => parseStoredConnection(stored({ url }), POLICY), url).toThrow();
  });

  it("refuses an account connection from another broker, or with no account configured", () => {
    expect(() =>
      parseStoredConnection(stored({ origin: "https://connect.other.example" }), POLICY),
    ).toThrow(/Nyte Connect/u);
    expect(() => parseStoredConnection(serializeConnection(managed), undefined)).toThrow(
      /Nyte Connect/u,
    );
  });
});

describe("createConnectionStore", () => {
  it("loads once and serves nothing it cannot vouch for", async () => {
    const store = createConnectionStore(memory(serializeConnection(managed)).storage, POLICY);

    expect(store.getSnapshot()).toEqual({ kind: "loading" });
    await store.load();
    expect(store.getSnapshot()).toEqual({ kind: "saved", saved: managed });

    for (const text of ["{", stored({ url: "https://mac.attacker.example" })]) {
      const refused = createConnectionStore(memory(text).storage, POLICY);
      await refused.load();
      expect(refused.getSnapshot()).toEqual({ kind: "unknown" });
    }
  });

  it("puts the previous connection back when the save is aborted mid-write", async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    const disk = memory(JSON.stringify(manual), {
      writing: (text) => {
        writes.push(text);
        controller.abort();
      },
    });
    const store = createConnectionStore(disk.storage, POLICY);

    expect(await store.save(managed, controller.signal)).toEqual({ kind: "cancelled" });
    expect(writes).toEqual([serializeConnection(managed), JSON.stringify(manual)]);
    expect(disk.current()).toBe(JSON.stringify(manual));
    expect(store.getSnapshot()).toEqual({
      kind: "saved",
      saved: { kind: "manual", connection: manual },
    });
  });

  it("admits a failed undo instead of reporting a rollback, and serves nothing", async () => {
    const previous = JSON.stringify(manual);
    const controller = new AbortController();
    // The new connection lands; putting the old one back and deleting both fail.
    const disk = memory(previous, {
      writing: () => controller.abort(),
      fail: (operation, text) => operation === "remove" || text === previous,
    });
    const store = createConnectionStore(disk.storage, POLICY);
    await store.load();
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().kind));

    expect(await store.save(managed, controller.signal)).toEqual({ kind: "failed" });
    expect(disk.current()).toBe(serializeConnection(managed));
    expect(store.getSnapshot()).toEqual({ kind: "unknown" });
    expect(seen).toEqual(["unknown"]);
  });

  it("reports the connection a save replaced", async () => {
    const store = createConnectionStore(memory(serializeConnection(managed)).storage, POLICY);
    const next: SavedConnection = { kind: "manual", connection: manual };

    expect(await store.save(next, new AbortController().signal)).toEqual({
      kind: "saved",
      replaced: managed,
    });
  });

  it("runs a removal after a save that started first, so sign-out finds it", async () => {
    const { hold, open } = gate();
    const disk = memory(null, { hold });
    const store = createConnectionStore(disk.storage, POLICY);
    const order: string[] = [];
    const saving = store.save(managed, new AbortController().signal);
    const removing = store.remove({
      match: (saved): saved is ManagedConnection =>
        saved.kind === "managed" && saved.binding.ownerId === "user_owner",
      release: async (saved) => {
        order.push(`release ${saved.binding.deviceId}`);

        return "removed";
      },
    });

    open();
    expect(await saving).toEqual({ kind: "saved", replaced: undefined });
    expect(await removing).toEqual({ saved: managed, released: "removed" });
    expect(order).toEqual([`release ${managed.binding.deviceId}`]);
    expect(disk.current()).toBeNull();
    expect(store.getSnapshot()).toEqual({ kind: "none" });
  });

  it("leaves another account's connection alone", async () => {
    const disk = memory(serializeConnection(managed));
    const store = createConnectionStore(disk.storage, POLICY);
    const removed = await store.remove({
      match: (saved): saved is ManagedConnection =>
        saved.kind === "managed" && saved.binding.ownerId === "someone_else",
      release: async () => "removed",
    });

    expect(removed).toBeUndefined();
    expect(disk.current()).toBe(serializeConnection(managed));
  });
});
