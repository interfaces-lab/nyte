import { OPERATION_AUTHORITY, asId } from "@nyte-ai/schema";
import type { Authority, PrincipalId } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import {
  ALL_AUTHORITY,
  CORE_CONTEXT,
  PARTICIPANT_AUTHORITY,
  SdkError,
  authenticateToken,
  createConnection,
  createHost,
  createInvocation,
  gated,
  hostPrincipalsRef,
  memoryStore,
  redeemPairing,
} from "../src/index.ts";
import type { Connection, Durable, Kernel, StoreConnection, Workspace } from "../src/index.ts";
import { addWorkspace, createDisk, fakeProvider, kernelOver, world } from "./fake-env.ts";
import type { FakeProvider } from "./fake-env.ts";
import { main, setup, workspace } from "./harness.ts";

/** Calls every row that needs more than participant through a connection and its workspace, answering each row's error code or `allowed`. */
async function elevatedRows(sdk: Connection, at: Workspace): Promise<Record<string, string>> {
  const git = await at.git();
  assert(git.kind === "available");
  const login = () => sdk.models.login({ provider: "p", method: { kind: "key" } });

  const rows: Record<string, () => unknown> = {
    "models.refresh": () => sdk.models.refresh(),
    "models.setDefault": () => sdk.models.setDefault({ provider: "p", id: "m" }),
    "models.verify": () => sdk.models.verify("p"),
    "models.login": login,
    "login.steps": () => login().steps(),
    "login.answer": () => login().answer("no"),
    "models.logout": () => sdk.models.logout("p"),
    "settings.apply": () => sdk.settings.apply("theme", "dark"),
    "workspaces.inspect": () => sdk.workspaces.inspect({ kind: "local", path: "/new" }),
    "workspaces.add": () => sdk.workspaces.add({ kind: "local", path: "/new" }),
    "workspaces.forget": () => sdk.workspaces.forget(at.id),
    "workspace.update": () => at.update({ projectResources: false }),
    "workspace.reload": () => at.reload(),
    "git.stage": () => git.api.stage([]),
    "git.unstage": () => git.api.unstage([]),
    "git.discard": () => git.api.discard([]),
    "git.commit": () => git.api.commit({ message: "no", files: "staged" }),
    "git.branch": () => git.api.branch({ name: "no", checkout: false }),
    "git.push": () => git.api.push(),
    "plugins.replace": () => sdk.plugins.replace([]),
    "plugins.check": () => sdk.plugins.check([]),
    "principals.list": () => sdk.principals.list(),
    "principals.pair": () => sdk.principals.pair({ authority: new Set(["participant"]) }),
    "principals.revoke": () => sdk.principals.revoke(asId("nobody")),
  };

  const answered = await Promise.all(
    Object.entries(rows).map(async ([name, call]) => {
      try {
        await call();

        return [name, "allowed"];
      } catch (error) {
        return [name, error instanceof SdkError ? error.code : String(error)];
      }
    }),
  );

  return Object.fromEntries(answered);
}

function connectionAs(kernel: Kernel, authority: ReadonlySet<Authority>) {
  return createConnection(kernel, {
    principal: asId("caller"),
    authority,
    credential: { kind: "token", token: "t" },
    origin: null,
  });
}

async function paired(kernel: Kernel): Promise<{ principal: PrincipalId; token: string }> {
  const { code } = await kernel.principals.pair({ authority: new Set(["participant"]) });
  const redeemed = await redeemPairing(kernel, code);
  assert(redeemed !== null);

  return redeemed;
}

describe("connection gate (§52 rule 5)", () => {
  it("denies each elevated row the authority lacks, by the table, before the call runs", async () => {
    const { kernel } = await setup();
    const participant = connectionAs(kernel, PARTICIPANT_AUTHORITY);

    await expect(participant.models.refresh()).rejects.toMatchObject({ code: "denied" });
    expect(() => participant.models.login({ provider: "p", method: { kind: "key" } })).toThrow(
      "models.login needs owner authority.",
    );
    await expect(participant.settings.apply("theme", "dark")).rejects.toMatchObject({
      code: "denied",
    });
    await expect(
      participant.workspaces.add({ kind: "local", path: "/work/other" }),
    ).rejects.toMatchObject({ code: "denied", message: "workspaces.add needs owner authority." });
    await expect(participant.workspace(workspace).reload()).rejects.toMatchObject({
      code: "denied",
    });
    await expect(participant.principals.list()).rejects.toMatchObject({ code: "denied" });

    await expect(
      createConnection(kernel, CORE_CONTEXT).plugins.replace([{ path: "/plugins/a.ts" }]),
    ).rejects.toMatchObject({
      code: "denied",
      message: "plugins.replace needs maintenance authority.",
    });
    expect((await participant.workspaces.list()).map((info) => info.id)).toEqual([workspace]);
  });

  it("denies every row the schema table marks above participant, to a connection and to a tool's invocation, from that one table (D6 audit 1, §56)", async () => {
    const { kernel, host, workspace: at } = await world();
    const session = await host.sessions.create({ workspace: at });
    const elevated = Object.entries(OPERATION_AUTHORITY).flatMap(([name, row]) =>
      row.authority === "participant" ? [] : [name],
    );
    const denied = Object.fromEntries(elevated.map((name) => [name, "denied"]));
    const participant = connectionAs(kernel, PARTICIPANT_AUTHORITY);
    const memo: Durable["memo"] = async (_name, compute) => compute();

    const invocation = createInvocation(kernel, {
      session: session.id,
      runtime: kernel.pluginsFor(session.id),
      head: main,
      run: asId("r1"),
      call: asId("c1"),
      context: CORE_CONTEXT,
      signal: new AbortController().signal,
      workspace: at,
      env: await kernel.env(session.id),
      durable: { wait: async () => ({ kind: "deadline" }), memo, now: () => 0 },
    });

    expect(elevated).toHaveLength(24);
    expect(await elevatedRows(participant, participant.workspace(at))).toEqual(denied);
    expect(await elevatedRows(invocation.sdk, invocation.workspace)).toEqual(denied);
  });

  it("keeps inherited api methods and their receivers when gating (D6 audit 3)", async () => {
    class Git {
      readonly clean = "clean";

      async status() {
        return this.clean;
      }

      async commit() {
        return "committed";
      }
    }

    const guarded = gated("git", new Git(), PARTICIPANT_AUTHORITY);

    expect(await guarded.status()).toBe("clean");
    await expect(guarded.commit()).rejects.toMatchObject({ code: "denied" });

    const base = fakeProvider(createDisk());
    const inheriting: FakeProvider = {
      ...base,
      git(env) {
        const git = base.git?.(env);

        return git === undefined ? undefined : Object.create(git);
      },
    };
    const kernel = kernelOver((await setup()).kernel.store, inheriting);
    const at = await addWorkspace(
      createHost(kernel, { credential: { kind: "token", token: "x" } }),
    );
    const git = await connectionAs(kernel, PARTICIPANT_AUTHORITY).workspace(at).git();

    assert(git.kind === "available");
    expect(await git.api.status()).toEqual({ kind: "none" });
    await expect(git.api.commit({ message: "no", files: "all" })).rejects.toMatchObject({
      code: "denied",
    });
  });

  it("gates a capability's api by its own rows and hands every other member through", async () => {
    const git = { status: async () => "clean", commit: async () => "committed" };

    expect(gated("git", git, ALL_AUTHORITY)).toBe(git);

    const guarded = gated("git", git, PARTICIPANT_AUTHORITY);

    expect(await guarded.status()).toBe("clean");
    await expect(guarded.commit()).rejects.toMatchObject({
      code: "denied",
      message: "git.commit needs owner authority.",
    });
  });

  it("answers unavailable to a wire plugins.replace([]) on a host with no loader (ADV E E8)", async () => {
    const { kernel } = await setup();
    const before = kernel.hostPlugins;

    await expect(connectionAs(kernel, ALL_AUTHORITY).plugins.replace([])).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(connectionAs(kernel, ALL_AUTHORITY).plugins.check([])).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(kernel.hostPlugins).toBe(before);
  });
});

describe("principals", () => {
  it("authenticates a burst of device tokens beside pairing writes, never stale, writing nothing (ADV C 3)", async () => {
    const { kernel } = await setup();
    const device = await paired(kernel);
    const revision = async () => (await kernel.store.refs.get(hostPrincipalsRef()))?.revision;

    const burst = await Promise.allSettled([
      ...Array.from({ length: 6 }, () => authenticateToken(kernel, device.token)),
      kernel.principals.pair({ authority: new Set(["participant"]) }),
    ]);

    expect(burst.map((outcome) => outcome.status)).toEqual(Array(7).fill("fulfilled"));
    const settled = await revision();
    await Promise.all(Array.from({ length: 4 }, () => authenticateToken(kernel, device.token)));
    expect(await revision()).toBe(settled);
  });

  it("refuses to register a principal revoked while its token was being read, recording nothing (ADV C 5, D6 audit 5)", async () => {
    const shared = await memoryStore().open();
    let revoke: () => Promise<void> = async () => undefined;

    const store: StoreConnection = {
      ...shared,
      refs: {
        ...shared.refs,
        async get(name) {
          const read = await shared.refs.get(name);

          if (name === hostPrincipalsRef()) {
            const now = revoke;
            revoke = async () => undefined;
            await now();
          }

          return read;
        },
      },
    };

    const { kernel } = await setup({ store });
    const device = await paired(kernel);
    revoke = () => kernel.principals.revoke(device.principal);

    expect(await authenticateToken(kernel, device.token)).toMatchObject({
      principal: device.principal,
    });
    expect(await kernel.principals.list()).toEqual([]);

    let closed = 0;

    expect(
      kernel.connections.register(device.principal, () => {
        closed += 1;
      }),
    ).toEqual({ kind: "revoked" });
    kernel.connections.revoke(device.principal);
    expect(closed).toBe(0);
    expect(await authenticateToken(kernel, device.token)).toBeNull();
  });
});
