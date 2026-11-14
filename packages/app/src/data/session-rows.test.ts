import assert from "node:assert/strict";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { deriveSessionRows, sessionRows, subscribeSessionRows } from "./session-rows.ts";
import type { RowInputs, SessionRows } from "./session-rows.ts";
import { installScripted, scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("the rows keep hearing the host after another connection replaces the first", async () => {
  installScripted(scriptedConnection({ sessions: [sessionRow("chat")] }));
  const leave = subscribeSessionRows(() => undefined);
  await settle();
  assert.equal(sessionRows().roots?.[0]?.name, "chat");

  const sessions = viewStream<readonly SessionInfo[]>([sessionRow("chat")]);
  installScripted(scriptedConnection({ sessions }));
  await settle();
  sessions.push([sessionRow("chat", { name: "renamed" })]);
  await settle();

  assert.equal(sessionRows().roots?.[0]?.name, "renamed");
  leave();
});

const NO_ROWS: SessionRows = {
  rows: new Map(),
  hosted: new Map(),
  roots: undefined,
  listed: false,
  missing: new Set(),
};

const NOTHING: RowInputs = {
  all: undefined,
  roots: undefined,
  pinned: undefined,
  recorded: undefined,
  children: [],
  unlisted: new Map(),
  project: (session) => session,
};

const id = (name: string): SessionId => asId<"session">(name);

test.each<{
  readonly name: string;
  readonly inputs: Partial<RowInputs>;
  readonly roots: readonly string[] | undefined;
  readonly rows: Readonly<Record<string, string>>;
  readonly missing?: readonly string[];
  readonly listed?: boolean;
}>([
  {
    name: "nothing read yet lists nothing",
    inputs: {},
    roots: undefined,
    rows: {},
  },
  {
    name: "the recorded roots stand in until the host's roots arrive",
    inputs: { recorded: [sessionRow("recorded")] },
    roots: ["recorded"],
    rows: { recorded: "recorded" },
  },
  {
    name: "the host's roots replace the recorded ones",
    inputs: { recorded: [sessionRow("recorded")], roots: [sessionRow("new")] },
    roots: ["new"],
    rows: { new: "new" },
  },
  {
    name: "a pinned root the newest roots leave out comes after them",
    inputs: {
      roots: [sessionRow("b"), sessionRow("a")],
      pinned: [sessionRow("a", { pinned: true }), sessionRow("old", { pinned: true })],
    },
    roots: ["b", "a", "old"],
    rows: { b: "b", a: "a", old: "old" },
  },
  {
    name: "the first list that holds a session wins",
    inputs: {
      all: [sessionRow("a", { name: "from all" })],
      roots: [sessionRow("a", { name: "from roots" })],
      children: [[sessionRow("a", { name: "from children" })]],
    },
    roots: ["a"],
    rows: { a: "from all" },
    listed: true,
  },
  {
    name: "children and unlisted sessions are rows but not roots",
    inputs: {
      roots: [sessionRow("root")],
      children: [[sessionRow("child", { parent: id("root") })]],
      unlisted: new Map([[id("far"), sessionRow("far")]]),
    },
    roots: ["root"],
    rows: { root: "root", child: "child", far: "far" },
  },
  {
    name: "a pending delete hides the row and its root",
    inputs: {
      roots: [sessionRow("a"), sessionRow("b")],
      project: (session) => (session.id === id("a") ? null : session),
    },
    roots: ["b"],
    rows: { b: "b" },
  },
  {
    name: "a pending rename shows the new name",
    inputs: {
      roots: [sessionRow("a")],
      project: (session) => ({ ...session, name: "renamed" }),
    },
    roots: ["a"],
    rows: { a: "renamed" },
  },
  {
    name: "an unlisted session the host does not know is missing",
    inputs: {
      all: [],
      unlisted: new Map([
        [id("gone"), null],
        [id("far"), sessionRow("far")],
      ]),
    },
    roots: undefined,
    rows: { far: "far" },
    missing: ["gone"],
    listed: true,
  },
])("$name", (row) => {
  const inputs = { ...NOTHING, ...row.inputs };
  const derived = deriveSessionRows(inputs, NO_ROWS);

  expect({
    roots: derived.roots?.map((session) => session.id),
    rows: Object.fromEntries([...derived.rows].map(([key, session]) => [key, session.name])),
    missing: [...derived.missing],
    listed: derived.listed,
  }).toEqual({
    roots: row.roots,
    rows: row.rows,
    missing: row.missing ?? [],
    listed: row.listed ?? false,
  });

  const again = deriveSessionRows(
    {
      ...inputs,
      all: inputs.all && [...inputs.all],
      roots: inputs.roots && [...inputs.roots],
      children: inputs.children.map((list) => list && [...list]),
      unlisted: new Map(inputs.unlisted),
    },
    derived,
  );

  expect(again).toBe(derived);
});
