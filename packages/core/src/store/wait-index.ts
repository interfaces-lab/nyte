import { asId } from "@nyte-ai/schema";
import type { CallId, SessionId } from "@nyte-ai/schema";
import type { CallRecord } from "../contract/records.ts";

export const WAITS = "waits/";

export const TIME = `${WAITS}time/`;

/** Digits a time key is padded to, so the index lists times in order. */
export const TIME_DIGITS = 16;

/** One entry of the store-side wait index: the index ref (null for a wait found from the call record itself), the parked call it points at, which wait of the call (its count of earlier waits), and which of the wait's targets, null for a deadline or input stop, which ends the whole wait. */
export interface Indexed {
  readonly name: string | null;
  readonly session: SessionId;
  readonly call: CallId;
  readonly occurrence: number;
  readonly target: number | null;
}

/** The index refs a parked call's current wait needs: one per target it still waits on, its earliest deadline, and its input stop. */
export function waitIndex(
  session: SessionId,
  record: Pick<CallRecord, "id" | "head" | "waiting" | "partial" | "waits">,
): readonly string[] {
  const target = record.waiting;

  if (target === null) return [];

  const tail = (slot: number | "deadline" | "input") =>
    `${session}/${record.id}/${record.waits.length}/${slot}`;

  const targets = "targets" in target ? target.targets : [target];
  const deadline = findEarliestDeadline(target);

  return [
    ...targets.flatMap((waited, slot) => {
      if ((record.partial.at(slot) ?? null) !== null) return [];

      switch (waited.kind) {
        case "run":
          return [`${WAITS}run/${waited.session}/${waited.run}/${tail(slot)}`];
        case "part":
          return [`${WAITS}part/${session}/${waited.part}/${tail(slot)}`];
        case "job":
          return [`${WAITS}job/${waited.job}/${tail(slot)}`];
        case "timer":
          return [`${TIME}${formatTime(waited.until)}/${tail(slot)}`];
      }
    }),
    ...(deadline === null ? [] : [`${TIME}${formatTime(deadline)}/${tail("deadline")}`]),
    ...("targets" in target && target.untilInput === true && record.head !== null
      ? [`${WAITS}input/${session}/${record.head}/${tail("input")}`]
      : []),
  ];
}

export function readIndexed(name: string): Indexed | null {
  const [slot, occurrence, call, session] = name.split("/").toReversed();

  if (slot === undefined || occurrence === undefined || call === undefined || session === undefined)
    return null;

  return {
    name,
    session: asId<"session">(session),
    call: asId<"call">(call),
    occurrence: Number(occurrence),
    target: slot === "deadline" || slot === "input" ? null : Number(slot),
  };
}

export function findEarliestDeadline(target: NonNullable<CallRecord["waiting"]>): number | null {
  const bounds = [
    target.deadline,
    ...("targets" in target ? target.targets.map((waited) => waited.deadline) : []),
  ].flatMap((deadline) => (deadline === undefined ? [] : [deadline]));

  return bounds.length === 0 ? null : Math.min(...bounds);
}

function formatTime(at: number): string {
  return String(Math.max(0, Math.floor(at))).padStart(TIME_DIGITS, "0");
}
