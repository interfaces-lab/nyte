import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { parseArgs } from "./cli.ts";
import { historyFixture, projectionFixture } from "./fixtures.ts";

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
      { minItems: 1 },
    ),
  });
  assert.ok(Value.Check(document, payload));
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

test("fixtures are deterministic and checkpoints preserve the source messages", () => {
  for (const workload of ["many-turns", "tool-heavy"] as const) {
    const fixture = projectionFixture(100, workload);
    assert.deepEqual(projectionFixture(100, workload), fixture);
  }
  assert.deepEqual(historyFixture(20, true), historyFixture(20, true));
  assert.deepEqual(historyFixture(20, true).messages, historyFixture(20, false).messages);
});

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
