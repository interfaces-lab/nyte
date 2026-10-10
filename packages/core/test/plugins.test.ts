import { asId, asSeq, standard } from "@nyte-ai/schema";
import type {
  Json,
  PartId,
  Schema,
  SessionCatalogView,
  SessionId,
  ToolOutcome,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import {
  ALL_AUTHORITY,
  LOCAL,
  SdkError,
  callRef,
  decodeCallRecord,
  decodePartRecord,
  definePart,
  executeCall,
  kvRef,
  startRun,
  systemPromptPlugin,
  text,
} from "../src/index.ts";
import type {
  CallRecord,
  Command,
  ConnectionContext,
  EnvironmentProvider,
  Kernel,
  Plugin,
  PluginApi,
  PluginStorage,
  Setting,
  SettingDefinition,
  ToolDefinition,
} from "../src/index.ts";
import { completed, configuration, env, main, setup, until, workspace } from "./harness.ts";

const caller: ConnectionContext = {
  principal: LOCAL,
  authority: ALL_AUTHORITY,
  credential: { kind: "token", token: "x" },
  origin: null,
};

const ok: ToolOutcome = {
  kind: "ok",
  content: [{ kind: "text", text: "hi" }],
  output: null,
  parts: [],
};

const echo = {
  name: "echo",
  description: "Echo the text.\nIt says it back.",
  parameters: standard(Type.Object({ text: Type.String() })),
  class: () => ({ kind: "custom", label: "Echoing" }),
  replay: "safe",
  execute: async (args) => ({ content: [{ kind: "text", text: args.text }] }),
} satisfies ToolDefinition<{ text: string }>;

/** A schema with no JSON Schema: a plugin declaring it is rejected at load. */
const opaque: Schema<unknown> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value }),
    jsonSchema: {
      input: () => {
        throw new Error("No JSON Schema.");
      },
      output: () => {
        throw new Error("No JSON Schema.");
      },
    },
  },
};

const volume: SettingDefinition<number> = {
  id: "volume",
  label: "Volume",
  schema: standard(Type.Integer({ minimum: 0 })),
  default: 3,
  scope: "host",
};

const theme: SettingDefinition<string> = {
  id: "theme",
  label: "Theme",
  schema: standard(Type.Union([Type.Literal("light"), Type.Literal("dark")])),
  choices: [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark", badge: "new" },
  ],
  default: "light",
  scope: "host",
};

/** A consent modal a gate creates and waits on: no `onAction`, so its first act answers it. */
const approve = definePart({
  kind: "gate/approve",
  state: standard(Type.Object({ tool: Type.String() })),
  actions: {
    allow: { input: standard(Type.Object({})) },
    deny: { input: standard(Type.Object({})) },
  },
  fallback: (state, { id }) => `Allow ${state.tool}? (${id})`,
});

/** Returns the ids of a session's stored parts of the consent kind. */
async function approvals(kernel: Kernel, session: SessionId): Promise<readonly PartId[]> {
  const stored = await Promise.all(
    (await kernel.store.refs.list(`sessions/${session}/parts/`)).map(async (ref) =>
      decodePartRecord(ref.target === null ? null : await kernel.store.objects.get(ref.target)),
    ),
  );

  return stored.flatMap((record) => (record?.partKind === approve.kind ? [record.id] : []));
}

/** Returns a command that answers with its text. */
function says(name: string, answer: string): Command {
  return { name, title: name, description: `Says ${answer}.`, run: () => answer };
}

/** Returns an environment provider of a kind that serves nothing. */
function provider(kind: string): EnvironmentProvider {
  return {
    kind,
    inspect: async () => ({
      identity: asId("identity"),
      availability: { kind: "available" },
      projectSources: [],
    }),
    attach: async () => env,
  };
}

/** Creates a session on a kernel whose host plugins are `plugins`, so the session loads them. */
async function loaded(plugins: readonly Plugin<"core">[], options?: Parameters<typeof setup>[0]) {
  const built = await setup(options);
  built.kernel.hostPlugins = plugins;
  const session = await built.host.sessions.create();

  return { ...built, session, runtime: built.kernel.pluginsFor(session.id) };
}

async function readCall(kernel: Kernel, session: SessionId, id: string): Promise<CallRecord> {
  const ref = await kernel.store.refs.get(callRef(session, asId<"call">(id)));
  const record = decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
  assert(record !== null);

  return record;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("plugin runtime", () => {
  it("loads in order: activated, a duplicate id rejected twice, a second environment kind and a schema without JSON Schema rejected, a throwing activate rolled back", async () => {
    let deactivated: AbortSignal | undefined;

    const broken: Plugin<"core"> = {
      id: "broken",
      hooks: {
        after_tool: () => {
          throw new Error("Still registered.");
        },
      },
      activate(api) {
        deactivated = api.signal;
        api.contribute.tools.add({ ...echo, name: "half" });

        throw new Error("No config.");
      },
    };

    const { kernel, session, runtime } = await loaded([]);

    const outcomes = await runtime.load([
      { id: "tools", contribute: { tools: [echo] }, environment: provider("local") },
      { id: "twin" },
      { id: "twin" },
      { id: "sandbox", environment: provider("local") },
      { id: "opaque", contribute: { commands: [{ ...says("odd", "odd"), arguments: opaque }] } },
      broken,
    ]);

    expect(outcomes.map((outcome) => [outcome.id, outcome.kind])).toEqual([
      ["tools", "activated"],
      ["twin", "rejected"],
      ["twin", "rejected"],
      ["sandbox", "rejected"],
      ["opaque", "rejected"],
      ["broken", "rejected"],
    ]);
    expect(outcomes[3]?.issues).toEqual([
      {
        severity: "error",
        path: ["environment"],
        message: "Another plugin provides the local environment.",
        source: { plugin: "sandbox" },
      },
    ]);
    expect(outcomes[4]?.issues).toEqual([
      expect.objectContaining({ path: ["commands", "odd", "arguments"] }),
    ]);
    expect(outcomes[5]?.issues).toEqual([
      {
        severity: "error",
        path: ["activate"],
        message: "Activation failed: No config.",
        source: { plugin: "broken" },
      },
    ]);
    expect(deactivated?.aborted).toBe(true);
    expect(runtime.api("broken")).toBeUndefined();
    expect(
      kernel
        .tools(session.id, null)
        .list()
        .map((tool) => tool.name),
    ).toEqual(["echo"]);
    expect(
      await runtime.hooks.transform("after_tool", ok, {
        session: session.id,
        head: main,
        run: null,
        principal: LOCAL,
      }),
    ).toEqual(ok);
    expect(kernel.host.current().plugins.map((row) => [row.id, row.issues.length])).toEqual([
      ["tools", 0],
      ["twin", 2],
      ["sandbox", 1],
      ["opaque", 1],
      ["broken", 1],
    ]);
  });

  it("replaces by id: a new version activates, a failing one keeps the previous, an absent one deactivates", async () => {
    let first: AbortSignal | undefined;
    let gone: AbortSignal | undefined;
    let starts = 0;

    const { kernel, host, session } = await loaded([
      {
        id: "greeter",
        contribute: { commands: [says("hello", "v1")] },
        activate(api) {
          first = api.signal;
        },
      },
      {
        id: "gone",
        activate(api) {
          gone = api.signal;
        },
      },
    ]);

    const v2: Plugin<"core"> = {
      id: "greeter",
      contribute: { commands: [says("hello", "v2")] },
      activate() {
        starts += 1;
      },
    };

    const replaced = await host.plugins.replace([v2], { session: session.id });

    expect(replaced.plugins).toEqual([{ kind: "activated", id: "greeter", issues: [] }]);
    expect(replaced.generation).toBe(kernel.host.current().catalog);
    expect([first?.aborted, gone?.aborted]).toEqual([true, true]);
    expect(await session.command("hello")).toEqual({ kind: "ran", output: "v2" });

    const failing = await host.plugins.replace(
      [
        {
          id: "greeter",
          activate() {
            throw new Error("Broken build.");
          },
        },
      ],
      { session: session.id },
    );

    expect(failing.plugins).toEqual([
      {
        kind: "kept-previous",
        id: "greeter",
        issues: [expect.objectContaining({ message: "Activation failed: Broken build." })],
      },
    ]);
    expect(await session.command("hello")).toEqual({ kind: "ran", output: "v2" });
    expect(starts).toBe(2);

    const unparsable = await host.plugins.replace(
      [{ id: "greeter", contribute: { tools: [{ ...echo, parameters: opaque }] } }],
      { session: session.id },
    );

    expect(unparsable.plugins.map((outcome) => outcome.kind)).toEqual(["kept-previous"]);
    expect(starts).toBe(2);
    expect(await session.command("hello")).toEqual({ kind: "ran", output: "v2" });

    const fresh = await host.plugins.replace(
      [{ id: "new", activate: () => Promise.reject(new Error("No.")) }],
      {
        session: session.id,
      },
    );

    expect(fresh.plugins.map((outcome) => outcome.kind)).toEqual(["rejected"]);
    expect(await session.command("hello")).toEqual({ kind: "unknown" });
  });

  it("replaces host-wide: every live session and the plugins new sessions load", async () => {
    const { kernel, host, session } = await loaded([
      { id: "greeter", contribute: { commands: [says("hello", "v1")] } },
    ]);

    const report = await host.plugins.replace([
      { id: "greeter", contribute: { commands: [says("hello", "v2")] } },
    ]);

    expect(report.plugins).toEqual([{ kind: "activated", id: "greeter", issues: [] }]);
    expect(await session.command("hello")).toEqual({ kind: "ran", output: "v2" });

    const later = await host.sessions.create();

    expect(await later.command("hello")).toEqual({ kind: "ran", output: "v2" });
    expect(kernel.hostPlugins.map((plugin) => plugin.id)).toEqual(["greeter"]);
  });

  it("checks without loading: outcomes and the collisions between plugins", async () => {
    const { kernel, host } = await setup();

    const report = await host.plugins.check([
      { id: "a", contribute: { tools: [echo], settings: [volume] } },
      { id: "b", contribute: { tools: [echo], parts: [text] } },
      { id: "c", contribute: { settings: [{ ...volume, schema: opaque }] } },
    ]);

    expect(report.plugins).toEqual([
      { kind: "activated", id: "a", issues: [] },
      { kind: "activated", id: "b", issues: [] },
      {
        kind: "rejected",
        id: "c",
        issues: [expect.objectContaining({ severity: "error", path: ["settings", "volume"] })],
      },
    ]);
    expect(report.collisions).toEqual([
      {
        severity: "warning",
        path: ["tools", "echo"],
        message: "echo from b collides with the one from a.",
        source: { plugin: "b" },
      },
      {
        severity: "warning",
        path: ["parts", "text"],
        message: "text is a built-in part kind; b's definition is ignored.",
        source: { plugin: "b" },
      },
      {
        severity: "warning",
        path: ["settings", "volume"],
        message: "volume from c collides with the one from a.",
        source: { plugin: "c" },
      },
    ]);
    expect(kernel.runtimes().size).toBe(0);
    expect(kernel.host.current().plugins).toEqual([]);
  });

  it("closes a removed session's plugins and forgets its runtime", async () => {
    let signal: AbortSignal | undefined;

    const { kernel, session } = await loaded([
      {
        id: "keeper",
        activate(api) {
          signal = api.signal;
        },
      },
    ]);

    expect(await session.remove()).toEqual({ kind: "removed" });
    expect(signal?.aborted).toBe(true);
    expect(kernel.runtimes().has(session.id)).toBe(false);
  });
});

describe("hooks", () => {
  it("orders handlers by order then registration, chains transforms, observes, and short-circuits a decide on reject", async () => {
    const calls: string[] = [];

    const appended = (outcome: ToolOutcome, label: string): ToolOutcome =>
      outcome.kind === "ok"
        ? { ...outcome, content: [...outcome.content, { kind: "text", text: label }] }
        : outcome;

    const { kernel, session, runtime } = await loaded([
      {
        id: "first",
        hooks: {
          after_tool: { order: 10, run: (outcome) => appended(outcome, "first") },
          before_tool: (call) => {
            calls.push("first");

            return { action: "modify", value: { ...call, args: { text: "changed" } } };
          },
          run_ended: (end) => {
            calls.push(`ended:${end.kind}`);
          },
        },
      },
      {
        id: "second",
        hooks: {
          after_tool: { order: -1, run: (outcome) => appended(outcome, "second") },
          before_tool: {
            order: 5,
            run: (call) => {
              calls.push(`second:${JSON.stringify(call.args)}`);

              return { action: "reject", reason: "Not today." };
            },
          },
        },
      },
      {
        id: "third",
        hooks: {
          before_tool: {
            order: 9,
            run: () => {
              calls.push("third");

              return { action: "continue" };
            },
          },
        },
      },
    ]);

    const context = { session: session.id, head: main, run: null, principal: LOCAL };

    expect(await runtime.hooks.transform("after_tool", ok, context)).toEqual({
      ...ok,
      content: [...ok.content, { kind: "text", text: "second" }, { kind: "text", text: "first" }],
    });

    const decided = await runtime.hooks.decide(
      "before_tool",
      {
        call: asId("c1"),
        name: "echo",
        args: { text: "hi" },
        class: { kind: "custom", label: "Echoing" },
      },
      context,
      {
        call: asId("hook:before_tool:c1"),
        run: null,
        head: null,
        part: null,
        signal: new AbortController().signal,
      },
    );

    expect(decided).toEqual({ kind: "done", value: { action: "reject", reason: "Not today." } });
    expect(calls).toEqual(["first", 'second:{"text":"changed"}']);
    expect(await readCall(kernel, session.id, "hook:before_tool:c1")).toMatchObject({
      kind: "hook",
      intent: { name: "echo", args: { text: "hi" }, principal: LOCAL },
      result: { action: "reject", reason: "Not today." },
    });

    await runtime.hooks.observe("run_ended", completed, context);

    expect(calls.at(-1)).toBe("ended:completed");
  });

  it("parks a decide hook on a wait and replays the wait when the step runs again", async () => {
    let runs = 0;
    const due = Date.now() + 60_000;

    const { kernel, session, runtime } = await loaded([
      {
        id: "gate",
        hooks: {
          before_tool: async (_call, context) => {
            runs += 1;
            const outcome = await context.wait({ kind: "timer", until: due });

            return outcome.kind === "timer"
              ? { action: "reject", reason: "Timed out." }
              : { action: "continue" };
          },
        },
      },
    ]);

    const step = {
      call: asId<"call">("hook:before_tool:p1"),
      run: null,
      head: null,
      part: null,
      signal: new AbortController().signal,
    };

    const decide = () =>
      runtime.hooks.decide(
        "before_tool",
        { call: asId("p1"), name: "echo", args: {}, class: { kind: "custom", label: "Echoing" } },
        { session: session.id, head: main, run: null, principal: LOCAL },
        step,
      );

    expect(await decide()).toEqual({ kind: "parked" });

    await kernel.waits.tick(due);

    expect(await decide()).toEqual({
      kind: "done",
      value: { action: "reject", reason: "Timed out." },
    });
    expect(await decide()).toEqual({
      kind: "done",
      value: { action: "reject", reason: "Timed out." },
    });
    expect(runs).toBe(2);
  });

  it("creates a consent modal once across a before_tool hook's park and re-run (§35i)", async () => {
    const created: PartId[] = [];

    const { kernel, session } = await loaded([
      {
        id: "consent",
        contribute: { tools: [echo] },
        hooks: {
          before_tool: async (call, context) => {
            const part = await context.api.session.parts.create(approve, {
              state: { tool: call.name },
              placement: { kind: "modal" },
            });

            created.push(part.id);
            const outcome = await context.wait({ kind: "part", part: part.id });

            return outcome.kind === "part" && outcome.answer?.action === "allow"
              ? { action: "continue" }
              : { action: "reject", reason: "The user declined." };
          },
        },
      },
    ]);

    const run = (
      await startRun(
        kernel,
        session.id,
        main,
        { kind: "continuation", from: "wake" },
        configuration,
      )
    ).id;

    const call = () =>
      executeCall(kernel, {
        session: session.id,
        head: main,
        run,
        call: asId("g1"),
        name: "echo",
        args: { text: "hi" },
        context: caller,
        signal: new AbortController().signal,
      });

    expect(await call()).toEqual({ kind: "parked" });
    const [part] = created;
    assert(part !== undefined);

    expect(await session.part(part).act("allow", {})).toEqual({ kind: "ok", output: undefined });
    expect(await call()).toEqual(ok);
    expect(created).toEqual([part, part]);
    expect(await approvals(kernel, session.id)).toEqual([part]);
    expect(
      (await session.view()).parts
        .filter((view) => view.partKind === approve.kind)
        .map((view) => view.id),
    ).toEqual([part]);
    expect(await readCall(kernel, session.id, "hook:before_tool:g1")).toMatchObject({
      acquisitions: { "acq:0": part },
      result: { action: "continue" },
    });
  });

  it("creates a consent modal once across a before_send hook's park and re-run, then admits the send (§35i)", async () => {
    const created: PartId[] = [];

    const { kernel, session } = await loaded([
      {
        id: "consent",
        hooks: {
          before_send: async (_submission, context) => {
            const part = await context.api.session.parts.create(approve, {
              state: { tool: "send" },
              placement: { kind: "modal" },
            });

            created.push(part.id);
            const outcome = await context.wait({ kind: "part", part: part.id });

            return outcome.kind === "part" && outcome.answer?.action === "allow"
              ? { action: "continue" }
              : { action: "reject", reason: "The user declined." };
          },
        },
      },
    ]);

    const sending = session.send("hello");
    const part = await until(() => created[0]);

    expect(await session.part(part).act("allow", {})).toEqual({ kind: "ok", output: undefined });

    const receipt = await sending;

    const admitted = (await kernel.store.refs.log(session.id, asSeq(0), 100)).find(
      (event) =>
        event.kind === "input" && event.change === "admitted" && event.message === asId(receipt.id),
    );

    expect(admitted).toMatchObject({ content: "hello" });
    expect(created).toEqual([part, part]);
    expect(await approvals(kernel, session.id)).toEqual([part]);
    expect(
      (await session.view()).parts
        .filter((view) => view.partKind === approve.kind)
        .map((view) => view.id),
    ).toEqual([part]);
    expect(await readCall(kernel, session.id, `hook:before_send:${receipt.id}`)).toMatchObject({
      run: null,
      head: null,
      acquisitions: { "acq:0": part },
      result: { action: "continue" },
    });
  });

  it("aborts a handler past its budget: an observe is reported, a transform fails the operation", async () => {
    let budget: AbortSignal | undefined;

    const { kernel, session, runtime } = await loaded([
      {
        id: "slow",
        hooks: {
          run_ended: (_end, { signal }) => {
            budget = signal;

            return new Promise<void>(() => undefined);
          },
          after_tool: () => new Promise<ToolOutcome>(() => undefined),
        },
      },
    ]);

    const context = { session: session.id, head: main, run: null, principal: LOCAL };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const observed = runtime.hooks.observe("run_ended", completed, context);
    const transformed = runtime.hooks.transform("after_tool", ok, context);

    const failed = expect(transformed).rejects.toMatchObject({
      code: "internal",
      message: "Plugin slow's after_tool handler failed: exceeded its 5 s budget",
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await observed;
    await failed;

    expect(budget?.aborted).toBe(true);
    expect(kernel.host.current().plugins.find((row) => row.id === "slow")?.issues).toEqual([
      {
        severity: "error",
        path: ["hooks", "run_ended"],
        message: "Plugin slow's run_ended handler failed: exceeded its 5 s budget",
        source: { plugin: "slow" },
      },
    ]);
  });

  it("rejects a tool call through a plugin's before_tool hook in executeCall, and runs the arguments another rewrites", async () => {
    const { kernel, session } = await loaded([
      {
        id: "gate",
        contribute: { tools: [echo] },
        hooks: {
          before_tool: (call) => {
            if (JSON.stringify(call.args) === JSON.stringify({ text: "forbidden" }))
              return { action: "reject", reason: "Not that." };

            return call.args === null
              ? { action: "modify", value: { ...call, args: { text: "filled" } } }
              : { action: "continue" };
          },
        },
      },
    ]);

    const run = (
      await startRun(
        kernel,
        session.id,
        main,
        { kind: "continuation", from: "wake" },
        configuration,
      )
    ).id;

    const call = (id: string, args: Json) =>
      executeCall(kernel, {
        session: session.id,
        head: main,
        run,
        call: asId(id),
        name: "echo",
        args,
        context: caller,
        signal: new AbortController().signal,
      });

    expect(await call("r1", { text: "forbidden" })).toEqual({
      kind: "rejected",
      reason: "Not that.",
    });
    expect(await readCall(kernel, session.id, "hook:before_tool:r1")).toMatchObject({
      kind: "hook",
      run,
      head: main,
      result: { action: "reject", reason: "Not that." },
    });
    expect(await call("r2", null)).toEqual({
      kind: "ok",
      content: [{ kind: "text", text: "filled" }],
      output: null,
      parts: [],
    });
  });

  it("rejects or rewrites a send through a plugin's before_send hook", async () => {
    const { kernel, session } = await loaded([
      {
        id: "guard",
        hooks: {
          before_send: (submission) => {
            const { content } = submission;

            if (typeof content !== "string") return { action: "continue" };

            return content.includes("secret")
              ? { action: "reject", reason: "No secrets." }
              : { action: "modify", value: { ...submission, content: `${content}!` } };
          },
        },
      },
    ]);

    await expect(session.send("my secret")).rejects.toMatchObject({
      code: "invalid",
      message: "No secrets.",
    });

    const receipt = await session.send("hello");

    const admitted = (await kernel.store.refs.log(session.id, asSeq(0), 100)).find(
      (event) =>
        event.kind === "input" && event.change === "admitted" && event.message === asId(receipt.id),
    );

    expect(admitted).toMatchObject({ content: "hello!" });
    expect(await readCall(kernel, session.id, `hook:before_send:${receipt.id}`)).toMatchObject({
      kind: "hook",
      run: null,
      head: null,
      result: { action: "modify", value: { content: "hello!" } },
    });
  });
});

describe("plugin api", () => {
  it("shows a reported issue live on HostView.plugins, and marks the built-ins", async () => {
    let api: PluginApi<"core"> | undefined;

    const { host } = await loaded([
      systemPromptPlugin,
      {
        id: "mcp",
        activate(given) {
          api = given;
        },
      },
    ]);

    assert(api !== undefined);
    api.report({ severity: "warning", path: ["server"], message: "Server went away." });
    const views = host.watch()[Symbol.asyncIterator]();
    const view = await views.next();
    assert(!view.done);

    expect(view.value.plugins).toEqual([
      { id: "system-prompt", source: "builtin", path: null, issues: [] },
      {
        id: "mcp",
        source: "inline",
        path: null,
        issues: [
          {
            severity: "warning",
            path: ["server"],
            message: "Server went away.",
            source: { plugin: "mcp" },
          },
        ],
      },
    ]);
    await views.return?.();
  });

  it("derives against siblings materialised earlier in the pass, and drops a failing derive's edits", async () => {
    const { kernel, runtime } = await loaded([
      systemPromptPlugin,
      {
        id: "mcp",
        contribute: { tools: [echo] },
        activate(api) {
          api.contribute.tools.add((draft) => {
            draft.set("search", { ...echo, name: "search", exposure: "deferred" });
          });
          api.contribute.tools.add((draft) => {
            draft.delete("echo");

            throw new Error("Server down.");
          });
        },
      },
    ]);

    expect(runtime.registries.tools.list().map((tool) => tool.name)).toEqual(["echo", "search"]);
    expect(runtime.registries.prompt.list().find((section) => section.id === "tools")?.text).toBe(
      [
        "Tools in this session:",
        "- echo: Echo the text.",
        "Deferred until activated: search.",
      ].join("\n"),
    );
    expect(kernel.host.current().plugins.find((row) => row.id === "mcp")?.issues).toEqual([
      {
        severity: "error",
        path: ["tools"],
        message: "A derivation failed: Server down.",
        source: { plugin: "mcp" },
      },
    ]);
  });

  it("coalesces registry writes and reloads before a microtask into one pass", async () => {
    let passes = 0;
    let api: PluginApi<"core"> | undefined;

    const { kernel, session } = await loaded([
      {
        id: "counter",
        activate(given) {
          api = given;
          given.contribute.prompt.add(() => {
            passes += 1;
          });
        },
      },
    ]);

    assert(api !== undefined);
    const before = passes;
    api.contribute.tools.add({ ...echo, name: "a" });
    api.contribute.tools.add({ ...echo, name: "b" });
    api.reload();
    api.reload();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(passes).toBe(before + 1);
    expect(
      kernel
        .tools(session.id, null)
        .list()
        .map((tool) => tool.name),
    ).toEqual(["a", "b"]);
  });

  it("publishes the catalog as a seq-0 event a warm fold takes and a cold fold seeds, and bumps the generation", async () => {
    const { kernel, host } = await setup();
    const generation = kernel.host.current().catalog;
    const events: SessionCatalogView[] = [];

    kernel.bus.subscribeAll((_session, event) => {
      if (event.kind === "catalog") events.push(event.catalog);
    });

    kernel.hostPlugins = [
      {
        id: "greeter",
        contribute: {
          commands: [{ ...says("hello", "hi"), category: "Fun" }],
          agents: [{ id: "reviewer", description: "Reviews.", mode: "subagent" }],
          skills: [
            { name: "lint", description: "Lints.", location: "/skills/lint", load: async () => "" },
          ],
          tools: [{ ...echo, exposure: "deferred" }],
        },
      },
    ];

    const session = await host.sessions.create();

    const catalog: SessionCatalogView = {
      commands: [
        {
          name: "greeter/hello",
          owner: "greeter",
          side: "core",
          title: "hello",
          description: "Says hi.",
          arguments: null,
          category: "Fun",
        },
      ],
      settings: [],
      skills: [{ name: "lint", owner: "greeter", description: "Lints.", location: "/skills/lint" }],
      agents: [
        {
          id: "reviewer",
          owner: "greeter",
          description: "Reviews.",
          model: null,
          mode: "subagent",
        },
      ],
      tools: [
        {
          name: "echo",
          owner: "greeter",
          description: echo.description,
          parameters: expect.objectContaining({ type: "object" }),
          output: null,
          exposure: "deferred",
        },
      ],
    };

    expect(events).toEqual([catalog]);
    expect((await session.view()).catalog).toEqual(catalog);
    expect(kernel.host.current().catalog).not.toBe(generation);

    const hold = kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();
    await host.plugins.replace([], { session: session.id });

    expect(hold.state().catalog.commands).toEqual([]);
    hold.release();
  });

  it("activates a deferred tool for one run until the run ends", async () => {
    const { kernel, host, session, script } = await loaded([
      { id: "lazy", contribute: { tools: [{ ...echo, exposure: "deferred" }] } },
    ]);

    await session.send("go");
    const step = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    const run = turn.input.run.id;
    await kernel.tools(session.id, run).activate(["echo"]);

    expect(
      kernel
        .tools(session.id, run)
        .list()
        .map((tool) => tool.exposure),
    ).toEqual(["model"]);
    expect(
      kernel
        .tools(session.id, null)
        .list()
        .map((tool) => tool.exposure),
    ).toEqual(["deferred"]);

    turn.finish();
    await step;

    expect(
      kernel
        .tools(session.id, run)
        .list()
        .map((tool) => tool.exposure),
    ).toEqual(["deferred"]);
  });
});

describe("commands", () => {
  it("answers ran, sent, invalid, unknown and failed", async () => {
    const { kernel, session } = await loaded([
      {
        id: "cmds",
        contribute: {
          commands: [
            {
              name: "say",
              title: "Say",
              description: "Says it.",
              arguments: standard(Type.String()),
              run: (args) => `said ${String(args)}`,
            },
            { name: "quiet", title: "Quiet", description: "Says nothing.", run: () => undefined },
            {
              name: "ask",
              title: "Ask",
              description: "Asks.",
              run: () => ({ prompt: "Review the diff." }),
            },
            {
              name: "boom",
              title: "Boom",
              description: "Throws.",
              run: () => {
                throw new Error("Exploded.");
              },
            },
          ],
        },
      },
      { id: "other", contribute: { commands: [says("say", "other")] } },
    ]);

    expect(await session.command("cmds/say", "hi")).toEqual({ kind: "ran", output: "said hi" });
    expect(await session.command("other/say")).toEqual({ kind: "ran", output: "other" });
    expect(await session.command("say", "hi")).toEqual({ kind: "unknown" });
    expect(await session.command("quiet")).toEqual({ kind: "ran", output: null });
    expect(await session.command("cmds/say", 3)).toMatchObject({
      kind: "invalid",
      issues: [expect.objectContaining({ severity: "error" })],
    });
    expect(await session.command("boom")).toEqual({ kind: "failed", message: "Exploded." });
    expect(await session.command("nope")).toEqual({ kind: "unknown" });

    const sent = await session.command("ask");
    assert(sent.kind === "sent");

    const admitted = (await kernel.store.refs.log(session.id, asSeq(0), 100)).find(
      (event) => event.kind === "input" && event.change === "admitted",
    );

    expect(admitted).toMatchObject({
      message: sent.receipt,
      content: "Review the diff.",
      source: { kind: "action", label: "Ask", command: "cmds/ask" },
    });
  });
});

describe("settings", () => {
  it("applies a host setting before any session, refuses an invalid value and an unknown id", async () => {
    const { kernel, host } = await setup();
    kernel.hostPlugins = [{ id: "looks", contribute: { settings: [theme] } }];

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

    const { host, session, runtime } = await loaded([
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

    await runtime.replace([]);

    expect(await values.next()).toEqual({ done: true, value: undefined });
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
