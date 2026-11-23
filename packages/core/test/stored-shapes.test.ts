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
    SessionEvent: "0d04267cd3533c9f",
    WaitOutcome: "2164fa1f0aafd2a7",
    call: "c84b5d8ecc0de059",
    catalog: "c4f1078c2e99b6ca",
    commit: "e3ab7da07323be3e",
    identity: "7a36a42575ab463a",
    inbox: "6bb3653102464274",
    job: "20b2f74e2b21730d",
    lease: "d0dd01cdbad7ec93",
    part: "99bf6a359ec10990",
    principals: "103773fcbe00ed1c",
    process: "95737928ecd08a26",
    project: "43d15ff3e2d118f1",
    prompt: "415e40695f4ad3f6",
    receipt: "f3eb06f1a16b8288",
    run: "13ba5f76f2b6a01f",
    seen: "d56e60a18cd524d4",
    session: "eb34f6599591f4ca",
    trust: "3134382ffff2bad2",
    workspace: "1276ff8f9e376d05",
  });
});
