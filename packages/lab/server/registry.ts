/**
 * The reviews someone created in the lab: a title, the base and head refs to
 * compare, every head the review has seen, the task and the worktree Nyte
 * codes in when it has one, and which heads you approved. Kept as one JSON
 * file beside the core store. Guides, answers and Nyte's work live in core;
 * this file only remembers what to compare and where.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { idSchema } from "@nyte-ai/schema";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { RevisionSchema, type Revision } from "../src/review/wire.ts";

const AuthorSchema = Type.Object({
  /** The core session Nyte codes in. */
  sessionId: idSchema<"session">(),
  /** Where it codes: a worktree with the review's branch checked out. */
  worktree: Type.String(),
});

export type Author = Static<typeof AuthorSchema>;

const ApprovalSchema = Type.Object({ head: Type.String(), at: Type.Number() });

const RecordSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  baseRef: Type.String(),
  headRef: Type.String(),
  createdAt: Type.Number(),
  /** Oldest first. */
  revisions: Type.Array(RevisionSchema),
  /** What you asked Nyte to build, for a review that started as a task. */
  task: Type.Optional(Type.String()),
  author: Type.Optional(AuthorSchema),
  /** Oldest first; an approval counts only while the head it names is current. */
  approvals: Type.Optional(Type.Array(ApprovalSchema)),
});

export type ReviewRecord = Static<typeof RecordSchema>;

const FileSchema = Type.Object({ reviews: Type.Array(RecordSchema) });

/** The reviews file, read once on open and rewritten whole, atomically, on every change. */
export class Registry {
  readonly #path: string;
  #reviews: ReviewRecord[];

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#path = path;
    this.#reviews = readReviews(path);
  }

  #save(): void {
    const temporary = `${this.#path}.${process.pid}.tmp`;

    writeFileSync(temporary, `${JSON.stringify({ reviews: this.#reviews }, null, 2)}\n`);
    renameSync(temporary, this.#path);
  }

  list(): readonly ReviewRecord[] {
    return this.#reviews;
  }

  get(id: string): ReviewRecord | undefined {
    return this.#reviews.find((review) => review.id === id);
  }

  create(input: {
    readonly id: string;
    readonly title: string;
    readonly baseRef: string;
    readonly headRef: string;
    readonly revision: Revision;
    readonly task?: string;
    readonly author?: Author;
  }): ReviewRecord {
    const record: ReviewRecord = {
      id: input.id,
      title: input.title,
      baseRef: input.baseRef,
      headRef: input.headRef,
      createdAt: Date.now(),
      revisions: [input.revision],
    };

    if (input.task !== undefined) record.task = input.task;

    if (input.author !== undefined) record.author = input.author;

    this.#reviews = [record, ...this.#reviews];
    this.#save();

    return record;
  }

  update(id: string, change: (record: ReviewRecord) => ReviewRecord): ReviewRecord | undefined {
    const record = this.get(id);

    if (record === undefined) return undefined;

    const next = change(record);

    this.#replace(next);

    return next;
  }

  /** Remember a head the review has not seen; a known head changes nothing. */
  observe(id: string, revision: Revision): ReviewRecord | undefined {
    const record = this.get(id);

    if (record === undefined) return undefined;

    const last = record.revisions.at(-1);

    if (last?.head === revision.head && last.base === revision.base) return record;

    const next: ReviewRecord = { ...record, revisions: [...record.revisions, revision] };

    this.#replace(next);

    return next;
  }

  /** Whether any review has compared exactly these two commits. */
  knows(base: string, head: string): boolean {
    return this.#reviews.some((review) =>
      review.revisions.some((revision) => revision.base === base && revision.head === head),
    );
  }

  #replace(next: ReviewRecord): void {
    this.#reviews = this.#reviews.map((review) => (review.id === next.id ? next : review));
    this.#save();
  }
}

/** The stored reviews, or none when the file is missing or no longer matches the schema. */
function readReviews(path: string): ReviewRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

    return Value.Check(FileSchema, parsed) ? parsed.reviews : [];
  } catch {
    return [];
  }
}
