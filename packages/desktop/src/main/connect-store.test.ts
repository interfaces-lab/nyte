/**
 * The account store against a real temporary directory: every write is what
 * the next read and the next process see, and a write that fails leaves the
 * store failed rather than half-written.
 */
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMachineKey } from "@nyte-ai/connect/signing";
import { afterEach, test } from "vitest";
import { ConnectStore, ConnectStoreFailed, EMPTY_CONNECT_FILE } from "./connect-store.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nyte-connect-store-"));
  cleanups.push(async () => {
    await chmod(root, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

const pending = (environmentId: string, key: Awaited<ReturnType<typeof generateMachineKey>>) => ({
  environmentId,
  key,
  at: 1,
});

test("each change builds on the last, and a fresh store reads what was written", async () => {
  const root = await directory();
  const path = join(root, "connect.json");
  const store = new ConnectStore(path);

  const [first, second, linkKey] = await Promise.all([
    generateMachineKey(),
    generateMachineKey(),
    generateMachineKey(),
  ]);

  assert.deepEqual(await store.read(), { kind: "ready", file: EMPTY_CONNECT_FILE });
  await store.update((file) => ({ file: { ...file, enabled: true }, result: undefined }));
  await store.update((file) => ({
    file: {
      ...file,
      unlinks: [...file.unlinks, pending("3f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f", first)],
    },
    result: undefined,
  }));
  await Promise.all([
    store.update((file) => ({
      file: {
        ...file,
        unlinks: [...file.unlinks, pending("4f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f", second)],
      },
      result: undefined,
    })),
    store.update((file) => ({
      file: { ...file, linkKey: { key: linkKey, owner: "user_a" } },
      result: undefined,
    })),
  ]);

  const expected = {
    ...EMPTY_CONNECT_FILE,
    enabled: true,
    linkKey: { key: linkKey, owner: "user_a" },
    unlinks: [
      pending("3f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f", first),
      pending("4f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f", second),
    ],
  };

  assert.deepEqual(await store.read(), { kind: "ready", file: expected });
  assert.deepEqual(store.snapshot(), { kind: "ready", file: expected });
  assert.deepEqual(await new ConnectStore(path).read(), { kind: "ready", file: expected });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expected);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("a failed write fails the store for good and leaves the file as it was", async () => {
  const root = await directory();
  const path = join(root, "connect.json");
  const store = new ConnectStore(path);
  await store.update((file) => ({ file: { ...file, enabled: true }, result: undefined }));
  const before = await readFile(path, "utf8");

  await chmod(root, 0o500);
  await assert.rejects(
    store.update((file) => ({ file: { ...file, enabled: false }, result: undefined })),
    ConnectStoreFailed,
  );
  await chmod(root, 0o700);

  assert.deepEqual(await store.read(), { kind: "failed" });
  await assert.rejects(
    store.update((file) => ({ file: { ...file, enabled: false }, result: undefined })),
    ConnectStoreFailed,
  );
  assert.equal(await readFile(path, "utf8"), before);
});

test("a file that does not parse, or is from another version, is failed, not replaced", async () => {
  const root = await directory();
  const path = join(root, "connect.json");
  const key = await generateMachineKey();
  const publicPart = { kty: key.kty, crv: key.crv, x: key.x };

  for (const text of [
    "{",
    '{"version":3}',
    JSON.stringify({ ...EMPTY_CONNECT_FILE, version: 2 }),
    JSON.stringify({ ...EMPTY_CONNECT_FILE, version: 4 }),
    JSON.stringify({
      ...EMPTY_CONNECT_FILE,
      linkKey: { key: publicPart, owner: null },
    }),
    JSON.stringify({
      ...EMPTY_CONNECT_FILE,
      unlinks: [{ environmentId: "3f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f", key: "not-a-key", at: 1 }],
    }),
  ]) {
    await writeFile(path, text, { mode: 0o600 });
    const store = new ConnectStore(path);

    assert.deepEqual(await store.read(), { kind: "failed" }, text);
    await assert.rejects(
      store.update((file) => ({ file: { ...file, enabled: false }, result: undefined })),
      ConnectStoreFailed,
    );
    assert.equal(await readFile(path, "utf8"), text);
  }
});

test.skipIf(process.platform === "win32")(
  "a file other users can reach is refused without changing its mode or contents",
  async () => {
    const root = await directory();
    const path = join(root, "connect.json");
    const writer = new ConnectStore(path);
    await writer.update((file) => ({ file: { ...file, enabled: true }, result: undefined }));
    const text = await readFile(path, "utf8");

    for (const mode of [0o640, 0o604, 0o620]) {
      await chmod(path, mode);
      const store = new ConnectStore(path);

      assert.deepEqual(await store.read(), { kind: "failed" }, mode.toString(8));
      await assert.rejects(
        store.update((file) => ({ file: { ...file, enabled: false }, result: undefined })),
        ConnectStoreFailed,
      );
      assert.equal((await stat(path)).mode & 0o777, mode);
      assert.equal(await readFile(path, "utf8"), text);
    }

    await chmod(path, 0o400);
    assert.deepEqual(await new ConnectStore(path).read(), {
      kind: "ready",
      file: { ...EMPTY_CONNECT_FILE, enabled: true },
    });
  },
);
