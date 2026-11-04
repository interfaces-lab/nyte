export interface ProgramRecord {
  readonly id: string;
  readonly state: "working" | "blocked" | "done" | "error";
  readonly kind: "permission" | "question" | "auth" | undefined;
  readonly progress: number | undefined;
  readonly title: string | undefined;
  readonly msg: string | undefined;
}

type Report =
  | ProgramRecord
  | { readonly state: "idle"; readonly id: string }
  | { readonly state: "clear"; readonly id: string };

const QUERY_REPLY =
  "\u001b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\u001b\\";

const MAX_RECORDS = 256;

const MAX_BODY_BYTES = 4092;

const VALUE_LIMITS = new Map([
  ["msg", 2732],
  ["title", 256],
  ["app", 32],
  ["id", 128],
]);

const ID = /^[A-Za-z0-9_.+-]{1,32}(?:\/[A-Za-z0-9_.+-]{1,32}){0,7}$/u;

const encoder = new TextEncoder();

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

export function createProgramRecords() {
  let records = new Map<string, ProgramRecord>();
  let snapshot: readonly ProgramRecord[] = [];

  const keep = (predicate: (record: ProgramRecord) => boolean): readonly ProgramRecord[] => {
    const kept = Array.from(records).filter((entry) => predicate(entry[1]));

    if (kept.length !== records.size) {
      records = new Map(kept);
      snapshot = Array.from(records.values());
    }

    return snapshot;
  };

  return {
    report(body: string): string {
      if (body === "133;A" || body.startsWith("133;A;")) {
        keep(finished);

        return "";
      }

      if (!body.startsWith("7501;") || encoder.encode(body).byteLength > MAX_BODY_BYTES) return "";
      const payload = body.slice(5).trim();

      if (payload === "?") return QUERY_REPLY;
      const report = parseReport(payload);

      if (report === undefined) return "";

      if (report.state === "clear")
        keep(
          (record) =>
            report.id !== "" && record.id !== report.id && !record.id.startsWith(`${report.id}/`),
        );
      else if (report.state === "idle") keep((record) => record.id !== report.id);
      else {
        records.delete(report.id);
        records.set(report.id, report);

        const oldest = records.size > MAX_RECORDS ? records.keys().next().value : undefined;

        if (oldest !== undefined) records.delete(oldest);
        snapshot = Array.from(records.values());
      }

      return "";
    },
    records: () => snapshot,
    expire: () => keep(finished),
    acknowledge: () => keep((record) => !finished(record)),
    reset: () => keep(() => false),
  };
}

function finished(record: ProgramRecord): boolean {
  return record.state === "done" || record.state === "error";
}

function parseReport(payload: string): Report | undefined {
  const values = new Map<string, string>();

  for (const pair of payload.split(":")) {
    const equals = pair.indexOf("=");

    if (equals === -1) continue;
    const key = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();

    if (
      encoder.encode(key).byteLength > 16 ||
      encoder.encode(value).byteLength > (VALUE_LIMITS.get(key) ?? MAX_BODY_BYTES)
    )
      return undefined;

    if (!/^[a-z]+$/u.test(key) || !/^[A-Za-z0-9_.,+/=-]*$/u.test(value)) continue;

    if (key !== "msg" && key !== "title") {
      values.set(key, value);

      continue;
    }

    const text = decodeText(value, key === "msg" ? 2048 : 192);

    if (text === undefined) return undefined;
    values.set(key, text);
  }

  const id = values.get("id") ?? "";

  if (values.has("id") && !ID.test(id)) return undefined;
  const state = values.get("state");

  if (state === "clear") return { state, id };

  if (state === "idle") return { state, id };

  if (state !== "working" && state !== "blocked" && state !== "done" && state !== "error")
    return undefined;
  const progress = values.get("progress");
  const kind = values.get("kind");

  return {
    id,
    state,
    kind:
      state === "blocked" && (kind === "permission" || kind === "question" || kind === "auth")
        ? kind
        : undefined,
    progress:
      (state === "working" || state === "blocked") &&
      progress !== undefined &&
      /^\d{1,3}$/u.test(progress) &&
      Number(progress) <= 100
        ? Number(progress)
        : undefined,
    title: values.get("title"),
    msg: values.get("msg"),
  };
}

function decodeText(value: string, limit: number): string | undefined {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/u.test(value))
    return undefined;
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

  if (bytes.byteLength > limit) return undefined;
  const text = decoder.decode(bytes);
  const encoded = encoder.encode(text);

  if (
    encoded.byteLength !== bytes.byteLength ||
    encoded.some((byte, index) => byte !== bytes[index]) ||
    /\p{Cc}/u.test(text)
  )
    return undefined;

  return text.replaceAll(/[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu, "");
}
