import assert from "node:assert/strict";
import { test } from "vitest";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { testRenderer } from "../../../../test/renderer.ts";
import { diffRequestForScope } from "./change-scopes.ts";

const report = Type.Array(
  Type.Object({
    step: Type.String(),
    scopeLabel: Type.Union([Type.String(), Type.Null()]),
    alert: Type.Union([Type.String(), Type.Null()]),
    stackPaths: Type.Array(Type.String()),
    snapshotReads: Type.Number(),
  }),
);

async function readObservations() {
  const output = await testRenderer(new URL("./changes-scope.browser-test.tsx", import.meta.url));
  const parsed: unknown = JSON.parse(output);
  if (!Value.Check(report, parsed)) throw new Error(`The changes scope fixture failed: ${output}`);
  return (step: string) => {
    const found = parsed.find((observation) => observation.step === step);
    if (found === undefined) throw new Error(`Missing observation: ${step}`);
    return found;
  };
}

let reported: ReturnType<typeof readObservations> | undefined;
const observations = () => (reported ??= readObservations());

test(
  "switching turns shows each turn's files without rereading the session",
  { timeout: 120_000 },
  async () => {
    const at = await observations();
    assert.deepEqual(at("mounted on uncommitted").stackPaths, ["src/working.ts"]);
    assert.deepEqual(at("conversation file changed again").stackPaths, [
      "src/first.ts",
      "src/working.ts",
    ]);
    assert.deepEqual(at("conversation file reverted").stackPaths, ["src/working.ts"]);
    assert.deepEqual(at("all conversation files reverted").stackPaths, []);
    const newest = at("selected the newest turn");
    const older = at("selected an older turn");
    assert.equal(newest.scopeLabel, "Select scope, showing Latest");
    assert.deepEqual(newest.stackPaths, ["src/third.ts"]);
    assert.equal(older.scopeLabel, "Select scope, showing Turn 1");
    assert.deepEqual(older.stackPaths, ["src/first.ts"]);
    assert.equal(older.snapshotReads, 1);

    const inFlight = at("read in flight");
    const duringFlight = at("scope changed while the read was in flight");
    assert.equal(duringFlight.snapshotReads, inFlight.snapshotReads);
    assert.equal(duringFlight.alert, null);
    assert.deepEqual(duringFlight.stackPaths, ["src/third.ts"]);
  },
);

test(
  "a missing turn falls back until it returns, unless the user chooses another scope",
  { timeout: 120_000 },
  async () => {
    const at = await observations();
    const dropped = at("selected turn dropped from the transcript");
    assert.equal(dropped.scopeLabel, "Select scope, showing Uncommitted");
    assert.equal(dropped.alert, null);
    assert.deepEqual(dropped.stackPaths, ["src/working.ts"]);
    const regained = at("transcript regained the dropped turn");
    assert.equal(regained.scopeLabel, "Select scope, showing Turn 1");
    assert.deepEqual(regained.stackPaths, ["src/first.ts"]);
    assert.equal(
      at("transcript regained the turn after picking Uncommitted").scopeLabel,
      "Select scope, showing Uncommitted",
    );
  },
);

test(
  "failed session reads retain cached changes and recover without blaming Git",
  { timeout: 120_000 },
  async () => {
    const at = await observations();
    const cached = at("read failed with cached turns");
    assert.equal(cached.alert, null);
    assert.deepEqual(cached.stackPaths, ["src/third.ts"]);
    const dirty = at("read failed with no cached turns, dirty working tree");
    assert.equal(dirty.alert, null);
    assert.deepEqual(dirty.stackPaths, ["src/working.ts"]);
    const clean = at("read failed with no cached turns, clean working tree");
    assert.match(clean.alert ?? "", /conversation/);
    assert.deepEqual(clean.stackPaths, []);
    const recovered = at("recovered");
    assert.equal(recovered.alert, null);
    assert.deepEqual(recovered.stackPaths, ["src/third.ts"]);
  },
);

test("each scope requests the corresponding Git diff", () => {
  assert.deepEqual(diffRequestForScope({ kind: "uncommitted" }), {
    target: { kind: "workspace" },
    scope: { kind: "worktree" },
    ignoreWhitespace: false,
  });
  assert.deepEqual(diffRequestForScope({ kind: "staged" }, { ignoreWhitespace: true }), {
    target: { kind: "workspace" },
    scope: { kind: "staged" },
    ignoreWhitespace: true,
  });
  assert.deepEqual(diffRequestForScope({ kind: "unstaged" }, { paths: ["src/a.ts"] }), {
    target: { kind: "workspace" },
    scope: { kind: "unstaged" },
    paths: ["src/a.ts"],
    ignoreWhitespace: false,
  });
  assert.deepEqual(diffRequestForScope({ kind: "commit", oid: "c0ffee" }), {
    target: { kind: "workspace" },
    scope: { kind: "commit", oid: "c0ffee" },
    ignoreWhitespace: false,
  });
  assert.equal(diffRequestForScope({ kind: "turn", turnId: "turn-1" }), undefined);
});
