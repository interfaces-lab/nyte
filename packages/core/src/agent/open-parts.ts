import type { Failure, HeadName, Json, RefUpdate, SessionId } from "@nyte-ai/schema";
import type { PartId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { text, thinking } from "../contract/parts.ts";
import { decodePartRecord } from "../contract/records.ts";
import type { PartRecord } from "../contract/records.ts";
import { settling } from "../store/parts.ts";
import { partRef } from "../store/refs.ts";
import { load, put, readRefExpectation, readTip } from "../store/session.ts";
import type { Found } from "../store/session.ts";
import { check } from "../util/json-schema.ts";

/** Where a response's parts live: what `turn` passes as its context. */
interface PartContext {
  readonly kernel: Kernel;
  readonly session: SessionId;
  readonly head: HeadName;
}

export const ABORTED: Failure = { class: "aborted", message: "The run was stopped." };

type ThoughtSignature = {
  readonly length: number;
  readonly signature: string | null;
  readonly redacted: boolean;
};

export interface OpenPart {
  readonly part: PartId;
  readonly kind: "text" | "thinking";
  markdown: string;
  /** The version views show: the created version plus one per patch published, which the settled part's version must pass. */
  version: number;
  merged: number;
  textSignature: string | null;
  readonly thoughts: ThoughtSignature[];
}

/** The writes that settle a response's open parts on the head, each in its own commit; a part the stop fence already failed keeps its text. */
export async function settledParts(
  context: PartContext,
  opened: readonly OpenPart[],
): Promise<readonly RefUpdate[]> {
  const { kernel, session, head } = context;

  if (opened.length === 0) return [];

  const [found, tip] = await Promise.all([
    Promise.all(opened.map(async (entry) => ({ entry, found: await readPart(context, entry) }))),
    readTip(kernel.store, session, head),
  ]);

  const at = Date.now();
  const updates: RefUpdate[] = [];
  let parent = tip.id;

  for (const { entry, found: part } of found) {
    if (part === null || part.record.status.kind === "settled") continue;

    if (part.record.status.kind !== "live") {
      updates.push(...(await keep(context, entry, part, ABORTED)));

      continue;
    }

    const state = buildPartState(entry);
    const version = Math.max(part.record.version, entry.version) + 1;

    const landed = await settling(kernel.store, {
      session,
      head,
      run: part.record.run,
      parent,
      expect: parent === tip.id ? readRefExpectation(tip.ref) : undefined,
      record: { ...part.record, state, version },
      revision: part.ref.revision,
      logged: [{ head, kind: "part", part: entry.part, change: "updated", state, version }],
      body: { kind: "part", part: entry.part },
      at,
    });

    updates.push(...landed.updates);
    parent = landed.landed;
  }

  return updates;
}

function buildPartState(entry: OpenPart): Json {
  if (entry.kind === "text") return { markdown: entry.markdown, signature: entry.textSignature };

  return {
    markdown: entry.markdown,
    merged: entry.merged,
    signature: entry.thoughts.some((thought) => thought.signature !== null || thought.redacted)
      ? entry.thoughts.map((thought) => ({ ...thought }))
      : null,
  };
}

async function readPart(context: PartContext, entry: OpenPart): Promise<Found<PartRecord> | null> {
  const { kernel, session } = context;

  return load(
    kernel.store,
    await kernel.store.refs.get(partRef(session, entry.part)),
    decodePartRecord,
  );
}

async function keep(
  context: PartContext,
  entry: OpenPart,
  found: Found<PartRecord>,
  failure: Failure,
): Promise<readonly RefUpdate[]> {
  const { kernel, session, head } = context;
  const { record } = found;
  const name = partRef(session, entry.part);
  const part = entry.part;
  const state = buildPartState(entry);
  const version = Math.max(record.version, entry.version) + 1;
  const live = record.status.kind === "live" || record.status.kind === "waiting";
  const status = live ? { kind: "failed", run: record.run, failure } : record.status;
  const target = await put(kernel.store, "part", { ...record, state, version, status });

  return [
    {
      name,
      target,
      expect: found.ref.revision,
      events: [{ head, kind: "part", part, change: "updated", state, version }],
    },
    ...(live
      ? [
          {
            name,
            target,
            events: [{ head, kind: "part", part, change: "failed", failure }],
          } as const,
        ]
      : []),
  ];
}

export async function keepOpen(
  context: PartContext,
  opened: readonly OpenPart[],
  failure: Failure,
): Promise<readonly RefUpdate[]> {
  const kept = await Promise.all(
    opened.map(async (entry) => {
      const found = await readPart(context, entry);

      return found === null || found.record.status.kind === "settled"
        ? []
        : keep(context, entry, found, failure);
    }),
  );

  return kept.flat();
}

/** Writes the text a response streamed into its parts and leaves them live, for the run's next driver to adopt: patches reach only the bus. */
export async function savedOpen(
  context: PartContext,
  opened: readonly OpenPart[],
): Promise<readonly RefUpdate[]> {
  const { kernel, session, head } = context;

  const saved = await Promise.all(
    opened.map(async (entry): Promise<readonly RefUpdate[]> => {
      const found = await readPart(context, entry);

      if (found === null || found.record.status.kind !== "live") return [];
      const state = buildPartState(entry);
      const version = Math.max(found.record.version, entry.version) + 1;
      const part = entry.part;

      return [
        {
          name: partRef(session, part),
          target: await put(kernel.store, "part", { ...found.record, state, version }),
          expect: found.ref.revision,
          events: [{ head, kind: "part", part, change: "updated", state, version }],
        },
      ];
    }),
  );

  return saved.flat();
}

/** A part a previous driver of the run left live, with the text it saved. */
export async function adopt(part: PartRecord): Promise<OpenPart> {
  const adopted = {
    part: part.id,
    version: part.version,
    textSignature: null,
    thoughts: [],
  };

  if (part.partKind === "text") {
    const saved = await check(text.state, part.state);

    return {
      ...adopted,
      kind: "text",
      markdown: saved.kind === "valid" ? saved.value.markdown : "",
      merged: 1,
    };
  }

  const saved = await check(thinking.state, part.state);

  return {
    ...adopted,
    kind: "thinking",
    markdown: saved.kind === "valid" ? saved.value.markdown : "",
    merged: saved.kind === "valid" ? saved.value.merged : 1,
  };
}
