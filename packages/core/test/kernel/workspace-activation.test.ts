import assert from "node:assert/strict";
import { dirname, posix } from "node:path";
import { test } from "vitest";
import { treeId } from "@nyte-ai/protocol";
import { factRef } from "../../src/kernel/names.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import {
  sessionId,
  type NyteOptions,
  type SessionEvent,
  type VcsBackend,
  type Workspace,
  type WorkspaceBackend,
} from "../../src/kernel/sdk/types.ts";
import type { ExecutionEnv } from "../../src/kernel/loop/env.ts";
import { definePlugin, toolsFsPlugin, type Plugin } from "../../src/plugins/index.ts";
import { acceptanceModel, scripted } from "./acceptance-helpers.ts";
import {
  assistant,
  call,
  localOptions,
  localWorkspace,
  openStore,
  storePath,
  trustGrants,
  within,
} from "./helpers.ts";

const workspace: Workspace = {
  kind: "fake-sandbox",
  id: "fake-one",
  cwd: "/work",
  locator: { name: "one" },
};

const ref = { kind: "fake-sandbox", id: "fake-one", cwd: "/work" };

const turn = scripted((_model, context) =>
  context.messages.findLast((item) => item.role !== "system")?.role === "user"
    ? assistant("", {
        calls: [
          call("write-1", "write", { path: "note.txt", content: "hello" }),
          call("bash-1", "bash", { command: "echo hi" }),
        ],
      })
    : assistant("done"),
);

function base(store = openStore()) {
  return {
    store,
    streamFn: turn,
    model: acceptanceModel,
    models: {
      getModels: () => [acceptanceModel],
      getModel: () => acceptanceModel,
      getAvailable: async () => [acceptanceModel],
    },
  } satisfies Partial<NyteOptions>;
}

function fakeEnv(id = "fake-one") {
  const files = new Map<string, string>();
  const directories = new Set(["/", "/work"]);
  const commands: string[] = [];
  const env: ExecutionEnv = {
    id,
    cwd: "/work",
    resolve: (...paths) => posix.resolve("/work", ...paths),
    readFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return Buffer.from(content);
    },
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    mkdir: async (path) => {
      for (let current = path; !directories.has(current); current = posix.dirname(current))
        directories.add(current);
    },
    stat: async (path) =>
      files.has(path)
        ? { kind: "file" }
        : directories.has(path)
          ? { kind: "directory" }
          : undefined,
    readdir: async (path) =>
      [...files.keys(), ...directories].flatMap((entry) =>
        entry !== path && posix.dirname(entry) === path ? [posix.basename(entry)] : [],
      ),
    realpath: async (path) => (files.has(path) || directories.has(path) ? path : undefined),
    exec: async (command, { onData }) => {
      commands.push(command);
      onData(Buffer.from("ran"));
      return { exitCode: 0 };
    },
  };
  return { env, files, commands };
}

function fakeSandbox(env: ExecutionEnv): Plugin {
  return definePlugin({
    id: "fake-sandbox",
    environment: { kind: "fake-sandbox", open: async () => env },
    session: () => undefined,
  });
}

test("a host without the kind's provider cannot run a tree stored there", async () => {
  const nyte = await createNyte({
    ...base(),
    ...localOptions(dirname(storePath())),
    trust: () => ({ kind: "trusted" }),
  });
  try {
    const { sessionId } = await nyte.sessions.create({ workspace });
    const info = await nyte.sessions.get({ sessionId });
    assert.deepEqual(info?.activation, {
      kind: "requires",
      requirement: { kind: "workspace_unavailable", workspace: ref, reason: "unsupported" },
    });
    assert.deepEqual(info?.workspace, ref);
    assert.deepEqual((await nyte.sessionRoot({ sessionId }))?.workspace, workspace);
  } finally {
    await nyte.close();
  }
});

test("a host-opened environment reaches the tools", async () => {
  const fake = fakeEnv();
  const nyte = await createNyte({
    ...base(),
    ...localOptions(dirname(storePath()), [toolsFsPlugin(), fakeSandbox(fake.env)]),
    trust: () => ({ kind: "trusted" }),
  });
  try {
    const { sessionId } = await nyte.sessions.create({ workspace });
    nyte.attach();
    await nyte.messages.send({ sessionId, content: "write and run" });
    await within(nyte.runs.wait({ sessionId }));
    assert.equal(fake.files.get("/work/note.txt"), "hello");
    assert.deepEqual(fake.commands, ["echo hi"]);
    const info = await nyte.sessions.get({ sessionId });
    assert.deepEqual(info?.activation, { kind: "active" });
    assert.deepEqual(info?.workspace, ref);
    const events: SessionEvent[] = [];
    for await (const event of nyte.watch({ sessionId, afterSeq: 0 })) {
      if (event.kind === "synced") break;
      events.push(event);
    }
    assert.deepEqual(
      events.flatMap((event) =>
        event.kind === "fact" && event.key === "workspace" ? [event.value] : [],
      ),
      [ref],
    );
  } finally {
    await nyte.close();
  }
});

test("a child acts in its root's host-opened environment", async () => {
  const fake = fakeEnv();
  const nyte = await createNyte({
    ...base(),
    ...localOptions(dirname(storePath()), [toolsFsPlugin(), fakeSandbox(fake.env)]),
    trust: () => ({ kind: "trusted" }),
  });
  try {
    const { sessionId: root } = await nyte.sessions.create({ workspace });
    const { sessionId: child } = await nyte.sessions.create({
      parent: { sessionId: root, runId: "run_1", callId: "call_1", depth: 1 },
    });
    await nyte.sessions.configure({
      sessionId: child,
      model: { provider: acceptanceModel.provider, id: acceptanceModel.id },
    });
    nyte.attach();
    await nyte.messages.send({ sessionId: child, content: "write and run" });
    await within(nyte.runs.wait({ sessionId: child }));
    assert.deepEqual(fake.commands, ["echo hi"]);
    assert.deepEqual((await nyte.sessions.get({ sessionId: child }))?.workspace, ref);
  } finally {
    await nyte.close();
  }
});

test("a provider that opens another environment leaves the tree unreachable", async () => {
  const nyte = await createNyte({
    ...base(),
    ...localOptions(dirname(storePath()), [fakeSandbox(fakeEnv("fake-two").env)]),
    trust: () => ({ kind: "trusted" }),
  });
  try {
    const { sessionId } = await nyte.sessions.create({ workspace });
    assert.deepEqual((await nyte.sessions.get({ sessionId }))?.activation, {
      kind: "requires",
      requirement: { kind: "workspace_unavailable", workspace: ref, reason: "unreachable" },
    });
  } finally {
    await nyte.close();
  }
});

test("a relative local directory leaves the tree unreachable", async () => {
  const nyte = await createNyte({
    ...base(),
    ...localOptions(dirname(storePath())),
    trust: () => ({ kind: "trusted" }),
  });
  try {
    const relative = localWorkspace("relative");
    assert.deepEqual((await nyte.sessions.create({ workspace: relative })).activation, {
      kind: "requires",
      requirement: { kind: "workspace_unavailable", workspace: relative, reason: "unreachable" },
    });
  } finally {
    await nyte.close();
  }
});

test("a root with no stored workspace acts where new sessions start", async () => {
  const fake = fakeEnv();
  const store = openStore();
  const seeded = await store.create({});
  await seeded.close();
  const root = sessionId(seeded.id);
  const nyte = await createNyte({
    ...base(store),
    plugins: [toolsFsPlugin(), fakeSandbox(fake.env)],
    defaultWorkspace: workspace,
  });
  try {
    const info = await nyte.sessions.get({ sessionId: root });
    assert.deepEqual(info?.activation, { kind: "active" });
    assert.deepEqual(info?.workspace, ref);
    assert.deepEqual((await nyte.sessionRoot({ sessionId: root }))?.workspace, workspace);
    nyte.attach();
    await nyte.messages.send({ sessionId: root, content: "write and run" });
    await within(nyte.runs.wait({ sessionId: root }));
    assert.equal(fake.files.get("/work/note.txt"), "hello");
    assert.deepEqual(fake.commands, ["echo hi"]);
  } finally {
    await nyte.close();
  }
});

test("a tree from before the workspace ref resolves through its root's cwd fact", async () => {
  const cwd = dirname(storePath());
  const store = openStore();
  const seeded = await store.create({});
  const [oid] = await seeded.objects.put([{ kind: "blob", value: cwd }]);
  assert.ok(oid);
  assert.equal(
    (await seeded.refs.update([{ name: factRef("cwd"), from: null, to: oid }], { reason: "fact" }))
      .ok,
    true,
  );
  await seeded.close();
  const root = sessionId(seeded.id);
  const home = dirname(storePath());
  const nyte = await createNyte({
    ...base(store),
    ...localOptions(home),
    trust: trustGrants(new Map([[home, []]])),
  });
  try {
    const info = await nyte.sessions.get({ sessionId: root });
    assert.deepEqual(info?.activation, {
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd },
    });
    assert.deepEqual(info?.workspace, localWorkspace(cwd));
    const { sessionId: child } = await nyte.sessions.create({
      parent: { sessionId: root, runId: "run_1", callId: "call_1", depth: 1 },
    });
    assert.equal((await nyte.sessionRoot({ sessionId: child }))?.workspace.cwd, cwd);
  } finally {
    await nyte.close();
  }
});

test("two providers of one kind are refused when the SDK is created", async () => {
  await assert.rejects(
    createNyte({
      ...base(),
      plugins: [
        fakeSandbox(fakeEnv().env),
        definePlugin({
          id: "second-sandbox",
          environment: { kind: "fake-sandbox", open: async () => fakeEnv().env },
          session: () => undefined,
        }),
      ],
      defaultWorkspace: workspace,
    }),
    /both provide the "fake-sandbox" environment/u,
  );
});

test("plugins that provide no environment for the default workspace are refused when the SDK is created", async () => {
  await assert.rejects(
    createNyte({ ...base(), plugins: [], defaultWorkspace: workspace }),
    /No plugin provides the "fake-sandbox" environment/u,
  );
});

test("a denied workspace opens no environment and loads no project plugins", async () => {
  const fake = fakeEnv();
  let opens = 0;
  let loads = 0;
  let granted = false;
  const nyte = await createNyte({
    ...base(),
    plugins: [
      definePlugin({
        id: "fake-sandbox",
        environment: {
          kind: "fake-sandbox",
          open: async () => {
            opens += 1;
            return fake.env;
          },
        },
        session: () => undefined,
      }),
    ],
    defaultWorkspace: workspace,
    trust: () =>
      granted
        ? {
            kind: "trusted",
            plugins: async () => {
              loads += 1;
              return [definePlugin({ id: "project", session: () => undefined })];
            },
          }
        : { kind: "requires", requirement: { kind: "workspace_trust", cwd: workspace.cwd } },
  });
  try {
    const { sessionId } = await nyte.sessions.create();
    await nyte.messages.send({ sessionId, content: "queued" });
    assert.equal((await nyte.sessions.get({ sessionId }))?.activation.kind, "requires");
    assert.deepEqual(await nyte.plugins.list({ sessionId }), []);
    assert.deepEqual({ opens, loads }, { opens: 0, loads: 0 });
    granted = true;
    await nyte.reactivate();
    assert.ok((await nyte.plugins.list({ sessionId })).some((plugin) => plugin.id === "project"));
    assert.deepEqual({ opens, loads }, { opens: 1, loads: 1 });
  } finally {
    await nyte.close();
  }
});

test("host operations on a session in a refused workspace act nowhere", async () => {
  const reached: string[] = [];
  const unreachable = (name: string) => async (): Promise<never> => {
    reached.push(name);
    throw new Error(`The workspace backend was reached: ${name}`);
  };
  const vcs: VcsBackend = {
    snapshot: unreachable("vcs.snapshot"),
    diff: unreachable("vcs.diff"),
    changes: unreachable("vcs.changes"),
    contents: unreachable("vcs.contents"),
    log: unreachable("vcs.log"),
    refs: unreachable("vcs.refs"),
    stage: unreachable("vcs.stage"),
    discard: unreachable("vcs.discard"),
    commit: unreachable("vcs.commit"),
    createBranch: unreachable("vcs.createBranch"),
    push: unreachable("vcs.push"),
    tree: unreachable("vcs.tree"),
    diffTrees: unreachable("vcs.diffTrees"),
    restoreTree: unreachable("vcs.restoreTree"),
  };
  const backend: WorkspaceBackend = {
    list: unreachable("list"),
    touch: unreachable("touch"),
    forget: unreachable("forget"),
    files: unreachable("files"),
    read: unreachable("read"),
    save: unreachable("save"),
    format: unreachable("format"),
    search: unreachable("search"),
    blame: unreachable("blame"),
    vcs,
  };
  const path = storePath();
  const cwd = dirname(path);
  let trees = 0;
  const trusted = await createNyte({
    ...base(openStore(path)),
    ...localOptions(cwd),
    workspace: {
      ...backend,
      vcs: {
        ...vcs,
        tree: async () => ({ kind: "tree", id: treeId(String(++trees).padStart(40, "0")) }),
        diffTrees: async () => [],
      },
    },
  });
  const { sessionId } = await trusted.sessions.create();
  trusted.attach();
  await trusted.messages.send({ sessionId, content: "write and run" });
  await within(trusted.runs.wait({ sessionId }));
  const [runId] = (await trusted.messages.list({ sessionId })).flatMap((item) =>
    item.kind === "turn" && item.run.kind === "run" ? [item.run.id] : [],
  );
  assert.ok(runId !== undefined);
  assert.equal((await trusted.runs.diff({ sessionId, runs: [runId] }))[0]?.diff.kind, "tree");
  await trusted.close();
  const nyte = await createNyte({
    ...base(openStore(path)),
    ...localOptions(cwd),
    workspace: backend,
    trust: (candidate) => ({
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd: candidate.cwd },
    }),
  });
  try {
    const target = { kind: "session", sessionId } as const;
    assert.equal(await nyte.sessionCwd({ sessionId }), undefined);
    await assert.rejects(nyte.workspace.read({ target, path: "a.txt" }), /No workspace is active/u);
    assert.deepEqual(await nyte.workspace.files({ target }), []);
    assert.deepEqual(
      await nyte.workspace.vcs.commit({
        target,
        message: "commit",
        files: { kind: "all" },
        expect: { revision: "head" },
      }),
      { kind: "failed", reason: "no version control backend" },
    );
    assert.deepEqual(await nyte.runs.diff({ sessionId, runs: [runId] }), [
      { run: runId, diff: { kind: "recorded", files: [] } },
    ]);
    assert.deepEqual(await nyte.runs.revert({ sessionId, runId, expect: treeId("0".repeat(40)) }), {
      kind: "no_tree",
    });
    assert.deepEqual(reached, []);
  } finally {
    await nyte.close();
  }
});

test("without a trust answer only the default workspace is trusted", async () => {
  const other = dirname(storePath());
  const nyte = await createNyte({ ...base(), ...localOptions(dirname(storePath())) });
  try {
    assert.deepEqual((await nyte.sessions.create()).activation, { kind: "active" });
    assert.deepEqual(
      (await nyte.sessions.create({ workspace: localWorkspace(other) })).activation,
      {
        kind: "requires",
        requirement: { kind: "workspace_trust", cwd: other },
      },
    );
  } finally {
    await nyte.close();
  }
});

test("a project plugin cannot provide an environment", async () => {
  let opens = 0;
  const sneaky = definePlugin({
    id: "sneaky",
    environment: {
      kind: "fake-sandbox",
      open: async () => {
        opens += 1;
        return fakeEnv().env;
      },
    },
    session: () => undefined,
  });
  const nyte = await createNyte({
    ...base(),
    ...localOptions(dirname(storePath())),
    trust: () => ({ kind: "trusted", plugins: async () => [sneaky] }),
  });
  try {
    const { sessionId: home } = await nyte.sessions.create();
    assert.ok(
      (await nyte.plugins.list({ sessionId: home })).some((plugin) => plugin.id === "sneaky"),
    );
    const { sessionId } = await nyte.sessions.create({ workspace });
    assert.deepEqual((await nyte.sessions.get({ sessionId }))?.activation, {
      kind: "requires",
      requirement: { kind: "workspace_unavailable", workspace: ref, reason: "unsupported" },
    });
    assert.equal(opens, 0);
  } finally {
    await nyte.close();
  }
});

test("a root's workspace is trusted once and its children inherit it without asking", async () => {
  const elsewhere = localWorkspace(dirname(storePath()));
  const asked: Workspace[] = [];
  const nyte = await createNyte({
    ...base(),
    ...localOptions(dirname(storePath())),
    trust: (candidate) => {
      asked.push(candidate);
      return { kind: "trusted" };
    },
  });
  try {
    const { sessionId: root } = await nyte.sessions.create({ workspace: elsewhere });
    await nyte.sessions.get({ sessionId: root });
    const { sessionId: child } = await nyte.sessions.create({
      parent: { sessionId: root, runId: "run_1", callId: "call_1", depth: 1 },
    });
    await nyte.plugins.list({ sessionId: child });
    assert.deepEqual((await nyte.sessions.get({ sessionId: child }))?.activation, {
      kind: "active",
    });
    assert.deepEqual(asked, [elsewhere]);
  } finally {
    await nyte.close();
  }
});

test("a new root keeps the workspace it was created in when the host's default changes", async () => {
  const path = storePath();
  const created = localWorkspace(dirname(storePath()));
  const first = await createNyte({ ...base(openStore(path)), ...localOptions(created.cwd) });
  const second = await createNyte({
    ...base(openStore(path)),
    ...localOptions(dirname(storePath())),
  });
  try {
    const { sessionId } = await first.sessions.create();
    assert.deepEqual((await second.sessionRoot({ sessionId }))?.workspace, created);
  } finally {
    await first.close();
    await second.close();
  }
});

test("reading a root with no stored workspace does not store one", async () => {
  const path = storePath();
  const seeded = await openStore(path).create({});
  await seeded.close();
  const root = sessionId(seeded.id);
  const before = localWorkspace(dirname(storePath()));
  const after = localWorkspace(dirname(storePath()));
  const first = await createNyte({ ...base(openStore(path)), ...localOptions(before.cwd) });
  const second = await createNyte({ ...base(openStore(path)), ...localOptions(after.cwd) });
  try {
    await first.sessions.list();
    assert.deepEqual((await first.sessions.get({ sessionId: root }))?.workspace, before);
    assert.deepEqual((await second.sessions.get({ sessionId: root }))?.workspace, after);
  } finally {
    await first.close();
    await second.close();
  }
});

test("relocation refuses another environment at the same directory", async () => {
  const cwd = dirname(storePath());
  const nyte = await createNyte({
    ...base(),
    ...localOptions(cwd),
    trust: () => ({ kind: "trusted" }),
  });
  try {
    const { sessionId } = await nyte.sessions.create();
    const impostor = { kind: "local", id: "other-machine", cwd };
    assert.deepEqual(await nyte.relocate({ sessionId, workspace: impostor }), {
      kind: "requires",
      requirement: { kind: "workspace_unavailable", workspace: impostor, reason: "unreachable" },
    });
    assert.deepEqual((await nyte.sessionRoot({ sessionId }))?.workspace, localWorkspace(cwd));
  } finally {
    await nyte.close();
  }
});

test("a malformed workspace is refused before a session is stored", async () => {
  const cwd = dirname(storePath());
  const nyte = await createNyte({ ...base(), ...localOptions(cwd) });
  try {
    const { sessionId } = await nyte.sessions.create();
    await assert.rejects(
      nyte.sessions.create({ workspace: { ...localWorkspace(cwd), cwd: "" } }),
      new TypeError("Invalid workspace"),
    );
    const listed = await nyte.sessions.list();
    assert.deepEqual(
      listed.items.map((item) => item.sessionId),
      [sessionId],
    );
  } finally {
    await nyte.close();
  }
});
