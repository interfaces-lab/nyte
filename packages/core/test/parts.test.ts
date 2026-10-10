import { Validator } from "@cfworker/json-schema";
import { asId, asSeq, standard } from "@nyte-ai/schema";
import type { Authority, Awaitable, Infer, Json, PartId, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import {
  LOCAL,
  SdkError,
  branchSummary,
  compaction,
  createConnection,
  createPartDefinitions,
  decodePartRecord,
  definePart,
  isPart,
  memoryStore,
  partRef,
  partsPlugin,
  text,
  thinking,
  tool,
  viewHead,
} from "../src/index.ts";
import type { ActionContext, ActionOutput, Kernel, PartDefinition } from "../src/index.ts";
import { label, main, recording, setup, until, usage } from "./harness.ts";

const question = definePart({
  kind: "test/question",
  state: standard(Type.Object({ title: Type.String(), choices: Type.Array(Type.String()) })),
  actions: {
    answer: { input: standard(Type.Object({ choice: Type.String() })) },
    dismiss: { input: standard(Type.Object({})) },
    confirm: {
      input: standard(Type.Object({})),
      output: standard(Type.Object({ confirmed: Type.Boolean() })),
    },
  },
  fallback: (state, { id }) => `Question ${id}: ${state.title}`,
});

const pickerState = standard(Type.Object({ picked: Type.Union([Type.String(), Type.Null()]) }));

const pickerActions = {
  pick: {
    input: standard(Type.Object({ choice: Type.String() })),
    output: standard(Type.Object({ picked: Type.String({ minLength: 1 }) })),
  },
  refuse: { input: standard(Type.Object({})) },
  crash: { input: standard(Type.Object({})) },
  hold: { input: standard(Type.Object({})) },
};

type PickerState = Infer<typeof pickerState>;

type PickerActions = typeof pickerActions;

const held: AbortSignal[] = [];

const pickerHandlers: {
  readonly [A in keyof PickerActions]: (
    input: Infer<PickerActions[A]["input"]>,
    context: ActionContext<PickerState, PickerActions>,
  ) => Awaitable<ActionOutput<PickerActions[A]>>;
} = {
  pick: async (input, context) => {
    await context.part.update({ picked: input.choice });

    return { picked: input.choice };
  },
  refuse: async () => {
    throw new SdkError("invalid", "Not this one.");
  },
  crash: async () => {
    throw new Error("Disk full.");
  },
  hold: (_input, context) =>
    new Promise((resolve) => {
      held.push(context.signal);
      context.signal.addEventListener("abort", () => resolve(undefined), { once: true });
    }),
};

const picker = definePart({
  kind: "test/picker",
  state: pickerState,
  actions: pickerActions,
  fallback: (state, { id }) => `Picker ${id}: ${state.picked ?? "nothing"}`,
  onAction: (action, input, context) => pickerHandlers[action](input, context),
});

const toolState = {
  call: "c1",
  name: "bash",
  args: { command: "ls" },
  class: { kind: "shell", command: "ls" },
  phase: "settled",
  outcome: { kind: "ok", content: [{ kind: "text", text: "README.md" }], output: null, parts: [] },
  changes: null,
};

const builtIns: readonly {
  readonly definition: PartDefinition;
  readonly good: Json;
  readonly bad: Json;
  readonly fallback: string;
}[] = [
  {
    definition: text,
    good: { markdown: "Hello\n  world.", signature: { id: "msg_1" } },
    bad: { markdown: 1, signature: null },
    fallback: "Hello world.",
  },
  {
    definition: thinking,
    good: { markdown: "Considering.", merged: 2, signature: "sig" },
    bad: { markdown: "Considering.", signature: null },
    fallback: "Thinking (2)…",
  },
  {
    definition: tool,
    good: toolState,
    bad: { ...toolState, phase: "running" },
    fallback: "bash settled ok",
  },
  {
    definition: compaction,
    good: { summary: "Built the parser.", material: null, tokensBefore: 1200, usage },
    bad: { summary: null, material: null, tokensBefore: "many", usage: null },
    fallback: "Context compacted at 1200 tokens: Built the parser.",
  },
  {
    definition: branchSummary,
    good: { markdown: "Tried a cache." },
    bad: {},
    fallback: "Branch summary: Tried a cache.",
  },
];

async function partEvents(kernel: Kernel, session: SessionId): Promise<readonly string[]> {
  return (await kernel.store.refs.log(session, asSeq(0), 100)).flatMap((event) =>
    event.kind === "part" || event.kind === "commit" ? [label(event)] : [],
  );
}

describe("parts", () => {
  it("validates each built-in's state and draws its fallback with the id", async () => {
    const id: PartId = asId("p1");

    for (const { definition, good, bad, fallback } of builtIns) {
      const validator = new Validator(
        structuredClone(
          definition.state["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
        ),
        "2020-12",
      );

      expect(validator.validate(good).valid).toBe(true);
      expect(validator.validate(bad).valid).toBe(false);
      expect(await definition.state["~standard"].validate(good)).toEqual({ value: good });
      expect((await definition.state["~standard"].validate(bad)).issues?.length).toBeGreaterThan(0);
      expect(definition.fallback(good, { id })).toBe(`${fallback} [${id}]`);
    }

    expect(text.fallback({ markdown: "x".repeat(200), signature: null }, { id })).toBe(
      `${"x".repeat(120)}… [${id}]`,
    );
    expect(
      tool.fallback(
        {
          call: asId("c1"),
          name: "two\nlines",
          args: null,
          class: { kind: "custom", label: "Two lines" },
          phase: "calling",
        },
        { id },
      ),
    ).toBe(`two lines calling [${id}]`);
    expect(await tool.actions.stop.input["~standard"].validate({})).toEqual({ value: {} });
    expect(await tool.actions.stop.input["~standard"].validate({ now: true })).toHaveProperty(
      "issues",
    );
  });

  it("registers the built-ins ownerless and ignores the identical definition contributed again", () => {
    const definitions = createPartDefinitions();

    expect(definitions.list().map((entry) => [entry.definition.kind, entry.owner])).toEqual([
      ["text", null],
      ["thinking", null],
      ["tool", null],
      ["compaction", null],
      ["branchSummary", null],
    ]);
    expect(partsPlugin.contribute?.parts).toEqual([
      text,
      thinking,
      tool,
      compaction,
      branchSummary,
    ]);

    definitions.register(text, "parts")();

    expect(definitions.get("text")).toEqual({ definition: text, owner: null });

    const dispose = definitions.register(picker, "plugin");
    definitions.register(picker, "other")();

    expect(definitions.get("test/picker")?.owner).toBe("plugin");

    const replacement = definePart({
      kind: "test/picker",
      state: pickerState,
      actions: {},
      fallback: (_state, { id }) => `Replacement ${id}`,
    });

    const disposeReplacement = definitions.register(replacement, "other");

    expect(definitions.get("test/picker")).toEqual({ definition: replacement, owner: "other" });

    dispose();

    expect(definitions.get("test/picker")).toEqual({ definition: replacement, owner: "other" });

    disposeReplacement();

    expect(definitions.get("test/picker")).toBeUndefined();
  });

  it("creates a part outside the transcript: its ref, its event, and view.parts", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    const part = await session.parts.create(question, {
      state: { title: "Deploy?", choices: ["yes", "no"] },
      placement: { kind: "panel" },
    });

    const ref = await kernel.store.refs.get(partRef(session.id, part.id));
    assert(ref !== null && ref.target !== null);

    expect(decodePartRecord(await kernel.store.objects.get(ref.target))).toMatchObject({
      id: part.id,
      partKind: "test/question",
      version: 1,
      owner: null,
      status: { kind: "live", run: null },
    });
    expect(await partEvents(kernel, session.id)).toEqual(["part:created"]);

    const view = await viewHead(kernel, { session: session.id, head: main, principal: LOCAL });

    expect(view.parts).toEqual([
      {
        id: part.id,
        partKind: "test/question",
        placement: { kind: "panel" },
        state: { title: "Deploy?", choices: ["yes", "no"] },
        version: 1,
        status: { kind: "live", run: null },
        owner: null,
      },
    ]);
    expect(view.messages).toEqual([]);
  });

  it("lands a transcript part outside a run as a commit on main in one set", async () => {
    const recorded = recording(await memoryStore().open());
    const { kernel, host } = await setup({ store: recorded.store });
    const session = await host.sessions.create();

    const part = await session.parts.create(text, {
      state: { markdown: "Hello.", signature: null },
      placement: { kind: "transcript", role: "note" },
    });

    expect(recorded.sets.at(-1)).toEqual(["part:created", "part:settled", "commit"]);

    const view = await viewHead(kernel, { session: session.id, head: main, principal: LOCAL });
    const message = view.messages[0];
    const tip = (await session.info()).heads[0]?.tip;

    assert(message !== undefined && isPart(message, text) && tip?.kind === "commit");
    expect(message.state.markdown).toBe("Hello.");
    expect(message).toMatchObject({
      id: part.id,
      role: "note",
      version: 1,
      status: { kind: "settled", commit: tip.id },
    });
    expect(isPart(message, thinking)).toBe(false);
    expect(view.parts).toEqual([]);
  });

  it("replays a create with the same id and state, and refuses another state or kind", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();
    const id: PartId = asId("q1");

    const input = {
      state: { title: "Deploy?", choices: ["yes"] },
      placement: { kind: "panel" },
      id,
    };

    expect((await session.parts.create(question, input)).id).toBe(id);
    expect((await session.parts.create(question, input)).id).toBe(id);
    expect(await partEvents(kernel, session.id)).toEqual(["part:created"]);
    await expect(
      session.parts.create(question, { ...input, state: { title: "Ship?", choices: [] } }),
    ).rejects.toMatchObject({ code: "invalid" });

    const note: PartId = asId("n1");
    await session.parts.create(text, {
      state: { markdown: "Kept.", signature: null },
      placement: { kind: "panel" },
      id: note,
    });

    await expect(
      session.parts.create(branchSummary, {
        state: { markdown: "Kept." },
        placement: { kind: "panel" },
        id: note,
      }),
    ).rejects.toMatchObject({ code: "invalid" });

    const loose: PartDefinition = question;

    await expect(
      session.parts.create(loose, {
        ...input,
        id: asId("q2"),
        state: { title: "Deploy?", choices: [1] },
      }),
    ).rejects.toMatchObject({
      code: "invalid",
      issues: [{ severity: "error", path: ["choices", "0"] }],
    });
  });

  it("refuses an uncontributed definition with onAction", async () => {
    const { host } = await setup();
    const session = await host.sessions.create();

    await expect(
      session.parts.create(picker, { state: { picked: null }, placement: { kind: "panel" } }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("updates by value and by function, and answers invalid, missing and closed", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    const part = await session.parts.create(question, {
      state: { title: "Deploy?", choices: ["yes"] },
      placement: { kind: "panel" },
    });

    expect(await part.update({ title: "Ship?", choices: ["yes"] })).toEqual({
      kind: "updated",
      version: 2,
    });
    expect(
      await part.update((current) => ({ ...current, choices: [...current.choices, "later"] })),
    ).toEqual({ kind: "updated", version: 3 });
    expect((await session.view()).parts[0]).toMatchObject({
      state: { title: "Ship?", choices: ["yes", "later"] },
      version: 3,
    });
    expect(await partEvents(kernel, session.id)).toEqual([
      "part:created",
      "part:updated",
      "part:updated",
    ]);

    const note = await session.parts.create(text, {
      state: { markdown: "Hello.", signature: null },
      placement: { kind: "status" },
    });

    expect(await session.part(note.id).update({ markdown: 1, signature: null })).toMatchObject({
      kind: "invalid",
      issues: [{ severity: "error", path: ["markdown"] }],
    });
    expect(await session.part(asId("nowhere")).update({})).toEqual({ kind: "missing" });

    await part.close();

    expect(await part.update({ title: "Late.", choices: [] })).toEqual({ kind: "closed" });
  });

  it("settles an ownerless modal's answer with its first act", async () => {
    const { host } = await setup();
    const session = await host.sessions.create();

    const part = await session.parts.create(question, {
      state: { title: "Deploy?", choices: ["yes", "no"] },
      placement: { kind: "modal" },
    });

    const answer = part.answer();

    expect(await part.act("answer", { choice: "yes" })).toEqual({ kind: "ok", output: undefined });
    expect(await answer).toEqual({ action: "answer", input: { choice: "yes" } });
    expect(await part.act("dismiss", {})).toEqual({ kind: "ok", output: undefined });
    expect(await part.answer()).toEqual({ action: "answer", input: { choice: "yes" } });
  });

  it("checks an act on a handle bound by id against the creating definition", async () => {
    const { host } = await setup();
    const session = await host.sessions.create();

    const part = await session.parts.create(question, {
      state: { title: "Deploy?", choices: ["yes"] },
      placement: { kind: "modal" },
    });

    const answer = part.answer();

    expect(await session.part(part.id).act("bogus", {})).toEqual({ kind: "unknown-action" });
    await expect(session.part(part.id).act("answer", { choice: 1 })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(await part.act("answer", { choice: "yes" })).toEqual({ kind: "ok", output: undefined });
    expect(await answer).toEqual({ action: "answer", input: { choice: "yes" } });
    await expect(session.part(asId("nowhere")).act("answer", {})).rejects.toMatchObject({
      code: "unknown",
    });
  });

  it("answers a non-modal part only at close, with null", async () => {
    const { host } = await setup();
    const session = await host.sessions.create();

    const part = await session.parts.create(question, {
      state: { title: "Deploy?", choices: ["yes"] },
      placement: { kind: "panel" },
    });

    const answer = part.answer();

    expect(await part.act("answer", { choice: "yes" })).toEqual({ kind: "ok", output: undefined });
    expect(await part.act("confirm", {})).toEqual({ kind: "ok", output: undefined });
    expect(await Promise.race([answer, Promise.resolve("pending")])).toBe("pending");

    await part.close();

    expect(await answer).toBeNull();
  });

  it("runs a contributed onAction: its output, rejected, unknown-action, invalid input and no-owner", async () => {
    const { kernel, host } = await setup();
    const dispose = kernel.partDefinitions.register(picker, "plugin");
    const session = await host.sessions.create();

    const part = await session.parts.create(picker, {
      state: { picked: null },
      placement: { kind: "panel" },
    });

    const picked = await part.act("pick", { choice: "blue" });
    assert(picked.kind === "ok");

    expect(picked.output.picked).toBe("blue");
    expect((await session.view()).parts[0]).toMatchObject({
      state: { picked: "blue" },
      version: 2,
      owner: "plugin",
    });
    expect(await part.act("refuse", {})).toEqual({ kind: "rejected", reason: "Not this one." });
    expect(await part.act("crash", {})).toEqual({ kind: "failed", message: "Disk full." });
    expect(await part.act("pick", { choice: "" })).toMatchObject({ kind: "failed" });
    expect(await session.part(part.id).act("cancel", {})).toEqual({ kind: "unknown-action" });
    await expect(session.part(part.id).act("pick", { choice: 1 })).rejects.toMatchObject({
      code: "invalid",
    });

    dispose();

    expect(await part.act("pick", { choice: "red" })).toEqual({ kind: "no-owner" });
  });

  it("closes a part: a pending act resolves closed, answer() null, and a second close resolves", async () => {
    const { kernel, host } = await setup();
    kernel.partDefinitions.register(picker, "plugin");
    const session = await host.sessions.create();

    const part = await session.parts.create(picker, {
      state: { picked: null },
      placement: { kind: "modal" },
    });

    const answer = part.answer();
    const pending = part.act("hold", {});
    const signal = await until(() => held.at(-1));

    await part.close();

    expect(await pending).toEqual({ kind: "closed" });
    expect(signal.aborted).toBe(true);
    expect(await answer).toBeNull();
    expect(await part.answer()).toBeNull();
    expect(await part.act("pick", { choice: "blue" })).toEqual({ kind: "closed" });
    await expect(part.close()).resolves.toBeUndefined();
    expect(await partEvents(kernel, session.id)).toEqual(["part:created", "part:closed"]);
    expect((await session.view()).parts).toEqual([]);
  });

  it("denies every part method to a principal without participant authority", async () => {
    const { kernel, host } = await setup();
    const session = await host.sessions.create();

    const part = await session.parts.create(question, {
      state: { title: "Deploy?", choices: [] },
      placement: { kind: "panel" },
    });

    const authority: ReadonlySet<Authority> = new Set();

    const viewer = createConnection(kernel, {
      principal: asId("viewer"),
      authority,
      credential: { kind: "token", token: "t" },
      origin: null,
    })
      .session(session.id)
      .part(part.id);

    await expect(viewer.update({})).rejects.toMatchObject({ code: "denied" });
    await expect(viewer.act("answer", {})).rejects.toMatchObject({ code: "denied" });
    await expect(viewer.answer()).rejects.toMatchObject({ code: "denied" });
    await expect(viewer.close()).rejects.toMatchObject({ code: "denied" });
  });
});
