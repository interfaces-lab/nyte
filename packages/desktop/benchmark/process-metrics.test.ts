import assert from "node:assert/strict";
import { test } from "vitest";
import { parseDarwinActivity, parseProcessList, processTree } from "./process-metrics.ts";

test("parses and walks a process tree", () => {
  const processes = parseProcessList(`
100 1 10 /app/Nyte
101 100 20 /app/Nyte Helper
102 101 30 /app/Nyte Renderer
200 1 40 /other
`);
  assert.deepEqual(processTree(processes, 100), [
    { pid: 100, parentPid: 1, rssBytes: 10 * 1024, command: "/app/Nyte" },
    { pid: 101, parentPid: 100, rssBytes: 20 * 1024, command: "/app/Nyte Helper" },
    { pid: 102, parentPid: 101, rssBytes: 30 * 1024, command: "/app/Nyte Renderer" },
  ]);
});

test("rejects malformed process rows", () => {
  assert.throws(() => parseProcessList("not ps output"), /Invalid ps row/u);
});

test("uses the final macOS energy sample", () => {
  const output = `
PID %CPU POWER
100 1.0 1.0
101 2.0 2.0
PID %CPU POWER
100 5.0 3.5
101 6.0 4.5
200 99.0 99.0
`;
  assert.deepEqual(parseDarwinActivity(output, new Set([100, 101])), {
    cpuPercent: 11,
    power: 8,
  });
});
