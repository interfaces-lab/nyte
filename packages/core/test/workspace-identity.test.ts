import { asId } from "@nyte-ai/schema";
import { assert, expect, it } from "vitest";
import { createHost } from "../src/api/connection.ts";
import { memoryStore } from "../src/store.ts";
import { createDisk, fakeProvider, kernelOver, world } from "./fake-env.ts";

it("converges concurrent registrations across kernels on one stored workspace", async () => {
  const { host, kernel, provider } = await world();

  const other = createHost(kernelOver(kernel.store, provider), {
    credential: { kind: "token", token: "test" },
  });

  const target = { kind: "local", path: "/work/concurrent" } as const;

  const [first, second] = await Promise.all([
    host.workspaces.add(target),
    other.workspaces.add(target),
  ]);

  assert(first !== undefined && second !== undefined);
  assert(first.kind === "added" || first.kind === "exists");
  assert(second.kind === "added" || second.kind === "exists");
  expect([first.kind, second.kind].sort()).toEqual(["added", "exists"]);
  expect(second.workspace).toBe(first.workspace);
  expect(
    (await host.workspaces.list())
      .filter((workspace) => "path" in workspace.target && workspace.target.path === target.path)
      .map((workspace) => workspace.id),
  ).toEqual([first.workspace]);
  expect(await other.workspaces.add(target)).toEqual({
    kind: "exists",
    workspace: first.workspace,
  });
  await other.close();
  await host.close();
});

it("keeps equal identities from different environment providers separate", async () => {
  const local = fakeProvider(createDisk());
  const remote = fakeProvider(createDisk(), { kind: "sandbox" });

  const host = createHost(
    kernelOver(await memoryStore().open(), local, {
      plugins: [{ id: "sandbox", environment: remote }],
    }),
    { credential: { kind: "token", token: "test" } },
  );

  const original = await host.workspaces.add({ kind: "local", path: "/remote" });

  assert(original.kind === "added");
  const target = { kind: "sandbox", locator: "box" } as const;

  expect(await host.workspaces.inspect(target)).toMatchObject({
    identity: "id:/remote",
    registered: null,
  });
  const added = await host.workspaces.add(target);

  assert(added.kind === "added");
  expect(added.workspace).not.toBe(original.workspace);
  expect(await host.workspaces.inspect(target)).toMatchObject({
    identity: "id:/remote",
    registered: added.workspace,
  });
  expect((await host.workspaces.list()).map((entry) => entry.target.kind).sort()).toEqual([
    "local",
    "sandbox",
  ]);
  await host.close();
});

it("keeps old history readable but refuses a replacement environment", async () => {
  const { host, kernel, provider, disk, workspace } = await world();
  disk.put("/work/project/replacement.txt", "replacement folder");
  const inspect = provider.inspect.bind(provider);
  const attach = provider.attach.bind(provider);
  provider.inspect = async (target) => ({
    ...(await inspect(target)),
    identity: asId("replacement"),
  });
  provider.attach = async (target) => ({
    ...(await attach(target)),
    identity: asId("replacement"),
  });

  const session = await host.sessions.create({ workspace, name: "Original chat" });
  expect(await session.info()).toMatchObject({ name: "Original chat", workspace });
  expect(await host.workspace(workspace).info()).toMatchObject({
    identity: "id:/work/project",
    availability: { kind: "unavailable", reason: "unreachable" },
  });
  expect(await host.workspace(workspace).files()).toMatchObject({
    kind: "unavailable",
    reason: `Workspace ${workspace} no longer refers to its registered environment.`,
  });
  await expect(kernel.env(session.id)).rejects.toMatchObject({ code: "unavailable" });

  const replacement = await host.workspaces.add({ kind: "local", path: "/work/project" });
  assert(replacement.kind === "added");
  const files = await host.workspace(replacement.workspace).files();
  assert(files.kind === "available");
  expect(await files.api.read("replacement.txt")).toMatchObject({
    kind: "text",
    contents: "replacement folder",
  });
  await host.close();
});

it("closes an environment that changes between inspection and attachment", async () => {
  const { host, provider, workspace } = await world();
  const attach = provider.attach.bind(provider);
  let closed = false;
  provider.attach = async (target) => {
    const attached = await attach(target);

    return {
      ...attached,
      identity: asId("replacement"),
      async close() {
        closed = true;
        await attached.close();
      },
    };
  };

  expect(await host.workspace(workspace).files()).toMatchObject({
    kind: "unavailable",
    reason: `Workspace ${workspace} changed while its environment was attached.`,
  });
  expect(closed).toBe(true);
  await host.close();
});
