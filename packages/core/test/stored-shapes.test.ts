import { createHash } from "node:crypto";
import { SessionEventType, WaitOutcomeType } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { STORED_RECORD_TYPES } from "../src/store.ts";

it("keeps every stored shape until a store change is decided", () => {
  const fingerprints = Object.fromEntries(
    Object.entries({
      SessionEvent: SessionEventType,
      WaitOutcome: WaitOutcomeType,
      ...STORED_RECORD_TYPES,
    }).map(([name, schema]) => [
      name,
      createHash("sha256").update(JSON.stringify(schema)).digest("hex").slice(0, 16),
    ]),
  );

  expect(
    fingerprints,
    "A stored shape changed. Stores keep rows in the old shape, and reads reject them: a log event throws and stops the session, a record decodes to null. Run `pnpm --dir packages/host check:store` against a store with history. Backfill what it reports (a STORE_STEPS step once the old shape has shipped), then update the hashes here.",
  ).toEqual({
    SessionEvent: "1975feff63911824",
    WaitOutcome: "776db4351c8a3aea",
    call: "c84b5d8ecc0de059",
    catalog: "c4f1078c2e99b6ca",
    commit: "878143a744074ed1",
    identity: "7a36a42575ab463a",
    inbox: "6bb3653102464274",
    job: "20b2f74e2b21730d",
    lease: "d0dd01cdbad7ec93",
    part: "573c4c0f32ce0983",
    principals: "103773fcbe00ed1c",
    process: "95737928ecd08a26",
    project: "43d15ff3e2d118f1",
    prompt: "07293c5b3c4e520c",
    "provider-checkpoint": "50201ff7a5aac90a",
    "provider-continuation": "0a552fd3f43dd4a9",
    receipt: "28a1a8d49fa8fa76",
    run: "6d12c35675112697",
    seen: "d56e60a18cd524d4",
    session: "840ef1f836435106",
    trust: "3134382ffff2bad2",
    workspace: "ff24fe45fbe0b8c6",
  });
});
