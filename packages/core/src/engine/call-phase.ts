import type { Json } from "@nyte-ai/schema";
import type { CallRecord } from "../contract/records.ts";

export type CallPhase =
  | { readonly kind: "intended" }
  | { readonly kind: "opened"; readonly replay: CallRecord["replay"] }
  | {
      readonly kind: "parked";
      readonly waiting: NonNullable<CallRecord["waiting"]>;
      readonly replay: CallRecord["replay"];
    }
  | { readonly kind: "woken"; readonly replay: CallRecord["replay"] }
  | { readonly kind: "settled"; readonly result: Json };

const INTENDED: CallPhase = { kind: "intended" };

export function callPhase(record: CallRecord): CallPhase {
  if (record.kind === "intent") return INTENDED;

  if (record.result !== null) return { kind: "settled", result: record.result };

  if (record.waiting !== null)
    return { kind: "parked", waiting: record.waiting, replay: record.replay };

  return record.waits.length === 0
    ? { kind: "opened", replay: record.replay }
    : { kind: "woken", replay: record.replay };
}
