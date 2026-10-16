import { SdkError } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { kvRef } from "../src/store.ts";
import type { Plugin, PluginApi, PluginStorage, Setting } from "../src/index.ts";
import { configuration, setup, workspace } from "./harness.ts";
import { volume, theme, loaded } from "./plugin-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("settings", () => {
  it("applies a host setting before any session, refuses an invalid value and an unknown id", async () => {
    const { kernel, host } = await setup();
    kernel.plugins.host = [{ id: "looks", contribute: { settings: [theme] } }];

    expect(await host.settings.apply("theme", "dark")).toEqual({ kind: "applied" });
    expect(await host.settings.apply("theme", "blue")).toMatchObject({
      kind: "invalid",
      issues: expect.arrayContaining([expect.objectContaining({ severity: "error" })]),
    });
    expect(await host.settings.apply("nope", 1)).toEqual({ kind: "unknown" });
    expect(kernel.host.current().settings).toEqual([
      {
        id: "theme",
        owner: "looks",
        scope: "host",
        label: "Theme",
        schema: expect.objectContaining({ anyOf: expect.any(Array) }),
        choices: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark", badge: "new" },
        ],
        value: "dark",
        from: "host",
      },
    ]);

    const session = await host.sessions.create();

    expect((await session.view()).catalog.settings).toEqual([
      expect.objectContaining({ id: "theme", value: "dark", from: "host" }),
    ]);
  });

  it("yields a setting's value, then each change, until its plugin deactivates", async () => {
    let handle: Setting<unknown> | undefined;

    const { host, session } = await loaded([
      {
        id: "mixer",
        activate(api) {
          handle = api.contribute.settings.add(volume);
        },
      },
    ]);

    assert(handle !== undefined);
    const values = handle.watch()[Symbol.asyncIterator]();

    expect(await values.next()).toEqual({ done: false, value: 3 });
    expect(await host.settings.apply("volume", 7)).toEqual({ kind: "applied" });
    expect(await values.next()).toEqual({ done: false, value: 7 });
    await handle.set(9);
    expect(await values.next()).toEqual({ done: false, value: 9 });
    expect(await handle.get()).toBe(9);
    await expect(handle.set(-1)).rejects.toBeInstanceOf(SdkError);
    expect((await session.view()).catalog.settings).toEqual([
      expect.objectContaining({ id: "volume", value: 9, from: "host" }),
    ]);

    await host.plugins.replace([], { session: session.id });

    expect(await values.next()).toEqual({ done: true, value: undefined });
  });

  it("reads a statically declared setting through settings.value and watch, and sees a settings.apply change (§48b)", async () => {
    let api: PluginApi<"core"> | undefined;

    const { host } = await loaded([
      {
        id: "mixer",
        contribute: { settings: [volume] },
        activate(given) {
          api = given;
        },
      },
    ]);

    assert(api !== undefined);
    const values = api.contribute.settings.watch("volume")[Symbol.asyncIterator]();

    expect(await api.contribute.settings.value("volume")).toBe(3);
    expect(await values.next()).toEqual({ done: false, value: 3 });
    expect(await host.settings.apply("volume", 5)).toEqual({ kind: "applied" });
    expect(await values.next()).toEqual({ done: false, value: 5 });
    expect(await api.contribute.settings.value("volume")).toBe(5);
    await expect(api.contribute.settings.value("theme")).rejects.toMatchObject({ code: "unknown" });
    await values.return?.();
  });

  it("sets a session-scope value from activate without waiting on that activation", async () => {
    const { host, session } = await loaded(
      [
        {
          id: "mixer",
          contribute: {
            commands: [{ name: "ping", title: "Ping", description: "", run: () => "pong" }],
          },
          async activate(api) {
            await api.contribute.settings.add({ ...volume, scope: "session" }).set(4);
          },
        },
      ],
      {
        resolveConfiguration: async ({ selected, patch }) => ({
          ...configuration,
          settings: { ...selected?.settings, ...patch?.settings },
        }),
      },
    );

    expect(await session.command("ping")).toEqual({ kind: "ran", output: "pong" });
    expect((await session.view()).catalog.settings).toEqual([
      expect.objectContaining({ id: "volume", value: 4, from: "session" }),
    ]);
    expect((await host.sessions.create()).id).not.toBe(session.id);
  });

  it("announces a client's configure of a session-scope setting to watchers and the catalog", async () => {
    let handle: Setting<unknown> | undefined;

    const { session } = await loaded(
      [
        {
          id: "mixer",
          activate(api) {
            handle = api.contribute.settings.add({ ...volume, scope: "session" });
          },
        },
      ],
      {
        resolveConfiguration: async ({ selected, patch }) => ({
          ...configuration,
          settings: { ...selected?.settings, ...patch?.settings },
        }),
      },
    );

    assert(handle !== undefined);
    const values = handle.watch()[Symbol.asyncIterator]();

    expect(await values.next()).toEqual({ done: false, value: 3 });
    expect(await session.configure({ settings: { volume: 6 } })).toMatchObject({
      kind: "configured",
    });
    expect(await values.next()).toEqual({ done: false, value: 6 });
    expect((await session.view()).catalog.settings).toEqual([
      expect.objectContaining({ id: "volume", value: 6, from: "session" }),
    ]);
    await values.return?.();
  });

  it("reads a session-scope value from the session's configuration", async () => {
    let handle: Setting<unknown> | undefined;

    const { session } = await loaded(
      [
        {
          id: "mixer",
          activate(api) {
            handle = api.contribute.settings.add({ ...volume, scope: "session" });
          },
        },
      ],
      {
        resolveConfiguration: async ({ selected, patch }) => ({
          ...configuration,
          settings: { ...selected?.settings, ...patch?.settings },
        }),
      },
    );

    assert(handle !== undefined);
    await handle.set(5);

    expect(await handle.get()).toBe(5);
    expect((await session.view()).catalog.settings).toEqual([
      expect.objectContaining({ id: "volume", value: 5, from: "session" }),
    ]);
  });
});

describe("plugin storage", () => {
  it("rejects slash-delimited ids and keys while permitting distinct plugin names", async () => {
    let storage: PluginStorage | undefined;

    const { kernel, host } = await loaded([
      { id: "a", activate: (api) => void (storage = api.storage) },
    ]);

    const report = await host.plugins.check([{ id: "a/b" }, { id: "settingsx" }, { id: "ok" }]);

    expect(report.plugins.map((outcome) => [outcome.kind, outcome.id])).toEqual([
      ["rejected", "a/b"],
      ["activated", "settingsx"],
      ["activated", "ok"],
    ]);

    assert(storage !== undefined);
    await expect(storage.set("b/c", 1)).rejects.toMatchObject({ code: "invalid" });
    await expect(storage.at("host").get("b/c")).rejects.toMatchObject({ code: "invalid" });
    await expect(storage.secrets.set("b/c", "x")).rejects.toMatchObject({ code: "invalid" });
    expect(await kernel.store.refs.list("kv/")).toEqual([]);
  });

  it("keeps keys per scope: session by default, host and workspace through at()", async () => {
    const storages: PluginStorage[] = [];

    const keeper: Plugin<"core"> = {
      id: "keeper",
      activate: (api) => void storages.push(api.storage),
    };

    const { kernel, host, session } = await loaded([keeper]);
    const [storage] = storages;
    assert(storage !== undefined);

    await storage.set("seen", 1);
    await storage.at("host").set("seen", 2);
    await storage.at("workspace").set("seen", { count: 3 });

    expect(await storage.get("seen")).toBe(1);
    expect(await storage.at("host").get("seen")).toBe(2);
    expect(await storage.at("workspace").get("seen")).toEqual({ count: 3 });
    expect(await storage.keys()).toEqual(["seen"]);

    for (const name of [
      kvRef(`session:${session.id}`, "keeper", "seen"),
      kvRef("host", "keeper", "seen"),
      kvRef(`workspace:${workspace}`, "keeper", "seen"),
    ])
      expect(await kernel.store.refs.get(name)).not.toBeNull();

    await host.sessions.create();
    const other = storages[1];
    assert(other !== undefined);

    expect(await other.get("seen")).toBeUndefined();
    expect(await other.at("host").get("seen")).toBe(2);
    expect(await other.at("workspace").get("seen")).toEqual({ count: 3 });

    await storage.delete("seen");

    expect(await storage.get("seen")).toBeUndefined();
    expect(await storage.keys()).toEqual([]);
  });

  it("round-trips a secret encrypted at rest, and answers unavailable without a key", async () => {
    let secrets: PluginStorage["secrets"] | undefined;

    const vault: Plugin<"core"> = {
      id: "vault",
      activate: (api) => void (secrets = api.storage.secrets),
    };

    const { kernel } = await loaded([vault], {
      secrets: { key: async () => new Uint8Array(32).fill(7) },
    });

    assert(secrets !== undefined);
    await secrets.set("token", "sk-123");
    const ref = await kernel.store.refs.get(kvRef("secret", "vault", "token"));
    assert(ref !== null && ref.target !== null);

    expect(await secrets.get("token")).toBe("sk-123");
    expect(JSON.stringify(await kernel.store.objects.get(ref.target))).not.toContain("sk-123");

    await secrets.delete("token");

    expect(await secrets.get("token")).toBeUndefined();

    await loaded([vault]);

    await expect(secrets.set("token", "sk-123")).rejects.toMatchObject({ code: "unavailable" });
    expect(await secrets.get("token")).toBeUndefined();
  });
});
