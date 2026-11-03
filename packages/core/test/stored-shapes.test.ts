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
    SessionEvent: "f7109f7ef1a0a2cb",
    WaitOutcome: "2164fa1f0aafd2a7",
    call: "c84b5d8ecc0de059",
    commit: "9df720d3e0cdb2bf",
    identity: "7a36a42575ab463a",
    inbox: "6bb3653102464274",
    job: "883d9aa8a972c69b",
    lease: "d0dd01cdbad7ec93",
    part: "99bf6a359ec10990",
    principals: "103773fcbe00ed1c",
    process: "529e7948f7890396",
    prompt: "415e40695f4ad3f6",
    receipt: "b1c69ca5c6840997",
    run: "b896603fc0a9c2a8",
    seen: "d56e60a18cd524d4",
    session: "0dc1590eb3d9aa66",
    trust: "3134382ffff2bad2",
    workspace: "1276ff8f9e376d05",
  });
});
