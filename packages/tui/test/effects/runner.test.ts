/**
 * The runner against `fakeHost`:
 * - withdraw calls `withdraw(messageId)` on the session port (the receipt id is the message id)
 *   only when the latest state still shows the row pending;
 * - a plugin reject answers `send-refused` with the snapshot, and the app test sees the draft come back;
 * - a handler that throws writes the crash log and dispatches `effect-failed`; later effects still run;
 * - a watch that ends dispatches `watch-ended`, never hangs `follow`.
 */
import { asId } from "@nyte-ai/schema";
import type { Configuration, SessionView, Thinking } from "@nyte-ai/sdk";
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { BootOptions } from "../../src/effects/boot.ts";
import { createRunner } from "../../src/effects/runner.ts";
import type { Runner } from "../../src/effects/runner.ts";
import type { Msg } from "../../src/model/msg.ts";
import type { FollowedSession, State, Submission } from "../../src/model/state.ts";
import { until } from "../fixture/host.ts";
import { fakeHost, fakePorts } from "../fixture/ports.ts";
import type { FakePorts } from "../fixture/ports.ts";
import { SETTINGS, stateOf } from "../fixture/state.ts";
import { CONFIGURATION, followed, viewOf } from "../fixture/view.ts";

const skipVersionCheck = process.env["NYTE_SKIP_VERSION_CHECK"];

beforeAll(() => {
  process.env["NYTE_SKIP_VERSION_CHECK"] = "1";
});

afterAll(() => {
  if (skipVersionCheck === undefined) delete process.env["NYTE_SKIP_VERSION_CHECK"];
  else process.env["NYTE_SKIP_VERSION_CHECK"] = skipVersionCheck;
});

interface Harness {
  readonly runner: Runner;
  readonly ports: FakePorts;
  readonly dispatched: Msg[];
  set(state: State): void;
  /** Resolves with the first dispatched message of `kind` once it arrives. */
  received<K extends Msg["kind"]>(kind: K): Promise<Extract<Msg, { readonly kind: K }>>;
}

function harness(initial: State): Harness {
  const host = fakeHost();
  const ports = fakePorts(host);
  const dispatched: Msg[] = [];
  let state = initial;
  const controller = new AbortController();

  const runner = createRunner({
    ports,
    dispatch: (msg) => {
      dispatched.push(msg);
    },
    read: () => state,
    signal: controller.signal,
  });

  const received = <K extends Msg["kind"]>(kind: K): Promise<Extract<Msg, { readonly kind: K }>> =>
    until(() =>
      dispatched.find((msg): msg is Extract<Msg, { readonly kind: K }> => msg.kind === kind),
    );

  return {
    runner,
    ports,
    dispatched,
    set: (next) => {
      state = next;
    },
    received,
  };
}

const PENDING: SessionView = viewOf((v) =>
  v
    .turn("t1", (t) => t.user("go").text("working", { live: true }))
    .pending("later", { schedule: { kind: "next-turn", reason: "requested" } }, { id: "m2" })
    .live(),
);

const LANDED: SessionView = viewOf((v) =>
  v
    .turn("t1", (t) => t.user("go").user("later", { id: "m2" }).text("done").ended("completed"))
    .idle(),
);

test("withdraw reaches the session port only while the latest state shows the row pending", async () => {
  const app = harness(stateOf(followed(PENDING)));
  const session = app.ports.host.addSession("s1");
  app.runner.run({ kind: "withdraw", session: asId("s1"), message: asId("m2") });
  await app.runner.settled();
  expect(session.calls.withdraw).toEqual(["m2"]);
  expect(app.dispatched).toEqual([{ kind: "withdrawn", message: asId("m2"), result: "withdrawn" }]);

  app.set(stateOf(followed(LANDED)));
  app.runner.run({ kind: "withdraw", session: asId("s1"), message: asId("m2") });
  await app.runner.settled();
  expect(session.calls.withdraw).toEqual(["m2"]);

  expect(app.dispatched.at(-1)).toEqual({
    kind: "withdrawn",
    message: asId("m2"),
    result: "landed-first",
  });

  app.runner.run({ kind: "withdraw", session: asId("s1"), message: asId("m9") });
  await app.runner.settled();
  expect(session.calls.withdraw).toEqual(["m2"]);
  expect(app.dispatched.at(-1)).toEqual({ kind: "withdrawn", message: asId("m9"), result: "gone" });
});

test("a plugin command the plugin does not know goes back as a message with its delivery", async () => {
  const app = harness(stateOf(followed(LANDED)));
  const session = app.ports.host.addSession("s1");
  session.commandResult = { kind: "unknown" };

  app.runner.run({
    kind: "run-command",
    session: asId("s1"),
    name: "qa-probe",
    argument: "x",
    delivery: "steer",
  });

  await app.runner.settled();
  expect(session.calls.commands).toEqual([{ name: "qa-probe", argument: "x" }]);
  expect(app.dispatched).toEqual([
    {
      kind: "command-unknown",
      session: asId("s1"),
      name: "qa-probe",
      argument: "x",
      delivery: "steer",
    },
  ]);
});

test("the adapter's honest answer passes through: a stop that settled as a run end is landed-first", async () => {
  const app = harness(stateOf(followed(PENDING)));
  const session = app.ports.host.addSession("s1");
  session.withdrawResult = "landed-first";
  app.runner.run({ kind: "withdraw", session: asId("s1"), message: asId("m2") });
  await app.runner.settled();
  expect(app.dispatched).toEqual([
    { kind: "withdrawn", message: asId("m2"), result: "landed-first" },
  ]);
});

test("revise re-checks the row the same way and never edits a landed message", async () => {
  const app = harness(stateOf(followed(LANDED)));
  const session = app.ports.host.addSession("s1");

  app.runner.run({
    kind: "revise",
    session: asId("s1"),
    message: asId("m2"),
    content: "now",
    delivery: "steer",
    position: null,
  });

  await app.runner.settled();
  expect(session.calls.revise).toEqual([]);
  expect(app.dispatched).toEqual([
    { kind: "revised", message: asId("m2"), result: "landed-first" },
  ]);

  app.set(stateOf(followed(PENDING)));

  app.runner.run({
    kind: "revise",
    session: asId("s1"),
    message: asId("m2"),
    content: "now",
    delivery: "steer",
    position: { kind: "last" },
  });

  await app.runner.settled();
  expect(session.calls.revise).toEqual([{ message: "m2", content: "now" }]);
  expect(app.dispatched.at(-1)).toEqual({
    kind: "revised",
    message: asId("m2"),
    result: "revised",
  });
});

const SUBMISSION: Submission = {
  id: "sub-1",
  session: asId("s1"),
  replace: null,
  snapshot: {
    text: "hello [File notes.md]",
    parts: new Map([
      ["[File notes.md]", { kind: "file", path: "/tmp/notes.md", directory: false }],
    ]),
  },
};

test("a plugin reject answers send-refused with the snapshot and sends nothing", async () => {
  const app = harness(stateOf(followed(PENDING)));
  const session = app.ports.host.addSession("s1");
  app.ports.plugins.decision = { kind: "reject", reason: "Not now." };
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  app.runner.run({ kind: "send", submission: SUBMISSION, delivery: "steer" });
  await app.runner.settled();

  expect(app.dispatched.at(-1)).toEqual({
    kind: "send-refused",
    submission: "sub-1",
    reason: "Not now.",
    snapshot: SUBMISSION.snapshot,
  });

  expect(session.calls.send).toEqual([]);
  expect(app.ports.plugins.submitted).toEqual([
    { content: "hello @file:///tmp/notes.md", delivery: "steer", session: asId("s1") },
  ]);
});

test("a plugin that throws is a refusal with its message, and file bodies inline when readable", async () => {
  const app = harness(stateOf(followed(PENDING)));
  const session = app.ports.host.addSession("s1");
  app.ports.files.texts.set("/tmp/notes.md", "line one");
  app.ports.plugins.decision = { kind: "throw", message: "hook exploded" };
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  app.runner.run({ kind: "send", submission: SUBMISSION, delivery: "queue" });
  await app.runner.settled();

  expect(app.dispatched.at(-1)).toMatchObject({ kind: "send-refused", reason: "hook exploded" });
  expect(app.ports.plugins.submitted[0]?.content).toBe(
    'hello <file src="file:///tmp/notes.md">\nline one\n</file>',
  );
  expect(session.calls.send).toEqual([]);
  expect(app.ports.log.entries).toEqual([]);
});

test("an accepted send reaches the session with its delivery and answers sent", async () => {
  const app = harness(stateOf(followed(PENDING)));
  const session = app.ports.host.addSession("s1");
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  app.runner.run({ kind: "send", submission: SUBMISSION, delivery: "queue" });
  await app.runner.settled();
  expect(session.calls.send).toEqual([
    { content: "hello @file:///tmp/notes.md", delivery: "queue" },
  ]);
  expect(app.dispatched.at(-1)).toEqual({
    kind: "sent",
    submission: "sub-1",
    message: asId("sent-1"),
  });
});

test("a saved edit sends with replace while its message is pending, and is refused once it landed", async () => {
  const app = harness(stateOf(followed(PENDING)));
  const session = app.ports.host.addSession("s1");
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  const edit: Submission = { ...SUBMISSION, id: "sub-2", replace: asId("m2") };
  app.runner.run({ kind: "send", submission: edit, delivery: "queue" });
  await app.runner.settled();
  expect(session.calls.send).toEqual([
    { content: "hello @file:///tmp/notes.md", delivery: "queue" },
  ]);
  expect(app.dispatched.at(-1)).toMatchObject({ kind: "sent", submission: "sub-2" });

  app.set(stateOf(followed(LANDED)));
  app.runner.run({ kind: "send", submission: { ...edit, id: "sub-3" }, delivery: "queue" });
  await app.runner.settled();
  expect(session.calls.send).toHaveLength(1);
  expect(app.dispatched.at(-1)).toMatchObject({ kind: "send-refused", submission: "sub-3" });
});

test("a handler that throws writes the crash log and answers effect-failed; later effects still run", async () => {
  const app = harness(stateOf(followed(PENDING)));
  app.ports.files.pasteResult = new Error("disk on fire");

  app.runner.run({
    kind: "resolve-paste",
    generation: 1,
    text: "x",
    bytes: null,
    cwd: "/tmp",
  });

  app.runner.run({ kind: "copy", text: "kept" });
  await app.runner.settled();
  expect(app.ports.log.entries).toMatchObject([
    { origin: "effect", error: { message: "disk on fire" } },
  ]);
  expect(app.dispatched).toEqual([
    { kind: "effect-failed", effect: "resolve-paste", message: "disk on fire" },
  ]);
  expect(app.ports.terminal.copies).toEqual(["kept"]);
});

test("follow opens the session, forwards views, and a watch that ends becomes watch-ended without hanging", async () => {
  const app = harness(stateOf(null));
  const session = app.ports.host.addSession("s1");
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  expect(app.dispatched[0]).toMatchObject({ kind: "session-opened", session: asId("s1") });

  session.push(PENDING);
  const view = await app.received("view");
  expect(view.view).toBe(PENDING);
  await until(() => (app.ports.plugins.switches.length > 0 ? true : undefined));
  expect(app.ports.plugins.switches).toEqual([{ previous: null, next: asId("s1") }]);

  session.end(null);
  const ended = await app.received("watch-ended");
  expect(ended).toEqual({ kind: "watch-ended", session: asId("s1"), failure: null });
  expect(app.ports.log.entries).toEqual([]);
});

test("with nothing selected, the shown selection follows the view's effective configuration", async () => {
  const app = harness(stateOf(followed(PENDING)));
  const session = app.ports.host.addSession("s1");
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  const resolved = { ...CONFIGURATION, thinking: "minimal" } satisfies Configuration;
  const resolving = { ...PENDING, configuration: { selected: null, effective: resolved } };
  app.set(stateOf(followed(resolving)));
  session.push(resolving);
  const selection = await app.received("selection");

  expect(selection).toEqual({
    kind: "selection",
    session: asId("s1"),
    selection: { model: CONFIGURATION.model, effort: "minimal", fast: false },
  });
});

test("a watch that throws is logged and reported once, even when it ends before any view", async () => {
  const app = harness(stateOf(null));
  const session = app.ports.host.addSession("s1");
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  session.end("link lost");
  const ended = await app.received("watch-ended");
  expect(ended).toEqual({ kind: "watch-ended", session: asId("s1"), failure: "link lost" });
  expect(app.ports.log.entries).toMatchObject([
    { origin: "watch", error: { message: "link lost" } },
  ]);
  await Bun.sleep(10);
  expect(app.dispatched.filter((msg) => msg.kind === "watch-ended")).toHaveLength(1);
});

test("following another session stops the previous watch; its late views are dropped", async () => {
  const app = harness(stateOf(null));
  const first = app.ports.host.addSession("s1");
  const second = app.ports.host.addSession("s2");
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  app.runner.run({ kind: "follow", target: asId("s2"), announce: false });
  await app.runner.settled();
  first.push(PENDING);
  second.push(LANDED);
  const view = await app.received("view");
  expect(view).toMatchObject({ session: asId("s2") });
  await Bun.sleep(10);
  expect(app.dispatched.filter((msg) => msg.kind === "view")).toHaveLength(1);
  expect(app.dispatched.filter((msg) => msg.kind === "watch-ended")).toHaveLength(0);
});

test("configure goes through the configurator: the session port receives the patch and the selection fact leads", async () => {
  const app = harness(stateOf(followed(PENDING)));
  const session = app.ports.host.addSession("s1");
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  app.runner.run({
    kind: "configure",
    session: asId("s1"),
    selection: { effort: "high", fast: true },
  });
  await app.runner.settled();

  expect(session.calls.configure).toEqual([
    { model: { provider: "test", id: "model-fast" }, effort: "high" },
  ]);

  const selection = app.dispatched.find((msg) => msg.kind === "selection");
  expect(selection).toEqual({
    kind: "selection",
    session: asId("s1"),
    selection: { model: { provider: "test", id: "model-fast" }, effort: "high", fast: true },
  });

  expect(app.ports.host.defaults).toEqual([{ provider: "test", id: "model-fast" }]);
});

function remembering(level: Thinking, session: FollowedSession | null = null): State {
  const state = stateOf(session);

  return { ...state, facts: { ...state.facts, settings: { ...SETTINGS, thinkingLevel: level } } };
}

test("an acknowledged thinking level is saved as the default; a model-only choice saves none", async () => {
  const app = harness(stateOf(followed(PENDING)));
  app.ports.host.addSession("s1");
  app.runner.run({ kind: "follow", target: asId("s1"), announce: false });
  await app.runner.settled();
  app.runner.run({
    kind: "configure",
    session: asId("s1"),
    selection: { model: { provider: "test", id: "model-fast" } },
  });
  await app.runner.settled();
  app.runner.run({ kind: "configure", session: asId("s1"), selection: { effort: "high" } });
  await app.runner.settled();

  const saved = await app.received("settings");
  expect(saved.settings.thinkingLevel).toBe("high");
  expect(await app.ports.settings.read("/tmp")).toMatchObject({ thinkingLevel: "high" });
  expect(app.dispatched.filter((msg) => msg.kind === "settings")).toHaveLength(1);
});

test("a session the TUI creates starts at the remembered level, clamped to its model", async () => {
  const app = harness(remembering("xhigh"));
  app.runner.run({ kind: "follow", target: "new", announce: false });
  await app.runner.settled();

  expect(app.ports.host.sessions.get("created-1")?.calls.configure).toEqual([{ effort: "high" }]);
  expect(app.dispatched[0]).toMatchObject({ kind: "session-opened", session: asId("created-1") });
});

test("without a remembered level a created session keeps the level core gave it", async () => {
  const app = harness(stateOf(null));
  app.runner.run({ kind: "follow", target: "new", announce: false });
  await app.runner.settled();

  expect(app.ports.host.sessions.get("created-1")?.calls.configure).toEqual([]);
});

test("at boot --effort wins over the remembered level, and a resumed session keeps its own", async () => {
  const boots: readonly {
    readonly target: BootOptions["target"];
    readonly effort: Thinking | null;
    readonly session: string;
    readonly configure: readonly { readonly effort: Thinking }[];
  }[] = [
    { target: { kind: "new" }, effort: null, session: "created-1", configure: [{ effort: "low" }] },
    { target: { kind: "new" }, effort: "high", session: "created-1", configure: [] },
    { target: { kind: "session", id: asId("s1") }, effort: null, session: "s1", configure: [] },
  ];

  for (const boot of boots) {
    const app = harness(remembering("low"));
    app.runner.boot({
      home: "/tmp",
      cwd: "/tmp",
      target: boot.target,
      model: null,
      effort: boot.effort,
    });
    await app.runner.settled();
    expect(await app.received("session-opened")).toMatchObject({ session: asId(boot.session) });
    expect(app.ports.host.sessions.get(boot.session)?.calls.configure).toEqual([...boot.configure]);
  }
});

test("a local shell reports its job as facts from start to end and can be stopped", async () => {
  const app = harness(stateOf(followed(PENDING)));
  app.runner.run({
    kind: "shell-start",
    id: "sh1",
    session: null,
    command: "ls",
    include: true,
    cwd: "/tmp",
  });
  await until(() => (app.ports.shell.started.length > 0 ? true : undefined));
  expect(app.dispatched[0]).toMatchObject({
    kind: "shell-job",
    job: { id: "sh1", state: { kind: "running" } },
  });
  app.ports.shell.finish("sh1", { kind: "exited", code: 0 }, "a\nb\n");
  await app.runner.settled();

  expect(app.dispatched.at(-1)).toMatchObject({
    kind: "shell-job",
    job: { id: "sh1", output: "a\nb\n", state: { kind: "exited", code: 0 }, delivered: false },
  });

  app.runner.run({
    kind: "shell-start",
    session: null,
    id: "sh2",
    command: "sleep 9",
    include: false,
    cwd: "/tmp",
  });
  await until(() => (app.ports.shell.started.length > 1 ? true : undefined));
  app.runner.run({ kind: "shell-stop", id: "sh2" });
  await app.runner.settled();
  expect(app.ports.shell.stopped).toEqual(["sh2"]);
  expect(app.dispatched.at(-1)).toMatchObject({
    kind: "shell-job",
    job: { id: "sh2", state: { kind: "cancelled" } },
  });
});

test("exit resolves the runner's exited promise with the code", async () => {
  const app = harness(stateOf(null));
  app.runner.run({ kind: "exit", code: 3 });
  expect(await app.runner.exited).toEqual({ code: 3 });
});

test("a sign-in keeps its line when the catalog refresh after it fails, and says how to retry", async () => {
  const app = harness(stateOf(followed(LANDED)));
  app.ports.host.login = async () => ({ provider: "test", name: "Test" });

  app.ports.host.refreshModels = async () => {
    throw new Error("catalog offline");
  };

  app.runner.run({ kind: "login", dialog: "auth-1", provider: "test" });

  expect(await app.received("op-finished")).toMatchObject({
    op: "auth",
    notice: {
      tone: "warning",
      text: "Signed in to Test.\nModel selection could not refresh: catalog offline. Use /model to retry.",
    },
  });
});

test("a sign-out that leaves the model in place confirms in the ok tone; a failure says error:", async () => {
  const app = harness(stateOf(followed(LANDED)));
  app.ports.host.logout = async () => ({ provider: "other", name: "Other" });
  app.runner.run({ kind: "logout", provider: "other" });

  expect(await app.received("op-finished")).toMatchObject({
    notice: { tone: "ok", text: "Signed out of Other." },
  });

  const failing = harness(stateOf(followed(LANDED)));

  failing.ports.host.logout = async () => {
    throw new Error("keychain locked");
  };

  failing.runner.run({ kind: "logout", provider: "other" });

  expect(await failing.received("op-finished")).toMatchObject({
    notice: { tone: "error", text: "error: keychain locked" },
  });
});

test("a rename of the followed chat in the session directory reaches its info, so the title follows", async () => {
  const state = stateOf(followed(LANDED));
  const app = harness(state);
  const info = state.facts.session?.info;

  app.runner.boot({
    home: "/tmp",
    cwd: "/tmp",
    target: { kind: "session", id: asId("s1") },
    model: null,
    effort: null,
  });

  if (info === undefined) throw new Error("The fixture follows s1.");
  app.ports.host.publishSessions([info]);
  app.ports.host.publishSessions([{ ...info, name: "Renamed chat" }]);

  expect(await app.received("session-info")).toMatchObject({
    session: asId("s1"),
    info: { name: "Renamed chat" },
  });
  expect(app.dispatched.filter((msg) => msg.kind === "session-info")).toHaveLength(1);
});
