import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { parseArgs } from "./cli.ts";
import {
  checkIncremental,
  checkTranscript,
  historyFixture,
  projectionFixture,
} from "./fixtures.ts";
import { histories } from "./histories.ts";
import { projections } from "./projections.ts";
import { sqliteObjects, watchReplay } from "./storage.ts";
import { transcriptFromCommits } from "../src/kernel/views/transcript.ts";

const repetitions = { samples: 1, warmups: 0 };

test("CLI emits clean JSON and keeps argument errors on stderr", () => {
  const runner = fileURLToPath(new URL("./run.ts", import.meta.url));
  const output = spawnSync(
    process.execPath,
    [runner, "--suite", "watch", "--events", "2", "--samples", "1", "--warmups", "0"],
    {
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  assert.equal(output.error, undefined);
  assert.equal(output.status, 0, output.stderr);
  const payload: unknown = JSON.parse(output.stdout);
  const document = Type.Object({
    schemaVersion: Type.Literal(1),
    status: Type.Literal("ok"),
    results: Type.Array(
      Type.Object({
        operation: Type.String(),
        samples: Type.Literal(1),
        p50Ms: Type.Number(),
        p95Ms: Type.Number(),
      }),
    ),
  });
  assert.ok(Value.Check(document, payload));
  assert.equal(payload.results.length, 2);
  const invalid = spawnSync(process.execPath, [runner, "--provider", "forbidden"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(invalid.error, undefined);
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /Unknown flag: --provider/u);
  const help = spawnSync(process.execPath, [runner, "--help"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(help.error, undefined);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: pnpm exec node/u);
});

test("mixed fixtures are deterministic, paired, immutable, and incrementally equivalent", () => {
  for (const workload of ["many-turns", "tool-heavy"] as const) {
    const fixture = projectionFixture(100, workload);
    assert.deepEqual(projectionFixture(100, workload), fixture);
    const before = structuredClone(fixture);
    checkTranscript(fixture, transcriptFromCommits(fixture.items));
    checkIncremental(fixture);
    assert.deepEqual(fixture, before);
  }
  assert.deepEqual(historyFixture(20, true), historyFixture(20, true));
  assert.deepEqual(historyFixture(20, true).messages, historyFixture(20, false).messages);
});

test(
  "every benchmark validates observable results on small real fixtures",
  { timeout: 30_000 },
  async () => {
    const rows = [
      ...(await projections([100], repetitions)),
      ...(await histories(20, repetitions)),
      ...(await sqliteObjects(20, repetitions)),
      ...(await watchReplay(300, repetitions)),
    ];
    assert.equal(rows.length, 14);
    for (const row of rows) {
      assert.equal(row.samples, 1);
      assert.ok(Number.isFinite(row.p50Ms));
      assert.ok(Number.isFinite(row.p95Ms));
    }
  },
);

test("CLI rejects unknown, duplicate, missing, fractional, oversized, and malformed inputs", () => {
  for (const args of [
    ["--wat"],
    ["--samples"],
    ["--samples", "0"],
    ["--samples", "1.5"],
    ["--samples", "31"],
    ["--count", "NaN"],
    ["--count", "1e2"],
    ["--events", "1025"],
    ["--warmups", "-1"],
    ["--suite", "provider"],
    ["--sizes", "100,"],
    ["--sizes", "100,100"],
    ["--samples", "1", "--samples", "2"],
    ["--help", "extra"],
  ]) {
    assert.throws(() => parseArgs(args));
  }
  assert.deepEqual(parseArgs(["--help"]), { kind: "help" });
  assert.deepEqual(
    parseArgs(["--suite", "watch", "--events", "2", "--samples", "1", "--warmups", "0"]),
    {
      kind: "run",
      suite: "watch",
      sizes: [100, 1000, 10000],
      count: 100,
      events: 2,
      samples: 1,
      warmups: 0,
    },
  );
});
