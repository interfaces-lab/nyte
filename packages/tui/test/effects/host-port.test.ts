/**
 * `hostPort` over the real in-process host: send, withdraw, revise, answer and
 * stop round trips, each checked against the view the SDK then shows.
 */
import { openQuestions, question } from "@nyte-ai/plugin/question";
import { asId } from "@nyte-ai/schema";
import type { MessageId, SessionView } from "@nyte-ai/sdk";
import { expect, test } from "bun:test";
import { hostPort } from "../../src/effects/host-port.ts";
import type { SessionPort } from "../../src/effects/ports.ts";
import { openTestHost, until } from "../fixture/host.ts";

function userStatus(view: SessionView, id: MessageId): string | undefined {
  const message = view.messages.find((candidate) => candidate.id === id);

  return message?.kind === "user" ? message.status.kind : undefined;
}

async function viewWhere(
  session: SessionPort,
  predicate: (view: SessionView) => boolean,
): Promise<SessionView> {
  for await (const view of session.watch()) if (predicate(view)) return view;
  throw new Error("The watch ended first.");
}

test("send, withdraw and stop round trips with real views", async () => {
  await using fixture = await openTestHost();
  const port = hostPort(fixture.host);
  const id = await port.create({ workspace: null, selection: null });
  const session = port.session(id);
  expect((await session.info()).id).toBe(id);
  fixture.reply({ content: [{ type: "text", text: "Working on it." }], hold: true });

  const first = await session.send("first", { delivery: "steer" });
  await fixture.requested(1);
  const live = await viewWhere(session, (view) => view.execution.kind === "live");
  expect(userStatus(live, first.message)).toBe("landed");

  const later = await session.send("later", { delivery: "queue" });
  const queued = await viewWhere(session, (view) => userStatus(view, later.message) === "pending");
  expect(queued.messages.find((message) => message.id === later.message)).toMatchObject({
    status: { kind: "pending", schedule: { kind: "next-turn" } },
  });

  expect(await session.withdraw(later.message)).toBe("withdrawn");
  await viewWhere(session, (view) => userStatus(view, later.message) === undefined);
  expect(await session.withdraw(later.message)).toBe("gone");
  expect(await session.withdraw(asId("never-sent"))).toBe("gone");

  // The first message landed and its run is live: a withdraw would stop that run, so the adapter reports it.
  expect(await session.withdraw(first.message)).toBe("landed-first");
  const idle = await viewWhere(session, (view) => view.execution.kind === "idle");
  expect(idle.execution).toMatchObject({ kind: "idle", lastRun: { end: { kind: "stopped" } } });

  if (live.execution.kind !== "live") throw new Error("expected a live run");
  expect(await session.stopRun(live.execution.run.id)).toBe("stopped");
  expect(await session.stopRun(asId("missing-run"))).toBe("missing");
});

test("revise replaces a pending message in place and refuses one that landed", async () => {
  await using fixture = await openTestHost();
  const port = hostPort(fixture.host);
  const session = port.session(await port.create({ workspace: null, selection: null }));
  fixture.reply({ content: [{ type: "text", text: "Hold." }], hold: true });
  const first = await session.send("first", { delivery: "steer" });
  await fixture.requested(1);
  const later = await session.send("later", { delivery: "queue" });
  await viewWhere(session, (view) => userStatus(view, later.message) === "pending");

  expect(await session.revise(later.message, "sooner", { delivery: "queue" })).toBe("revised");

  const revised = await viewWhere(session, (view) =>
    view.messages.some((message) => message.kind === "user" && message.content === "sooner"),
  );

  expect(revised.messages.filter((message) => message.kind === "user")).toHaveLength(2);
  expect(await session.revise(asId("never-sent"), "x", { delivery: "queue" })).toBe("gone");

  if (revised.execution.kind !== "live") throw new Error("expected a live run");
  await session.stopRun(revised.execution.run.id);
  await viewWhere(session, (view) => view.execution.kind === "idle");
  expect(await session.revise(first.message, "edited", { delivery: "steer" })).toBe("landed-first");
});

test("answer settles a question part once; a different answer afterwards is refused", async () => {
  await using fixture = await openTestHost();
  const port = hostPort(fixture.host);
  const id = await port.create({ workspace: null, selection: null });
  const session = port.session(id);

  const part = await fixture.host.session(id).parts.create(question, {
    state: { prompt: "Pick one", options: ["A", "B"], answer: null },
    placement: { kind: "modal" },
  });

  const asked = await viewWhere(session, (view) => openQuestions(view).length === 1);
  expect(openQuestions(asked)).toMatchObject([{ part: part.id, prompt: "Pick one" }]);
  expect(await session.answer(part.id, "A")).toBe(true);
  const answered = await viewWhere(session, (view) => openQuestions(view).length === 0);
  expect(answered.parts.find((candidate) => candidate.id === part.id)).toMatchObject({
    state: { answer: "A" },
  });

  expect(await session.answer(part.id, "A")).toBe(true);
  expect(await session.answer(part.id, "B").catch(() => false)).toBe(false);
});

test("the host port lists the catalog, root sessions and tasks, and configures the head", async () => {
  await using fixture = await openTestHost();
  const port = hostPort(fixture.host);
  const id = await port.create({ workspace: null, selection: null });
  const session = port.session(id);
  const catalog = await port.listModels();
  expect(catalog.providers.map((provider) => provider.id)).toEqual(["test"]);
  expect((await port.rootSessions()).map((info) => info.id)).toEqual([id]);

  expect(await session.configure({ effort: "off" })).toMatchObject({
    kind: "configured",
    selected: { thinking: "off" },
  });

  expect(await session.configure({ model: { provider: "test", id: "nope" } })).toMatchObject({
    kind: "unknown-model",
  });

  const iterator = port.tasks(id)[Symbol.asyncIterator]();
  const tasks = await until(async () => (await iterator.next()).value);
  expect(tasks).toEqual([]);
  await iterator.return?.();
  expect(await session.compact(null)).toBe("nothing");
  expect((await session.workspace()).cwd).toBeNull();
});
