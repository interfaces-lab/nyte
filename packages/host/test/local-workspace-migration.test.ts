import { mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeWorkspaceRecord, envelope, workspaceRef } from "@nyte-ai/core/store";
import type { WorkspaceRecord } from "@nyte-ai/core/store";
import { asId } from "@nyte-ai/schema";
import { afterEach, assert, expect, it } from "vitest";
import { fakeModels } from "../src/bench/fake-models.ts";
import { sha256 } from "../src/hash.ts";
import { folderIdentity } from "../src/local/identity.ts";
import { localProvider } from "../src/local/provider.ts";
import { migrateLocalWorkspaceIdentities } from "../src/local/workspace-migration.ts";
import { openHost } from "../src/open.ts";
import { sqliteStore } from "../src/sqlite.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

it("reopens proven legacy workspaces without moving chats or trusting replacements", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-workspace-migration-")));
  folders.push(home);
  const project = join(home, "project");
  const replacement = join(home, "replacement");
  await mkdir(project);
  await mkdir(replacement);
  await writeFile(join(project, "proof.txt"), "same project");
  const metadata = await stat(project, { bigint: true });
  const replacedMetadata = await stat(replacement, { bigint: true });
  const legacyIdentity = asId<"environment-identity">(sha256(`${metadata.dev}:${metadata.ino}`));
  const modernIdentity = await folderIdentity(project);

  const record: WorkspaceRecord = {
    id: asId("legacy"),
    target: { kind: "local", path: project },
    identity: legacyIdentity,
    projectResources: false,
    projectSources: ["AGENTS.md"],
    addedBy: asId("original-owner"),
    createdAt: Date.now(),
    isolation: null,
  };

  const records: readonly WorkspaceRecord[] = [
    record,
    { ...record, id: asId("modern"), identity: modernIdentity },
    { ...record, id: asId("unmatched"), identity: asId("unrecognized-identity") },
    {
      ...record,
      id: asId("replaced"),
      target: { kind: "local", path: replacement },
      identity: asId(sha256(`${replacedMetadata.dev}:${replacedMetadata.ino}`)),
    },
    {
      ...record,
      id: asId("reused-inode"),
      createdAt: Number(metadata.birthtimeNs / 1_000_000n) - 1,
    },
  ];

  await rename(replacement, join(home, "previous-folder"));
  await mkdir(replacement);
  const store = sqliteStore({ path: join(home, "state.db") });
  const connection = await store.open();

  try {
    for (const workspace of records)
      await connection.refs.set([
        {
          name: workspaceRef(workspace.id),
          target: await connection.objects.put(envelope("workspace", workspace, 1)),
        },
      ]);
    const session = asId<"session">("existing-chat");
    await connection.refs.set([
      {
        name: `sessions/${session}`,
        target: await connection.objects.put(
          envelope(
            "session",
            {
              id: session,
              name: "Existing chat",
              parent: null,
              origin: null,
              workspace: record.id,
              pinned: false,
              archived: false,
              createdAt: 1,
              lastActivityAt: 1,
              heads: [],
              prompt: null,
            },
            1,
          ),
        ),
      },
    ]);
    const before = await connection.refs.list("workspaces/");

    const host = await openHost({
      home,
      store,
      workspace: { kind: "local", path: home },
      models: fakeModels().models,
    });

    try {
      expect(await host.workspace(record.id).info()).toMatchObject({
        id: "legacy",
        identity: modernIdentity,
        availability: { kind: "available" },
        projectResources: false,
        projectSources: ["AGENTS.md"],
        addedBy: "original-owner",
      });
      const files = await host.workspace(record.id).files();
      assert(files.kind === "available");
      expect(await files.api.read("proof.txt")).toMatchObject({
        kind: "text",
        contents: "same project",
      });
      expect(await host.session(session).info()).toMatchObject({
        id: "existing-chat",
        workspace: "legacy",
        name: "Existing chat",
      });

      for (const id of ["unmatched", "replaced", "reused-inode"])
        expect(await host.workspace(asId(id)).info()).toMatchObject({
          availability: { kind: "unavailable", reason: "unreachable" },
        });

      for (const original of before.filter((ref) => ref.name !== "workspaces/legacy"))
        expect(await connection.refs.get(original.name)).toEqual(original);
      const migrated = await connection.refs.get(workspaceRef(record.id));
      assert(migrated?.target != null);
      expect(decodeWorkspaceRecord(await connection.objects.get(migrated.target))).toEqual({
        ...record,
        identity: modernIdentity,
      });
    } finally {
      await host.close();
    }

    const after = await connection.refs.list("workspaces/");

    const reopened = await openHost({
      home,
      store,
      workspace: { kind: "local", path: home },
      models: fakeModels().models,
    });

    try {
      expect(await reopened.workspace(record.id).info()).toMatchObject({
        availability: { kind: "available" },
      });
      expect(await connection.refs.list("workspaces/")).toEqual(after);
    } finally {
      await reopened.close();
    }
  } finally {
    await store.close();
  }
});

it("converges concurrent migrations and skips scanning after the atomic marker", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-workspace-migration-")));
  folders.push(home);
  const metadata = await stat(home, { bigint: true });
  const path = join(home, "state.db");
  const first = sqliteStore({ path });
  const second = sqliteStore({ path });
  const left = await first.open();
  const right = await second.open();
  const id = asId<"workspace">("shared");

  const record: WorkspaceRecord = {
    id,
    target: { kind: "local", path: home },
    identity: asId(sha256(`${metadata.dev}:${metadata.ino}`)),
    projectResources: true,
    projectSources: [],
    addedBy: asId("owner"),
    createdAt: Date.now(),
    isolation: null,
  };

  try {
    await left.refs.set([
      { name: workspaceRef(id), target: await left.objects.put(envelope("workspace", record, 1)) },
    ]);
    await Promise.all([
      migrateLocalWorkspaceIdentities(left),
      migrateLocalWorkspaceIdentities(right),
    ]);
    const migrated = await left.refs.get(workspaceRef(id));
    const marker = await left.refs.get("host/migrations/local-workspace-identity-v2");
    assert(migrated?.target != null && marker?.target != null);
    expect(decodeWorkspaceRecord(await left.objects.get(migrated.target))).toEqual({
      ...record,
      identity: await folderIdentity(home),
    });
    expect(await left.objects.get(marker.target)).toEqual({ pending: [] });
    await migrateLocalWorkspaceIdentities({
      ...left,
      refs: {
        ...left.refs,
        async list() {
          throw new Error("A completed migration must not scan workspaces again.");
        },
      },
    });
    expect(await left.refs.get(workspaceRef(id))).toEqual(migrated);
    expect(await left.refs.get(marker.name)).toEqual(marker);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

it("leaves local identities owned by a custom provider alone", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-workspace-migration-")));
  folders.push(home);
  const metadata = await stat(home, { bigint: true });
  const legacy = asId<"environment-identity">(sha256(`${metadata.dev}:${metadata.ino}`));
  const provider = localProvider({ home });
  const store = sqliteStore({ path: join(home, "state.db") });

  const host = await openHost({
    home,
    store,
    models: fakeModels().models,
    workspace: { kind: "local", path: home },
    plugins: [
      {
        id: "custom-local",
        environment: {
          ...provider,
          inspect: async (target) => ({ ...(await provider.inspect(target)), identity: legacy }),
          attach: async (target) => ({ ...(await provider.attach(target)), identity: legacy }),
        },
      },
    ],
  });

  try {
    const [workspace] = await host.workspaces.list();
    expect(workspace).toMatchObject({
      identity: legacy,
      availability: { kind: "available" },
    });
    expect(
      await (await store.open()).refs.get("host/migrations/local-workspace-identity-v2"),
    ).toBeNull();
  } finally {
    await host.close();
    await store.close();
  }
});

it("retries an unavailable legacy folder without scanning completed workspaces", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-workspace-migration-")));
  folders.push(home);
  const project = join(home, "project");
  const offline = join(home, "offline");
  await mkdir(project);

  const metadata = await stat(project, { bigint: true });
  const identity = await folderIdentity(project);
  const store = sqliteStore({ path: join(home, "state.db") });
  const connection = await store.open();

  const record: WorkspaceRecord = {
    id: asId("offline"),
    target: { kind: "local", path: project },
    identity: asId(sha256(`${metadata.dev}:${metadata.ino}`)),
    projectResources: false,
    projectSources: ["AGENTS.md"],
    addedBy: asId("owner"),
    createdAt: Date.now(),
    isolation: null,
  };

  try {
    await connection.refs.set([
      {
        name: workspaceRef(record.id),
        target: await connection.objects.put(envelope("workspace", record, 1)),
      },
      {
        name: "host/migrations/local-workspace-identity-v1",
        target: await connection.objects.put({ migration: "local-workspace-identity-v1" }),
      },
    ]);
    await rename(project, offline);
    await migrateLocalWorkspaceIdentities(connection);
    const waiting = await connection.refs.get("host/migrations/local-workspace-identity-v2");
    assert(waiting?.target != null);
    expect(await connection.objects.get(waiting.target)).toEqual({
      pending: [workspaceRef(record.id)],
    });
    await migrateLocalWorkspaceIdentities(connection);
    expect(await connection.refs.get(waiting.name)).toEqual(waiting);
    await rename(offline, project);
    await migrateLocalWorkspaceIdentities({
      ...connection,
      refs: {
        ...connection.refs,
        async list() {
          throw new Error("Only the unavailable workspace should be retried.");
        },
      },
    });
    const migrated = await connection.refs.get(workspaceRef(record.id));
    assert(migrated?.target != null);
    expect(decodeWorkspaceRecord(await connection.objects.get(migrated.target))).toEqual({
      ...record,
      identity,
    });
  } finally {
    await store.close();
  }
});

it("finishes when a pending workspace is forgotten", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-workspace-migration-")));
  folders.push(home);
  const store = sqliteStore({ path: join(home, "state.db") });
  const connection = await store.open();
  const name = workspaceRef(asId("forgotten"));

  try {
    await connection.refs.set([
      {
        name,
        target: await connection.objects.put(
          envelope(
            "workspace",
            {
              id: asId("forgotten"),
              target: { kind: "local", path: join(home, "missing") },
              identity: asId("legacy-identity"),
              projectResources: false,
              projectSources: [],
              addedBy: asId("owner"),
              createdAt: Date.now(),
              isolation: null,
            } satisfies WorkspaceRecord,
            1,
          ),
        ),
      },
    ]);
    await migrateLocalWorkspaceIdentities(connection);
    await connection.refs.set([{ name, target: null }]);
    await migrateLocalWorkspaceIdentities(connection);
    const marker = await connection.refs.get("host/migrations/local-workspace-identity-v2");
    assert(marker?.target != null);
    expect(await connection.objects.get(marker.target)).toEqual({ pending: [] });
    await migrateLocalWorkspaceIdentities({
      ...connection,
      refs: {
        ...connection.refs,
        async list() {
          throw new Error("Completed workspaces should not be scanned again.");
        },
      },
    });
  } finally {
    await store.close();
  }
});
