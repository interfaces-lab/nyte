import assert from "node:assert/strict";
import { transcriptFromCommits } from "../src/kernel/views/transcript.ts";
import { changesFromTurns } from "../src/kernel/views/changes.ts";
import { checkTranscript, projectionFixture } from "./fixtures.ts";
import { summarize, timed, type Repetitions } from "./measure.ts";

export async function projections(sizes: readonly number[], repetitions: Repetitions) {
  const rows = [];
  for (const count of sizes) {
    for (const workload of ["many-turns", "tool-heavy"] as const) {
      const fixture = projectionFixture(count, workload);
      const before = structuredClone(fixture.items);
      const turns = transcriptFromCommits(fixture.items);
      checkTranscript(fixture, turns);
      const turnsBefore = structuredClone(turns);
      const transcriptSamples = [];
      const changesSamples = [];
      for (let index = -repetitions.warmups; index < repetitions.samples; index++) {
        const transcript = await timed(() => transcriptFromCommits(fixture.items));
        checkTranscript(fixture, transcript.result);
        const changes = await timed(() => changesFromTurns(turns));
        assert.deepEqual(changes.result, fixture.expectedFiles);
        assert.deepEqual(fixture.items, before);
        assert.deepEqual(turns, turnsBefore);
        if (index >= 0) {
          transcriptSamples.push(transcript.measurement);
          changesSamples.push(changes.measurement);
        }
      }
      rows.push({
        operation: "transcriptFromCommits",
        fixture: fixture.metadata,
        memoryMode: "in-process",
        warmups: repetitions.warmups,
        ...summarize(transcriptSamples),
      });
      rows.push({
        operation: "changesFromTurns",
        fixture: fixture.metadata,
        memoryMode: "in-process",
        warmups: repetitions.warmups,
        ...summarize(changesSamples),
      });
    }
  }
  return rows;
}
