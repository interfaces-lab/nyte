import { SdkError } from "@nyte-ai/schema";
import type { ReceiptId, SessionId } from "@nyte-ai/schema";
import { CORE_CONTEXT } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import { decodeReceiptRecord } from "../contract/records.ts";
import type { ReportedEnd } from "../contract/records.ts";
import { readRunEnd } from "../watch/reads.ts";
import { load, readReceipt } from "../store/session.ts";
import { fault } from "../util/dev-log.ts";
import { send } from "./admission.ts";
import { settleReceipt } from "./receipts.ts";
import { jobOutcome } from "./waits.ts";

const RETRIED: ReadonlySet<string> = new Set(["stale", "unavailable", "timeout"]);

export async function deliverReport(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
): Promise<void> {
  await admitReport(kernel, session, id).catch(async (error: unknown) => {
    fault("reports", "report not delivered", { session, report: id, error: String(error) });

    if (error instanceof SdkError && !RETRIED.has(error.code)) {
      await settleReceipt(kernel, session, id, {
        kind: "report",
        outcome: { kind: "undelivered", reason: error.message },
      }).catch((settling: unknown) =>
        fault("reports", "report not settled", { session, report: id, error: String(settling) }),
      );
    }
  });
}

export async function recoverReports(kernel: Kernel, session: SessionId): Promise<void> {
  for (const ref of await kernel.store.sessions.pending({ kind: "receipt", sessions: [session] })) {
    const found = await load(kernel.store, ref, decodeReceiptRecord);

    if (found?.record.kind !== "report" || found.record.outcome !== null) continue;
    const id = found.record.id;

    const offered = await offerEnd(kernel, found.record.ended).then(
      () => true,
      (error: unknown) => {
        fault("reports", "end not offered", { session, report: id, error: String(error) });

        return false;
      },
    );

    if (offered) await deliverReport(kernel, session, id);
  }
}

async function admitReport(kernel: Kernel, session: SessionId, id: ReceiptId): Promise<void> {
  const found = await readReceipt(kernel.store, session, id);

  if (found === null || found.record.kind !== "report" || found.record.outcome !== null) return;

  await send(kernel, {
    session,
    head: found.record.head,
    context: CORE_CONTEXT,
    content: found.record.content,
    options: { id, source: found.record.source, delivery: "attach" },
    reserved: true,
  });
}

async function offerEnd(kernel: Kernel, ended: ReportedEnd): Promise<void> {
  if (ended.kind === "job") {
    const end = await jobOutcome(kernel, ended.job);

    if (end !== null) await kernel.waits.jobEnded(ended.job, end);

    return;
  }

  const end = await readRunEnd(kernel, ended.session, ended.run);

  if (end !== null) await kernel.waits.runEnded(ended.session, ended.run, end);
}
