import { asId } from "@nyte-ai/schema";
import type { ReceiptId, RefUpdate, SessionId, WaitOutcome } from "@nyte-ai/schema";
import { decodeJobRecord } from "../contract/records.ts";
import type { ReceiptRecord, ReportedEnd } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { jobRef, receiptRef, sessionRef } from "./refs.ts";
import { load, put, readReceipt, readSession } from "./session.ts";

export type Report = Extract<ReceiptRecord, { readonly kind: "report" }>;

export function reportId(ended: ReportedEnd): ReceiptId {
  return asId<"receipt">(`${ended.kind === "run" ? ended.run : ended.job}:report`);
}

export async function reserveReport(
  store: StoreConnection,
  session: SessionId,
  report: Pick<Report, "head" | "content" | "source" | "ended">,
): Promise<RefUpdate> {
  const id = reportId(report.ended);

  return {
    name: receiptRef(session, id),
    target: await put(store, "receipt", { ...report, id, kind: "report", outcome: null }),
    expect: "absent",
    fences: [sessionRef(session)],
  };
}

export async function withdrawReport(
  store: StoreConnection,
  outcome: WaitOutcome,
): Promise<readonly RefUpdate[]> {
  const ended: ReportedEnd | null =
    outcome.kind === "run"
      ? { kind: "run", session: outcome.session, run: outcome.run }
      : outcome.kind === "job"
        ? { kind: "job", job: outcome.job }
        : null;

  if (ended === null) return [];

  const owner =
    ended.kind === "run"
      ? ((await readSession(store, ended.session))?.record.parent ?? null)
      : ((await load(store, await store.refs.get(jobRef(ended.job)), decodeJobRecord))?.record
          .session ?? null);

  if (owner === null) return [];
  const found = await readReceipt(store, owner, reportId(ended));

  return found?.record.kind === "report" && found.record.outcome === null
    ? [{ name: found.ref.name, target: null, expect: found.ref.revision }]
    : [];
}
