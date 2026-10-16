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
    SessionEvent: "86f2ec4eb44f31e3",
    WaitOutcome: "2164fa1f0aafd2a7",
    call: "c84b5d8ecc0de059",
    commit: "5771ce57e4bdf687",
    identity: "7a36a42575ab463a",
    inbox: "5441cda17aa278c8",
    lease: "d0dd01cdbad7ec93",
    part: "ddabfd5e00b1dd4c",
    principals: "103773fcbe00ed1c",
    receipt: "d31ca04a07027010",
    run: "a23667cdd92ff387",
    seen: "d56e60a18cd524d4",
    session: "708fc13db82324a1",
    workspace: "1f30e2f3b518d3a3",
  });
});
