import { asId, asSeq } from "@nyte-ai/schema";
import type { Authority, CallId, Json, PatchSet, RunId } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import {
  LOCAL,
  SdkError,
  authenticateToken,
  envelope,
  hostPrincipalsRef,
  prune,
  reachableObjects,
  createConnection,
  createHost,
  createInvocation,
  driveInProcess,
  environmentPlugin,
  headRef,
  isPart,
  redeemPairing,
  runStep,
  viewHead,
  workspaceHandle,
  text,
  workspaceRef,
} from "../src/index.ts";
import type {
  ConnectionContext,
  Durable,
  Kernel,
  Page,
  Plugin,
  WorkspaceRecord,
} from "../src/index.ts";
import { addWorkspace, collect, kernelOver, world } from "./fake-env.ts";
import { main, until } from "./harness.ts";

function connectionAs(kernel: Kernel, authority: readonly Authority[]) {
  return createConnection(kernel, {
    principal: asId("device"),
    authority: new Set(authority),
    credential: { kind: "token", token: "t" },
    origin: null,
  });
}

const run: RunId = asId("r1");

/** Returns the last set a patches stream yields and every set before it. */
async function patches(source: AsyncIterable<PatchSet>) {
  const sets = await collect(source);
  const last = sets.at(-1);
  assert(last !== undefined);

  return { sets, last };
}

describe("workspaces", () => {
  it("inspects a target, adds it once, answers stale for a swapped identity, and lists it", async () => {
    const { host, workspace } = await world();

    expect(await host.workspaces.inspect({ kind: "local", path: "/work/other" })).toEqual({
      target: { kind: "local", path: "/work/other" },
      identity: "id:/work/other",
      availability: { kind: "available" },
      projectSources: [".nyte/plugins/x.ts"],
      registered: null,
    });
    expect(await host.workspaces.inspect({ kind: "local", path: "/work/project" })).toMatchObject({
      registered: workspace,
    });
    await expect(
      host.workspaces.inspect({ kind: "sandbox", locator: "box" }),
    ).rejects.toMatchObject({ code: "unavailable" });

    expect(
      await host.workspaces.add(
        { kind: "local", path: "/work/other" },
        { expect: { identity: asId("id:/elsewhere") } },
      ),
    ).toEqual({ kind: "stale", identity: "id:/work/other" });
    expect(await host.workspaces.add({ kind: "local", path: "/work/project" })).toEqual({
      kind: "exists",
      workspace,
    });
    expect(await host.workspaces.add({ kind: "sandbox", locator: "box" })).toEqual({
      kind: "unavailable",
      reason: "unsupported",
    });

    const added = await host.workspaces.add(
      { kind: "local", path: "/work/other" },
      { projectResources: false, expect: { identity: asId("id:/work/other") } },
    );

    assert(added.kind === "added");

    expect(await host.workspaces.list()).toEqual(
      expect.arrayContaining([
        {
          id: added.workspace,
          target: { kind: "local", path: "/work/other" },
          identity: "id:/work/other",
          availability: { kind: "available" },
          projectResources: false,
          projectSources: [".nyte/plugins/x.ts"],
          addedBy: LOCAL,
          sessions: 0,
          writers: [],
        },
      ]),
    );
  });

  it("forgets a workspace only once no session uses it", async () => {
    const { host, workspace } = await world();
    const session = await host.sessions.create({ workspace });

    expect(await host.workspace(workspace).info()).toMatchObject({ sessions: 1, writers: [] });
    expect(await host.workspaces.forget(workspace)).toEqual({
      kind: "busy",
      sessions: [session.id],
    });

    expect(await session.remove()).toEqual({ kind: "removed" });
    expect(await host.workspaces.forget(workspace)).toEqual({ kind: "forgotten" });
    expect(await host.workspaces.forget(workspace)).toEqual({ kind: "missing" });
    await expect(host.workspace(workspace).info()).rejects.toMatchObject({ code: "unknown" });
  });

  it("checks owner authority for registration and participant for reads", async () => {
    const { kernel, workspace } = await world();
    const participant = connectionAs(kernel, ["participant"]);

    await expect(
      participant.workspaces.add({ kind: "local", path: "/work/other" }),
    ).rejects.toBeInstanceOf(SdkError);
    expect(await participant.workspaces.list()).toHaveLength(1);
    await expect(participant.workspace(workspace).reload()).rejects.toMatchObject({
      code: "denied",
    });
  });

  it("keeps a participant-only tool from committing through its invocation's workspace (§52 rule 5)", async () => {
    const { kernel, host, workspace } = await world();
    const session = await host.sessions.create({ workspace });
    const memo: Durable["memo"] = async (_name, compute) => compute();

    const invocation = createInvocation(kernel, {
      session: session.id,
      runtime: kernel.pluginsFor(session.id),
      head: main,
      run: asId("r1"),
      call: asId("c1"),
      context: {
        principal: LOCAL,
        authority: new Set(["participant", "owner", "maintenance"]),
        credential: { kind: "token", token: "" },
        origin: null,
      },
      signal: new AbortController().signal,
      workspace,
      env: await kernel.env(session.id),
      durable: { wait: async () => ({ kind: "deadline" }), memo, now: () => 0 },
    });

    const git = await invocation.workspace.git();

    assert(git.kind === "available");
    await expect(git.api.commit({ message: "No.", files: "all" })).rejects.toMatchObject({
      code: "denied",
      message: "git.commit needs owner authority.",
    });
    expect(await git.api.status()).toEqual({ kind: "none" });
  });

  it("activates a session: active, unavailable while unreachable, failed when attach throws, and reload retries", async () => {
    const { host, provider, workspace } = await world();
    const served = await host.sessions.create({ workspace });

    expect((await served.info()).activation).toEqual({ kind: "active" });

    provider.availability = { kind: "unavailable", reason: "unreachable" };
    const unreachable = await host.sessions.create({ workspace });

    expect((await unreachable.info()).activation).toEqual({
      kind: "unavailable",
      workspace,
      reason: "unreachable",
    });

    provider.availability = null;
    provider.failure = "The disk is gone.";
    const broken = await host.sessions.create({ workspace });

    expect((await broken.info()).activation).toEqual({
      kind: "failed",
      message: "The disk is gone.",
    });
    expect((await broken.view()).activation).toEqual({
      kind: "failed",
      message: "The disk is gone.",
    });

    provider.failure = null;
    const watched = broken.watch()[Symbol.asyncIterator]();
    await watched.next();

    expect(await host.workspace(workspace).reload()).toEqual({ kind: "updated" });
    expect((await broken.info()).activation).toEqual({ kind: "active" });
    expect((await unreachable.info()).activation).toEqual({ kind: "active" });

    const seen = await until(async () => {
      const next = await watched.next();

      return !next.done && next.value.activation.kind === "active" ? next.value : undefined;
    });

    expect(seen.activation).toEqual({ kind: "active" });
    await watched.return?.();
  });

  it("attaches a session once per activation: a failed attach rejects ready, shows failed with its reason and is dropped, so the next activation attaches again (E7, E-2 N3)", async () => {
    const seen: string[] = [];

    const probe: Plugin<"core"> = {
      id: "probe",
      activate(api) {
        try {
          seen.push(api.env.cwd);
        } catch {
          seen.push("none");
        }
      },
    };

    const { kernel, host, provider, workspace } = await world({ plugins: [probe] });
    const attach = provider.attach.bind(provider);
    let attempts = 0;

    provider.attach = async (target) => {
      attempts += 1;

      return attach(target);
    };

    provider.failure = "The sandbox did not boot.";
    const session = await host.sessions.create({ workspace });
    await expect(kernel.pluginsFor(session.id).ready).rejects.toThrow("The sandbox did not boot.");

    expect(kernel.activation(session.id)).toEqual({
      kind: "failed",
      message: "The sandbox did not boot.",
    });
    expect(seen).toEqual([]);

    provider.failure = null;
    await until(() => (kernel.runtimes().has(session.id) ? undefined : true));
    const failed = attempts;
    await kernel.pluginsFor(session.id).ready;
    expect((await session.info()).activation).toEqual({ kind: "active" });
    expect(seen).toEqual(["/work/project"]);
    expect(attempts).toBe(failed + 1);
  });

  it("rejects an unknown session's activation instead of resolving it (E6, P4)", async () => {
    const { kernel } = await world();

    await expect(kernel.pluginsFor(asId("nobody")).ready).rejects.toMatchObject({
      code: "unknown",
    });
  });

  it("serves capabilities: files and git available, git writes gated by their own rows, browser unsupported, unavailable or unsupported when nothing attaches", async () => {
    const { kernel, host, provider, workspace } = await world();
    const handle = host.workspace(workspace);
    const files = await handle.files();

    assert(files.kind === "available");
    await files.api.write("notes.md", "hi\n");
    expect(provider.disk.text("/work/project/notes.md")).toBe("hi\n");

    const git = await handle.git();

    assert(git.kind === "available");
    expect(await git.api.commit({ message: "Ship.", files: "all" })).toMatchObject({
      kind: "applied",
    });
    expect(await handle.browser()).toMatchObject({ kind: "unsupported" });

    const participant = connectionAs(kernel, ["participant"]).workspace(workspace);
    const guarded = await participant.git();

    assert(guarded.kind === "available");
    expect(await guarded.api.status()).toEqual({ kind: "none" });
    await expect(guarded.api.commit({ message: "No.", files: "all" })).rejects.toMatchObject({
      code: "denied",
    });

    await kernel.environments.detachWorkspace(workspace);
    provider.failure = "Offline.";

    expect(await handle.files()).toEqual({
      kind: "unavailable",
      retry: "allowed",
      reason: "Offline.",
    });

    const sandbox = asId<"workspace">("w-sandbox");

    const record: WorkspaceRecord = {
      id: sandbox,
      target: { kind: "sandbox", locator: "box" },
      identity: asId("box"),
      projectResources: true,
      projectSources: [],
      addedBy: LOCAL,
      createdAt: 0,
    };

    await kernel.store.refs.set([
      {
        name: workspaceRef(sandbox),
        target: await kernel.store.objects.put(envelope("workspace", record, 0)),
      },
    ]);

    expect(await host.workspace(sandbox).git()).toMatchObject({ kind: "unsupported" });
  });

  it("answers git unsupported for a provider without git", async () => {
    const { host, workspace } = await world({ git: false });

    expect(await host.workspace(workspace).git()).toMatchObject({ kind: "unsupported" });
  });

  it("applies wraps in order and lazily, a wrap's browser served as the capability", async () => {
    const { kernel, host, workspace } = await world();
    const session = await host.sessions.create({ workspace });
    const env = await kernel.env(session.id);
    const calls: string[] = [];

    kernel.wrapEnv(session.id, (inner) => ({
      ...inner,
      exec: (command, options) => {
        calls.push("first");

        return inner.exec(command, options);
      },
    }));

    const dispose = kernel.wrapEnv(session.id, (inner) => ({
      ...inner,
      exec: (command, options) => {
        calls.push("second");

        return inner.exec(command, options);
      },
      browser: {
        open: async () => {
          throw new Error("No pages.");
        },
        adopt: async () => {
          throw new Error("No pages.");
        },
        list: async () => [],
        async *watch() {},
      },
    }));

    await (await env.exec("echo hi")).settled();

    expect(calls).toEqual(["second", "first"]);
    expect((await kernel.environments.capabilities(session.id)).browser).toMatchObject({
      kind: "available",
    });

    dispose();
    calls.length = 0;
    await (await env.exec("echo hi")).settled();

    expect(calls).toEqual(["first"]);
  });

  it("reports what a run changed from its snapshots, and patches batched and cached, holding stale entries while the revision moves", async () => {
    const { kernel, host, disk, provider, workspace } = await world();
    disk.put("/work/project/a.ts", "one\n");
    disk.put("/work/project/b.ts", "two\n");
    const snapshots = await kernel.environments.workspaceSnapshots(workspace);
    assert(snapshots !== null);
    await snapshots.before(run);
    disk.put("/work/project/a.ts", "one\nmore\n");
    disk.put("/work/project/b.ts", "three\n");
    const handle = host.workspace(workspace);

    expect(await handle.changes(run)).toMatchObject({
      files: [
        { path: "a.ts", status: "modified", stat: { kind: "text", added: 2, removed: 1 } },
        { path: "b.ts", status: "modified", stat: { kind: "text", added: 1, removed: 1 } },
      ],
    });

    const first = await patches(handle.patches(run, ["a.ts", "b.ts"]));

    expect(provider.patchReads).toEqual([["a.ts", "b.ts"]]);
    expect([...first.last.entries.values()].map((entry) => [entry.path, entry.fresh])).toEqual([
      ["a.ts", true],
      ["b.ts", true],
    ]);

    const cached = await patches(handle.patches(run, ["b.ts", "a.ts"]));

    expect(provider.patchReads).toHaveLength(1);
    expect(cached.sets).toHaveLength(1);
    expect(cached.last.entries.get("a.ts")).toBe(first.last.entries.get("a.ts"));

    disk.put("/work/project/a.ts", "one\nmore\nagain\n");
    disk.put("/work/project/b.ts", "two\n");
    const moved = await patches(handle.patches(run, ["a.ts", "b.ts"]));

    expect(moved.sets[0]?.revision).not.toBe(first.last.revision);
    expect(
      [...(moved.sets[0]?.entries.values() ?? [])].map((entry) => [entry.path, entry.fresh]),
    ).toEqual([
      ["a.ts", false],
      ["b.ts", false],
    ]);
    expect([...moved.last.entries.values()].map((entry) => [entry.path, entry.fresh])).toEqual([
      ["a.ts", true],
    ]);
  });

  it("reads at most 32 paths per provider call with at most 4 in flight", async () => {
    const { kernel, host, disk, provider, workspace } = await world();
    const paths = Array.from({ length: 150 }, (_value, index) => `f${index}.ts`);
    const snapshots = await kernel.environments.workspaceSnapshots(workspace);
    assert(snapshots !== null);
    await snapshots.before(run);

    for (const path of paths) disk.put(`/work/project/${path}`, `${path}\n`);
    const { last } = await patches(host.workspace(workspace).patches(run, paths));

    expect(last.entries.size).toBe(150);
    expect(provider.patchReads.map((read) => read.length)).toEqual([32, 32, 32, 32, 22]);
    expect(provider.peakReads).toBe(4);
  });

  it("updates projectResources and yields the record as it changes", async () => {
    const { host, workspace } = await world();
    const handle = host.workspace(workspace);
    const watched = handle.watch()[Symbol.asyncIterator]();
    const opened = await watched.next();

    assert(!opened.done);
    expect(opened.value.projectResources).toBe(true);
    expect(await handle.update({ projectResources: false })).toEqual({ kind: "updated" });

    const next = await watched.next();

    assert(!next.done);
    expect(next.value.projectResources).toBe(false);
    await watched.return?.();
    expect(await host.workspace(asId("gone")).update({ projectResources: true })).toEqual({
      kind: "missing",
    });
  });
});

describe("principals", () => {
  it("pairs a device once, lists it, authenticates its token, and revokes it with its connections", async () => {
    const { kernel, host } = await world();

    const { code, expiresAt } = await host.principals.pair({
      authority: new Set(["participant"]),
      label: "Phone",
    });

    expect(expiresAt).toBeGreaterThan(Date.now());

    const redeemed = await redeemPairing(kernel, code);

    assert(redeemed !== null);
    expect([redeemed.principal === LOCAL, redeemed.principal === asId("token")]).toEqual([
      false,
      false,
    ]);
    expect([...redeemed.authority]).toEqual(["participant"]);
    expect(await redeemPairing(kernel, code)).toBeNull();

    const listed = await host.principals.list();

    expect(listed).toEqual([
      {
        id: redeemed.principal,
        label: "Phone",
        authority: new Set(["participant"]),
        pairedAt: expect.any(Number),
      },
    ]);

    const stored = JSON.stringify(
      await kernel.store.objects.get(
        (await kernel.store.refs.get(hostPrincipalsRef()))?.target ?? asId("none"),
      ),
    );

    expect(stored).not.toContain(redeemed.token);
    expect(await authenticateToken(kernel, redeemed.token)).toEqual({
      principal: redeemed.principal,
      authority: new Set(["participant"]),
    });
    expect(await authenticateToken(kernel, "forged")).toBeNull();

    let dropped = 0;
    kernel.connections.register(redeemed.principal, () => {
      dropped += 1;
    });

    const forgotten = kernel.connections.register(redeemed.principal, () => {
      dropped += 10;
    });

    assert(forgotten.kind === "admitted");
    forgotten.dispose();

    await host.principals.revoke(redeemed.principal);

    expect(dropped).toBe(1);
    expect(await host.principals.list()).toEqual([]);
    expect(await authenticateToken(kernel, redeemed.token)).toBeNull();
  });

  it("revokes an id no paired principal holds as a success, writing and marking nothing (§65, ADV C N3, probe N2)", async () => {
    const { kernel, host } = await world();
    await host.principals.pair({ authority: new Set(["participant"]) });
    const before = await kernel.store.refs.get(hostPrincipalsRef());

    for (const id of ["token", "local", "nobody"])
      await expect(host.principals.revoke(asId(id))).resolves.toBeUndefined();

    expect(await kernel.store.refs.get(hostPrincipalsRef())).toEqual(before);

    for (const id of ["token", "local", "nobody"])
      expect(kernel.connections.register(asId(id), () => undefined).kind).toBe("admitted");
  });

  it("retries pair, redeem and revoke on the one record until each wins, none answering stale (ADV C N4, probe N3)", async () => {
    const { kernel, host } = await world();

    const codes = await Promise.all(
      Array.from({ length: 6 }, () =>
        host.principals.pair({ authority: new Set(["participant"]) }),
      ),
    );
    const redeemed = await Promise.all(codes.map(({ code }) => redeemPairing(kernel, code)));

    expect(redeemed.filter((entry) => entry === null)).toEqual([]);
    expect(await host.principals.list()).toHaveLength(6);

    await Promise.all(
      redeemed
        .slice(0, 3)
        .flatMap((entry) => (entry === null ? [] : [host.principals.revoke(entry.principal)])),
    );

    expect(await host.principals.list()).toHaveLength(3);
  });

  it("refuses to mint a pairing code without participant, so none is spent on a connection that is denied (ADV C N6, probe PA1)", async () => {
    const { kernel, host } = await world();

    await expect(
      host.principals.pair({ authority: new Set(["maintenance"]) }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await kernel.store.refs.get(hostPrincipalsRef())).toBeNull();
  });
});

describe("prune", () => {
  it("reports every ref target and every commit a head reaches, and nothing else", async () => {
    const { kernel, host, workspace } = await world();
    const session = await host.sessions.create({ workspace });

    for (const markdown of ["First.", "Second."])
      await session.parts.create(text, {
        state: { markdown, signature: null },
        placement: { kind: "transcript", role: "note" },
      });

    const first = (await session.view()).messages[0];
    assert(first !== undefined && isPart(first, text) && first.status.kind === "settled");
    const ancestor = asId<"object">(first.status.commit);
    const refs = await kernel.store.refs.list("");
    const targets = refs.flatMap((ref) => (ref.target === null ? [] : [ref.target]));
    const reachable = await collect(reachableObjects(kernel));
    const unreferenced = await kernel.store.objects.put(envelope("kv", "orphan", 0));

    expect(targets).not.toContain(ancestor);
    expect(new Set(reachable).size).toBe(reachable.length);
    expect(reachable).toEqual(expect.arrayContaining([...new Set(targets), ancestor]));
    expect(reachable).not.toContain(unreferenced);
    expect(await prune(kernel)).toEqual({
      objects: reachable.length,
      bytes: 0,
      retained: refs.length,
    });
    expect(await host.prune()).toEqual(await prune(kernel));
    expect(refs.map((ref) => ref.name)).toContain(headRef(session.id, main));
  });
});

describe("activation (§37j–m)", () => {
  const credential = { credential: { kind: "token", token: "x" } } as const;

  it("gates a pre-existing session's first send and command on a new kernel behind its activation", async () => {
    const { kernel, host, provider, workspace } = await world();
    const session = await host.sessions.create({ workspace });

    const gate: Plugin<"core"> = {
      id: "gate",
      contribute: {
        commands: [{ name: "hello", title: "Hello", description: "Says hi.", run: () => "hi" }],
      },
      hooks: { before_send: () => ({ action: "reject", reason: "Closed." }) },
    };

    const second = kernelOver(kernel.store, provider, { plugins: [gate] });
    const fresh = createHost(second, credential);

    expect(second.runtimes().has(session.id)).toBe(false);
    await expect(fresh.session(session.id).send("Hello.")).rejects.toMatchObject({
      code: "invalid",
      message: "Closed.",
    });

    const third = createHost(kernelOver(kernel.store, provider, { plugins: [gate] }), credential);

    expect(await third.session(session.id).command("hello")).toEqual({ kind: "ran", output: "hi" });
  });

  it("lets a plugin send and run a prompt command from its own activate without waiting on that activation", async () => {
    const { kernel, host, provider, workspace } = await world();
    const session = await host.sessions.create({ workspace });

    const chatty: Plugin<"core"> = {
      id: "chatty",
      contribute: {
        commands: [
          {
            name: "nudge",
            title: "Nudge",
            description: "Asks.",
            run: () => ({ prompt: "Nudged." }),
          },
        ],
      },
      async activate(api) {
        await api.session.send("Hello from activate.", { delivery: "attach" });
        await api.session.command("nudge");
      },
    };

    const fresh = createHost(kernelOver(kernel.store, provider, { plugins: [chatty] }), credential);
    await fresh.session(session.id).send("After.", { delivery: "attach" });

    expect(
      (await fresh.session(session.id).view()).messages.map((message) =>
        message.kind === "user" ? message.content : message.kind,
      ),
    ).toEqual(["Hello from activate.", "Nudged.", "After."]);
  });

  it("relocates a session: its environment, cwd and plugins follow the new workspace", async () => {
    const { kernel, host, workspace } = await world({ plugins: [environmentPlugin] });
    const session = await host.sessions.create({ workspace });
    const other = await addWorkspace(host, "/work/other");

    expect((await kernel.env(session.id)).cwd).toBe("/work/project");
    expect(await session.update({ workspace: other })).toEqual({ kind: "updated" });
    expect((await kernel.env(session.id)).cwd).toBe("/work/other");
    expect((await session.info()).activation).toEqual({ kind: "active" });
    expect(
      kernel
        .pluginsFor(session.id)
        .registries.prompt.list()
        .find((section) => section.id === "cwd")?.text,
    ).toContain("/work/other");
  });

  it("reloads the full list: a plugin a failed activation rejected is retried, and a session's own list is kept", async () => {
    let broken = true;
    const starts: string[] = [];

    const flaky: Plugin<"core"> = {
      id: "flaky",
      activate() {
        starts.push("flaky");

        if (broken) throw new Error("Not yet.");
      },
    };

    const builtin: Plugin<"core"> = {
      id: "builtin",
      activate() {
        starts.push("builtin");
      },
    };

    const { kernel, host, workspace } = await world({ plugins: [flaky], builtins: [builtin] });
    const session = await host.sessions.create({ workspace });
    const first = kernel.pluginsFor(session.id);

    expect(first.plugins().map((plugin) => plugin.id)).toEqual(["builtin", "fake-environment"]);

    broken = false;
    await host.workspace(workspace).reload();

    expect(first.plugins()).toEqual([]);
    expect(
      kernel
        .pluginsFor(session.id)
        .plugins()
        .map((plugin) => plugin.id),
    ).toEqual(["builtin", "fake-environment", "flaky"]);

    const own: Plugin<"core"> = { id: "own" };
    await host.plugins.replace([own], { session: session.id });
    await host.workspace(workspace).reload();
    const runtime = kernel.pluginsFor(session.id);

    expect(runtime.assigned()).toEqual([own]);
    expect(runtime.plugins().map((plugin) => plugin.id)).toEqual(["builtin", "own"]);
    expect(starts.filter((id) => id === "builtin")).toHaveLength(4);
  });

  it("loads an uncovered session's plugins but attaches nothing: env and inputs unavailable, activation inactive", async () => {
    const seen: unknown[] = [];

    const probe: Plugin<"core"> = {
      id: "probe",
      activate(api) {
        for (const read of [() => api.env, () => api.inputs]) {
          try {
            read();
          } catch (error) {
            seen.push(error instanceof SdkError ? error.code : error);
          }
        }
      },
    };

    const { kernel, host, provider, workspace } = await world({
      plugins: [probe],
      execution: { kind: "admit-only" },
    });

    const session = await host.sessions.create({ workspace });

    expect(
      kernel
        .pluginsFor(session.id)
        .plugins()
        .map((plugin) => plugin.id),
    ).toContain("probe");
    expect(seen).toEqual(["unavailable", "unavailable"]);
    expect(provider.attaches).toBe(0);
    expect((await session.info()).activation).toEqual({ kind: "inactive" });
  });

  it("attaches an admit-only kernel's session while an in-process driver covers it, as a listener drives it (§41b, §41h)", async () => {
    const { kernel, host, provider, workspace } = await world({
      execution: { kind: "admit-only" },
    });

    const driver = driveInProcess(kernel, { kind: "workspace", workspace });
    const session = await host.sessions.create({ workspace });

    expect((await session.info()).activation).toEqual({ kind: "active" });
    expect(provider.attaches).toBe(1);
    expect((await kernel.env(session.id)).cwd).toBe("/work/project");
    await driver.close();
  });
});

describe("patch reads", () => {
  it("yields a failed batch's paths as failed entries, the rest of the set intact, and reads them again later", async () => {
    const { kernel, host, disk, provider, workspace } = await world();
    const paths = Array.from({ length: 40 }, (_value, index) => `f${index}.ts`);
    const snapshots = await kernel.environments.workspaceSnapshots(workspace);
    assert(snapshots !== null);
    await snapshots.before(run);

    for (const path of paths) disk.put(`/work/project/${path}`, `${path}\n`);
    provider.failPatches = (batch) => (batch.includes("f39.ts") ? "The diff timed out." : null);
    const { last } = await patches(host.workspace(workspace).patches(run, paths));
    const failed = [...last.entries.values()].filter((entry) => entry.kind === "failed");

    expect(last.entries.size).toBe(40);
    expect(failed).toHaveLength(8);
    expect(failed[0]).toMatchObject({
      path: "f32.ts",
      status: "added",
      kind: "failed",
      reason: "The diff timed out.",
      fresh: true,
    });
    expect(last.entries.get("f0.ts")).toMatchObject({ kind: "text", fresh: true });

    provider.failPatches = null;
    const again = await patches(host.workspace(workspace).patches(run, paths));

    expect(provider.patchReads.map((read) => read.length)).toEqual([32, 8, 8]);
    expect(again.last.entries.get("f39.ts")).toMatchObject({ kind: "text" });
  });
});

describe("browser pages (§37i)", () => {
  it("keeps a closed page's id: a replay with another input is invalid, with the same input unknown (G6, P2)", async () => {
    const { kernel, host, provider, workspace } = await world({ browser: true });
    const capability = await host.workspace(workspace).browser();
    assert(capability.kind === "available");

    const open = (url: string) =>
      kernel.pages.open({
        id: "replayed",
        input: { workspace, url },
        open: () => capability.api.open({ url }),
      });

    const page = await open("http://localhost:3000");

    await expect(open("http://localhost:4000")).rejects.toMatchObject({ code: "invalid" });
    expect((await open("http://localhost:3000")).id).toBe(page.id);
    await page.close();
    await expect(open("http://localhost:4000")).rejects.toMatchObject({ code: "invalid" });
    await expect(open("http://localhost:3000")).rejects.toMatchObject({ code: "unknown" });
    expect(provider.opened).toEqual([page.id]);
  });

  it("counts holds per page and closes the provider's page on the last close", async () => {
    const { host, provider, workspace } = await world({ browser: true });
    const capability = await host.workspace(workspace).browser();
    assert(capability.kind === "available");
    const browser = capability.api;
    const page = await browser.open({ url: "http://localhost:3000" });
    const again = await browser.adopt(page.id);

    expect(again.id).toBe(page.id);
    expect(await browser.list()).toEqual([expect.objectContaining({ id: page.id, holders: 2 })]);

    await page.close();
    await page.close();

    expect(provider.closed).toEqual([]);
    expect(await browser.list()).toEqual([expect.objectContaining({ holders: 1 })]);

    await again[Symbol.asyncDispose]();

    expect(provider.closed).toEqual([page.id]);
    expect(provider.opened).toEqual([page.id]);
  });

  it("shows a step's page on its head as an unlogged background item, seeded into cold folds, and a re-run adopts the recorded page", async () => {
    const { kernel, host, provider, workspace } = await world({ browser: true });
    const session = await host.sessions.create({ workspace });
    const call: CallId = asId("c1");
    const held: Page[] = [];

    const body = async (durable: Durable): Promise<Json> => {
      let sequence = 0;

      const context: ConnectionContext = {
        principal: LOCAL,
        authority: new Set(["participant"]),
        credential: { kind: "token", token: "x" },
        origin: {
          session: session.id,
          run: null,
          head: main,
          call,
          sequence: {
            next: () => {
              sequence += 1;

              return sequence - 1;
            },
          },
        },
      };

      const capability = await workspaceHandle(kernel, context, workspace).browser();
      assert(capability.kind === "available");
      held.push(await capability.api.open({ url: "http://localhost:5173" }));

      return (await durable.wait({ kind: "timer", until: Date.now() + 60_000 })).kind;
    };

    const step = () =>
      runStep<Json>(kernel, {
        session: session.id,
        head: main,
        run: null,
        call,
        kind: "hook",
        replay: "safe",
        intent: { test: true },
        part: null,
        signal: new AbortController().signal,
        body,
        settle: async (ended) => ({
          result: { ended: ended.kind === "done" ? ended.value : ended.kind },
          updates: [],
        }),
        decode: (result) => result,
      });

    expect(await step()).toEqual({ kind: "parked" });
    expect(await step()).toEqual({ kind: "parked" });
    const [first, second] = held;
    assert(first !== undefined && second !== undefined);
    expect(second.id).toBe(first.id);
    expect(provider.opened).toEqual([first.id]);
    expect(kernel.pages.holders(first.id)).toBe(2);

    const item = { kind: "page", id: first.id, title: "http://localhost:5173", startedBy: call };
    const other = { session: session.id, head: main, principal: asId<"principal">("other") };

    expect((await session.view()).background).toEqual([{ ...item, state: "working" }]);
    expect((await viewHead(kernel, other)).background).toEqual([{ ...item, state: "working" }]);

    const client = await host.workspace(workspace).browser();
    assert(client.kind === "available");
    await (await client.api.adopt(first.id)).close();

    expect((await session.view()).background).toEqual([{ ...item, state: "working" }]);

    const live = kernel.folds.acquire(session.id, LOCAL);
    await live.ready();
    await first.close();
    await second.close();

    expect(provider.closed).toEqual([first.id]);
    expect((await session.view()).background).toEqual([{ ...item, state: "done" }]);
    expect((await viewHead(kernel, other)).background).toEqual([]);
    live.release();
    expect(
      (await kernel.store.refs.log(session.id, asSeq(0), 1000)).some(
        (event) => event.kind === "background",
      ),
    ).toBe(false);
  });
});
