/**
 * Reviews over real core and real git. One core session per review; one head
 * per call site, named for the git commit it is about:
 *
 *   brief-<head>   the head's guide: written from the patch, or cut from the
 *                  brief of an earlier head on the same base and sent only the
 *                  interdiff, so everything before it comes from the prompt cache
 *   side-<head>-<thread>  one side chat thread about that head: a fork of its
 *                  brief, so a question starts from everything the guide read
 *
 * A review stores refs, not commits. Reading one resolves its head ref, so a
 * branch that gained commits shows up as a new head. Reading never calls the
 * model: a head gets its guide when someone presses Write Guide or Update, by
 * interdiff when an earlier head has one. Nothing else is kept in memory:
 * heads, runs, guides and answers are read back from the store, so a reload or
 * a restart sees the same review.
 *
 * Nyte codes on the branch in a second session, `author <id>`, whose
 * workspace is a git worktree with only that branch checked out. A task
 * starts there on a new branch; a change request opens it the first time. Its
 * commits move the branch, which the review then reads like any other push.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isPart, tool } from "@nyte-ai/core";
import { asId, asSeq } from "@nyte-ai/schema";
import type {
  ConfigurationPatch,
  HeadInfo,
  Message,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  ApproveSchema,
  AskSchema,
  ChangeSchema,
  CreateReviewSchema,
  GuideSchema,
  WriteGuideSchema,
  TaskSchema,
  type Ask,
  type Author,
  type Brief,
  type Change,
  type Thread,
  type Compare,
  type Guide,
  type Patch,
  type Repo as RepoInfo,
  type Revision,
  type ReviewDetail,
  type ReviewSummary,
  type Sessions,
  type Task,
} from "../src/review/wire.ts";
import type { Repo } from "./git.ts";
import { CACHE_DIR, type ReviewHost } from "./host.ts";
import { briefPrompt, totals, updatePrompt, type Reads } from "./review-prompts.ts";
import type { Author as AuthorRecord, Registry, ReviewRecord } from "./registry.ts";
import { AUTHOR_AGENT, AUTHOR_PREFIX, REVIEW_AGENT, REVIEWER_VERSION } from "./reviewer.ts";

/** A file patch larger than this is not drawn; its counts still are. */
const DRAWN_PATCH = 400_000;

class BadRequest extends Error {}

const briefName = (head: string): string => `brief-${head.slice(0, 12)}`;

/** One side chat thread about a head: a fork of that head's brief. */
const threadPrefix = (head: string): string => `side-${head.slice(0, 12)}-`;

/** Split a multi-file `git diff` into one patch per file, keyed by its new path. */
function splitPatch(patch: string): ReadonlyMap<string, string> {
  const files = new Map<string, string>();

  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;

    const path =
      /^rename to (.+)$/m.exec(chunk)?.[1] ??
      /^\+\+\+ b\/(.+)$/m.exec(chunk)?.[1] ??
      /^--- a\/(.+)$/m.exec(chunk)?.[1] ??
      /^diff --git a\/.+ b\/(.+)$/m.exec(chunk)?.[1];

    if (path !== undefined) files.set(path, chunk);
  }

  return files;
}

interface UsageTotals {
  readonly calls: number;
  readonly fresh: number;
  readonly cached: number;
  readonly cost: number;
}

function sumUsage(events: readonly SessionEvent[]): UsageTotals {
  return events.reduce(
    (total, event) => {
      if (event.kind !== "request") return total;
      const { usage } = event;

      return {
        calls: total.calls + 1,
        fresh: total.fresh + usage.input + usage.cacheWrite,
        cached: total.cached + usage.cacheRead,
        cost: total.cost + usage.cost.total,
      };
    },
    { calls: 0, fresh: 0, cached: 0, cost: 0 },
  );
}

const tokens = (count: number): string =>
  count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);

function readGuide(messages: readonly Message[], revision: Revision): Guide | undefined {
  return messages
    .flatMap((message) => {
      if (
        !isPart(message, tool) ||
        message.state.name !== "publish_guide" ||
        message.state.phase !== "settled" ||
        message.state.outcome.kind !== "ok"
      )
        return [];
      const output = message.state.outcome.output;

      return Value.Check(GuideSchema, output) &&
        output.head === revision.head &&
        output.base === revision.base
        ? [output]
        : [];
    })
    .at(-1);
}

/** Reads between two commit ids never change, so each pair is read once. */
function memoized<T>(read: (base: string, head: string) => Promise<T>) {
  const known = new Map<string, Promise<T>>();

  return (base: string, head: string): Promise<T> => {
    const key = `${base}..${head}`;
    const found = known.get(key);

    if (found !== undefined) return found;

    const next = read(base, head);

    known.set(key, next);
    next.catch(() => known.delete(key));

    return next;
  };
}

/** A task's title: its first line, cut at a word near 72 characters. */
function readTitle(task: string): string {
  const line = task.trim().split("\n")[0]?.trim() ?? "Task";

  if (line.length <= 72) return line;

  const cut = line.slice(0, 72);

  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))}…`;
}

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "task";

async function readBody<T extends TSchema>(schema: T, request: Request): Promise<Static<T>> {
  const body: unknown = await request.json().catch(() => undefined);

  if (Value.Check(schema, body)) return body;

  const first = Value.Errors(schema, body)[0];

  throw new BadRequest(first === undefined ? "Invalid request" : first.message);
}

/** What one head has said since it forked, and whether its last run settled. */
async function readHead(sdk: ReviewHost["sdk"], sessionId: SessionId, head: HeadInfo) {
  const handle = sdk.session(sessionId).head(head.name);

  const [view, tree] = await Promise.all([
    handle.view({ tail: Number.MAX_SAFE_INTEGER }),
    handle.tree(),
  ]);

  const base = head.stack?.base;
  const baseId = base?.kind === "commit" ? base.id : undefined;

  const forkedAt =
    baseId === undefined ? null : (tree.nodes.find((node) => node.id === baseId)?.at ?? null);

  const active = tree.nodes.filter((node) => node.active);
  const start = baseId === undefined ? 0 : active.findIndex((node) => node.id === baseId) + 1;
  const commits = new Set(active.slice(start).map((node) => node.id));

  const own = view.messages.filter((message) => {
    if (message.kind === "user" && message.status.kind === "landed")
      return commits.has(message.status.commit);

    if (message.kind === "part" && message.status.kind === "settled")
      return commits.has(message.status.commit);

    return message.at > (forkedAt ?? 0);
  });

  const queued = view.messages.some(
    (message) => message.kind === "user" && message.status.kind === "pending",
  );

  const end = view.execution.kind === "idle" ? view.execution.lastRun?.end : undefined;
  const settled = view.execution.kind === "idle" && end !== undefined && !queued;

  return {
    own,
    settled,
    end,
    forkedAt,
    doneAt: settled && view.execution.kind === "idle" ? view.execution.lastRun?.endedAt : undefined,
  };
}

type HeadRead = Awaited<ReturnType<typeof readHead>>;

interface CoreState {
  readonly heads: readonly HeadInfo[];
  readonly briefs: Brief[];
  readonly threads: Thread[];
}

interface ReviewDeps {
  readonly host: ReviewHost;
  readonly repo: Repo;
  readonly registry: Registry;
  readonly log: (message: string) => void;
}

/** The review routes over one repository and one core host. */
class Reviews {
  readonly #host: ReviewHost;
  readonly #repo: Repo;
  readonly #registry: Registry;
  readonly #log: (message: string) => void;
  readonly #sdk: ReviewHost["sdk"];
  readonly #defaultBase: string;
  readonly #sessions = new Map<string, Promise<SessionId>>();
  readonly #reported = new Set<string>();
  /** Runs that settled before this server opened were reported, and paid for, by an earlier one. */
  readonly #openedAt = Date.now();
  readonly #reads: Reads = {
    commits: memoized((base, head) => this.#repo.log(base, head)),
    changes: memoized((base, head) => this.#repo.changes(base, head)),
    patch: memoized((base, head) => this.#repo.patch(base, head)),
  };
  readonly #opening = new Map<string, Promise<AuthorRecord>>();

  constructor(deps: ReviewDeps, defaultBase: string) {
    this.#host = deps.host;
    this.#repo = deps.repo;
    this.#registry = deps.registry;
    this.#log = deps.log;
    this.#sdk = deps.host.sdk;
    this.#defaultBase = defaultBase;
  }

  /** Where the review's refs point now; a ref that no longer resolves keeps its last head. */
  async #resolveRevision(record: ReviewRecord): Promise<Revision> {
    const last = record.revisions.at(-1);
    const head = await this.#repo.resolve(record.headRef);
    const baseTip = await this.#repo.resolve(record.baseRef);

    if (head === undefined || baseTip === undefined) {
      if (last === undefined) throw new BadRequest(`${record.headRef} no longer resolves`);

      return last;
    }

    const base = (await this.#repo.mergeBase(baseTip, head)) ?? baseTip;

    if (last?.head === head && last.base === base) return last;

    const revision = { head, base, at: Date.now() };

    this.#registry.observe(record.id, revision);

    return revision;
  }

  #openSession(record: ReviewRecord): Promise<SessionId> {
    const known = this.#sessions.get(record.id);

    if (known !== undefined) return known;

    const name = `review ${record.id} · reviewer ${REVIEWER_VERSION}`;

    const opened = (async () => {
      return (
        await this.#sdk.sessions.create({
          id: asId<"session">(`lab-review:${record.id}:${REVIEWER_VERSION}`),
          name,
          configuration: { ...this.#host.config, agent: REVIEW_AGENT },
        })
      ).id;
    })();

    this.#sessions.set(record.id, opened);
    opened.catch(() => this.#sessions.delete(record.id));

    return opened;
  }

  async #report(
    sessionId: SessionId,
    head: HeadInfo,
    read: HeadRead,
    status: string,
  ): Promise<void> {
    const key = `${head.name}:${read.doneAt ?? 0}`;

    if (this.#reported.has(key) || (read.doneAt ?? 0) < this.#openedAt) return;
    this.#reported.add(key);
    const events: SessionEvent[] = [];

    for await (const event of this.#sdk.inspect(sessionId).events({ after: asSeq(0) })) {
      if (event.head === head.name && event.at > (read.forkedAt ?? 0)) events.push(event);
    }

    const usage = sumUsage(events);

    this.#log(
      `${head.name} ${status} from ${head.stack?.parent ?? "the patch"}: ${usage.calls} calls, ${tokens(usage.cached)} cached, ${tokens(usage.fresh)} new, $${usage.cost.toFixed(3)}`,
    );
  }

  async #coreState(record: ReviewRecord, sessionId: SessionId): Promise<CoreState> {
    const { heads } = await this.#sdk.session(sessionId).info();
    const briefs: Brief[] = [];
    const threads: Thread[] = [];

    for (const revision of record.revisions) {
      const brief = heads.find((head) => head.name === briefName(revision.head));

      if (brief !== undefined && !briefs.some((entry) => entry.head === revision.head)) {
        const read = await readHead(this.#sdk, sessionId, brief);
        const guide = readGuide(read.own, revision);
        const base = brief.stack?.base;

        const parent =
          base?.kind === "commit"
            ? heads.find(
                (head) =>
                  head.name !== brief.name && head.tip.kind === "commit" && head.tip.id === base.id,
              )?.name
            : undefined;

        const from = record.revisions.find(
          (entry) => parent !== undefined && briefName(entry.head) === parent,
        )?.head;

        const failure =
          !read.settled || guide !== undefined
            ? undefined
            : read.end?.kind === "failed"
              ? read.end.failure.message
              : read.end?.kind === "stopped"
                ? "Stopped"
                : "The reviewer finished without publishing a guide.";

        const entry: Brief = {
          head: revision.head,
          name: brief.name,
          status: !read.settled ? "running" : failure === undefined ? "done" : "failed",
          forkedAt: read.forkedAt,
        };

        if (failure !== undefined) entry.failure = failure;

        if (guide !== undefined) entry.guide = guide;

        if (read.doneAt !== undefined) entry.doneAt = read.doneAt;

        if (from !== undefined) entry.from = from;

        if (read.settled) await this.#report(sessionId, brief, read, entry.status);
        briefs.push(entry);
      }

      const prefix = threadPrefix(revision.head);

      for (const side of heads.filter((head) => head.name.startsWith(prefix))) {
        if (threads.some((entry) => entry.name === side.name)) continue;
        const read = await readHead(this.#sdk, sessionId, side);

        threads.push({
          head: revision.head,
          thread: side.name.slice(prefix.length),
          name: side.name,
          status: read.settled ? (read.end?.kind === "failed" ? "failed" : "done") : "running",
          forkedAt: read.forkedAt,
        });
      }
    }

    return { heads, briefs, threads };
  }

  async #pinned(sessionId: SessionId, name: string): Promise<ConfigurationPatch | undefined> {
    return (
      (await this.#sdk.session(sessionId).head(asId<"head">(name)).view()).configuration
        .effective ?? undefined
    );
  }

  async #fork(input: {
    readonly sessionId: SessionId;
    readonly head: string;
    readonly from: string;
    readonly config: ConfigurationPatch | undefined;
    readonly key: string;
    readonly content: string;
  }): Promise<void> {
    const session = this.#sdk.session(input.sessionId);
    const from = session.head(asId<"head">(input.from));

    const created = await session.heads.create(asId<"head">(input.head), {
      from: (await from.tree()).tip,
    });

    if (created.kind === "missing-source") throw new BadRequest(`${input.from} is gone`);
    const head = session.head(asId<"head">(input.head));

    if (created.kind === "created") {
      const configured = await head.configure({ ...input.config, agent: REVIEW_AGENT });

      if (configured.kind !== "configured")
        throw new BadRequest(`The review model is not available: ${configured.kind}`);
    }

    await head.send(input.content, { id: asId<"receipt">(input.key) });
  }

  /**
   * Ask for the current head's guide unless it exists. An earlier head on the
   * same base that the current one descends from lends its brief, so only the
   * interdiff is new; while that brief is still running, wait for it. A
   * branch with no commits past its base has nothing to guide yet. A fresh
   * brief is cut from the unborn `main` so the runner lists it before its
   * message lands.
   */
  async #ensureBrief(
    record: ReviewRecord,
    sessionId: SessionId,
    revision: Revision,
    state: CoreState,
    retry: boolean,
  ): Promise<void> {
    if (revision.head === revision.base) return;

    const name = briefName(revision.head);
    const existing = state.briefs.find((entry) => entry.head === revision.head);

    if (existing !== undefined && !(retry && existing.status === "failed")) return;

    if (existing !== undefined) {
      const outcome = await this.#sdk.session(sessionId).heads.remove(asId<"head">(name));

      if (outcome.kind === "busy") throw new BadRequest(`${name} is still running`);
    }

    const earlier = [...record.revisions]
      .reverse()
      .filter((entry) => entry.base === revision.base && entry.head !== revision.head);

    const lenders = await Promise.all(
      earlier.map(async (entry) => ({
        entry,
        brief: state.briefs.find((brief) => brief.head === entry.head),
        descends: await this.#repo.descends(entry.head, revision.head),
      })),
    );

    if (lenders.some((lender) => lender.descends && lender.brief?.status === "running")) return;

    const lender = lenders.find(
      (candidate) =>
        candidate.descends &&
        candidate.brief?.status === "done" &&
        candidate.brief.guide !== undefined,
    )?.entry;

    await this.#fork({
      sessionId,
      head: name,
      from: lender === undefined ? "main" : briefName(lender.head),
      config:
        lender === undefined
          ? this.#host.config
          : await this.#pinned(sessionId, briefName(lender.head)),
      key: retry ? `${name}-retry-${Date.now()}` : name,
      content:
        lender === undefined
          ? await briefPrompt(this.#reads, record, revision)
          : await updatePrompt(this.#reads, record, lender.head, revision),
    });
    this.#log(
      lender === undefined
        ? `${name}: writing the guide for ${record.title} from the patch`
        : `${name}: cut from ${briefName(lender.head)}, sending the interdiff`,
    );
  }

  #worktreePath(id: string): string {
    return join(CACHE_DIR, "worktrees", id);
  }

  async #openAuthor(id: string, worktree: string): Promise<SessionId> {
    const workspace = await this.#sdk.workspaces.add({ kind: "local", path: worktree });

    if (workspace.kind !== "added" && workspace.kind !== "exists")
      throw new BadRequest(`The worktree is unavailable: ${workspace.kind}`);

    return (
      await this.#sdk.sessions.create({
        id: asId<"session">(`lab-author:${id}`),
        name: `${AUTHOR_PREFIX}${id}`,
        workspace: workspace.workspace,
        configuration: { ...this.#host.config, agent: AUTHOR_AGENT },
      })
    ).id;
  }

  /** Why Nyte cannot code on this review's branch, or undefined when it can. */
  async #checkAuthorBlock(record: ReviewRecord): Promise<string | undefined> {
    if (record.author !== undefined) return undefined;

    if (!(await this.#repo.hasBranch(record.headRef)))
      return `${record.headRef} is not a local branch, so Nyte has nowhere to commit.`;

    const taken = (await this.#repo.worktrees()).find((tree) => tree.branch === record.headRef);

    return taken === undefined
      ? undefined
      : `${record.headRef} is checked out at ${taken.path}. Nyte codes in a worktree of its own, so it leaves a branch checked out elsewhere alone.`;
  }

  /** Nyte's session on the branch, opened in a new worktree the first time it is asked for. */
  #openReviewAuthor(record: ReviewRecord): Promise<AuthorRecord> {
    if (record.author !== undefined) return Promise.resolve(record.author);

    const known = this.#opening.get(record.id);

    if (known !== undefined) return known;

    const opened = (async () => {
      const blocked = await this.#checkAuthorBlock(record);

      if (blocked !== undefined) throw new BadRequest(blocked);

      const worktree = this.#worktreePath(record.id);

      if (!(await this.#repo.worktrees()).some((tree) => tree.path === worktree))
        await this.#repo.addWorktree(worktree, record.headRef);

      const author = { sessionId: await this.#openAuthor(record.id, worktree), worktree };

      this.#registry.update(record.id, (current) => ({ ...current, author }));
      this.#log(`${record.headRef}: Nyte opened a worktree at ${worktree}`);

      return author;
    })();

    this.#opening.set(record.id, opened);
    opened.finally(() => this.#opening.delete(record.id)).catch(() => undefined);

    return opened;
  }

  async #authorState(author: AuthorRecord): Promise<Author> {
    const view = await this.#sdk.session(author.sessionId).view();

    const queued = view.messages.some(
      (message) => message.kind === "user" && message.status.kind === "pending",
    );

    const end = view.execution.kind === "idle" ? view.execution.lastRun?.end : undefined;
    const working = queued || view.execution.kind !== "idle";

    const state: Author = {
      sessionId: author.sessionId,
      worktree: author.worktree,
      status: working ? "working" : end?.kind === "failed" ? "failed" : "idle",
    };

    if (!working && end?.kind === "failed") state.failure = end.failure.message;

    return state;
  }

  #find(id: string): ReviewRecord {
    const record = this.#registry.get(id);

    if (record === undefined) throw new BadRequest(`No review ${id}`);

    return record;
  }

  /** Reading a review never calls the model: the guide is written when someone opens it. */
  async #detail(id: string): Promise<ReviewDetail> {
    const revision = await this.#resolveRevision(this.#find(id));
    const record = this.#find(id);
    const sessionId = await this.#openSession(record);
    const state = await this.#coreState(record, sessionId);

    const [list, files] = await Promise.all([
      this.#reads.commits(revision.base, revision.head),
      this.#reads.changes(revision.base, revision.head),
    ]);

    const view: ReviewDetail = {
      id: record.id,
      title: record.title,
      baseRef: record.baseRef,
      headRef: record.headRef,
      sessionId,
      createdAt: record.createdAt,
      approvals: record.approvals ?? [],
      revision,
      revisions: record.revisions,
      commits: [...list],
      files: [...files],
      briefs: state.briefs,
      threads: state.threads,
    };

    if (record.task !== undefined) view.task = record.task;

    if (record.author !== undefined) view.author = await this.#authorState(record.author);
    else {
      const blocked = await this.#checkAuthorBlock(record);

      if (blocked !== undefined) view.blocked = blocked;
    }

    return view;
  }

  async #summary(record: ReviewRecord): Promise<ReviewSummary> {
    const revision = await this.#resolveRevision(record);

    const [list, files, sessionId] = await Promise.all([
      this.#reads.commits(revision.base, revision.head),
      this.#reads.changes(revision.base, revision.head),
      this.#openSession(record),
    ]);

    const state = await this.#coreState(this.#find(record.id), sessionId);
    const current = state.briefs.find((brief) => brief.head === revision.head);
    const latest = [...state.briefs].reverse().find((brief) => brief.guide !== undefined);
    const sum = totals(files);

    return {
      id: record.id,
      title: record.title,
      baseRef: record.baseRef,
      headRef: record.headRef,
      head: revision.head,
      commits: list.length,
      files: files.length,
      added: sum.added,
      removed: sum.removed,
      guide: current?.status ?? "none",
      moved: latest !== undefined && latest.head !== revision.head,
      author:
        record.author === undefined ? "none" : (await this.#authorState(record.author)).status,
      approved: (record.approvals ?? []).at(-1)?.head === revision.head,
      createdAt: record.createdAt,
    };
  }

  async #compare(baseRef: string, headRef: string): Promise<Compare> {
    const [baseTip, head] = await Promise.all([
      this.#repo.resolve(baseRef),
      this.#repo.resolve(headRef),
    ]);

    if (baseTip === undefined) throw new BadRequest(`${baseRef} is not a commit`);

    if (head === undefined) throw new BadRequest(`${headRef} is not a commit`);

    const base = (await this.#repo.mergeBase(baseTip, head)) ?? baseTip;
    const [list, files] = await Promise.all([
      this.#reads.commits(base, head),
      this.#reads.changes(base, head),
    ]);
    const sum = totals(files);

    return { base, head, commits: [...list], files: files.length, ...sum };
  }

  async #create(input: Static<typeof CreateReviewSchema>): Promise<{ id: string }> {
    const compared = await this.#compare(input.base, input.head);

    if (compared.files === 0) throw new BadRequest("These commits change no files");

    const record = this.#registry.create({
      id: randomUUID().slice(0, 8),
      title: input.title.trim(),
      baseRef: input.base,
      headRef: input.head,
      revision: { head: compared.head, base: compared.base, at: Date.now() },
    });

    await this.#openSession(record);

    return { id: record.id };
  }

  /**
   * The one call that spends on a guide: the page makes it only when you press
   * Write Guide, Update or Try Again.
   */
  async #writeGuide(id: string, head: string): Promise<void> {
    const record = this.#find(id);
    const revision = await this.#resolveRevision(record);

    if (revision.head !== head)
      throw new BadRequest(`The branch moved to ${revision.head.slice(0, 7)}; reload the review`);

    const sessionId = await this.#openSession(record);

    await this.#ensureBrief(
      record,
      sessionId,
      revision,
      await this.#coreState(record, sessionId),
      true,
    );
  }

  async #patches(id: string, base: string, head: string): Promise<readonly Patch[]> {
    this.#find(id);

    const [baseOid, headOid] = await Promise.all([
      this.#repo.resolve(base),
      this.#repo.resolve(head),
    ]);

    if (baseOid === undefined || headOid === undefined) throw new BadRequest("Unknown commits");

    const [files, patch] = await Promise.all([
      this.#reads.changes(baseOid, headOid),
      this.#reads.patch(baseOid, headOid),
    ]);

    const split = splitPatch(patch);

    return files.map((file) => {
      const text = split.get(file.path) ?? "";
      const truncated = text.length > DRAWN_PATCH;

      return { ...file, patch: truncated ? "" : text, truncated };
    });
  }

  /** A thread's first question cuts it from the brief; later ones land on the same fork. */
  async #ask(id: string, input: Ask): Promise<void> {
    const record = this.#find(id);
    const sessionId = await this.#openSession(record);
    const state = await this.#coreState(record, sessionId);
    const brief = state.briefs.find((entry) => entry.head === input.head);

    if (brief?.status !== "done" || brief.guide === undefined)
      throw new BadRequest("Side chats fork the guide; write it first");

    await this.#fork({
      sessionId,
      head: `${threadPrefix(input.head)}${input.thread}`,
      from: brief.name,
      config: await this.#pinned(sessionId, brief.name),
      key: input.key,
      content: input.text,
    });
  }

  /** A new branch from `base`, checked out in a worktree of its own, with Nyte working the task there. */
  async #startTask(input: Task): Promise<{ id: string }> {
    const baseTip = await this.#repo.resolve(input.base);

    if (baseTip === undefined) throw new BadRequest(`${input.base} is not a commit`);

    const id = randomUUID().slice(0, 8);
    const title = readTitle(input.task);
    const branch = `nyte/${slug(title)}-${id.slice(0, 4)}`;
    const worktree = this.#worktreePath(id);

    await this.#repo.addWorktree(worktree, branch, baseTip);

    const authorSession = await this.#openAuthor(id, worktree);

    this.#registry.create({
      id,
      title,
      baseRef: input.base,
      headRef: branch,
      revision: { head: baseTip, base: baseTip, at: Date.now() },
      task: input.task,
      author: { sessionId: authorSession, worktree },
    });
    await this.#sdk.session(authorSession).send(input.task, { id: asId<"receipt">(`task-${id}`) });
    this.#log(`${branch}: Nyte started "${title}" in ${worktree}`);

    return { id };
  }

  async #change(id: string, input: Change): Promise<void> {
    const author = await this.#openReviewAuthor(this.#find(id));

    await this.#sdk.session(author.sessionId).send(input.text, { id: asId<"receipt">(input.key) });
  }

  /** Approve the head the branch is at; a later push leaves the approval behind. */
  async #approve(id: string, head: string): Promise<void> {
    const revision = await this.#resolveRevision(this.#find(id));

    if (revision.head !== head)
      throw new BadRequest("The branch moved. Review the new head first.");

    this.#registry.update(id, (record) => ({
      ...record,
      approvals: [...(record.approvals ?? []), { head, at: Date.now() }],
    }));
  }

  async #readSessions(id: string): Promise<Sessions> {
    const record = this.#find(id);
    const reply: Sessions = { sessionId: await this.#openSession(record) };

    if (record.author !== undefined) reply.authorSessionId = record.author.sessionId;

    return reply;
  }

  async #repoInfo(): Promise<RepoInfo> {
    const [branches, current] = await Promise.all([
      this.#repo.branches(this.#defaultBase),
      this.#repo.current(),
    ]);
    const info: RepoInfo = {
      root: this.#repo.root,
      base: this.#defaultBase,
      branches: [...branches],
    };

    if (current !== undefined) info.current = current;

    return info;
  }

  #json(
    body:
      | RepoInfo
      | Compare
      | ReviewDetail
      | { readonly reviews: readonly ReviewSummary[] }
      | { readonly id: string }
      | Sessions
      | { readonly patches: readonly Patch[] }
      | { readonly error: string },
    status = 200,
  ): Response {
    return Response.json(body, { status });
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter((part) => part !== "");
    const route = `${request.method} /${parts.map((part, index) => (index === 1 ? ":id" : part)).join("/")}`;
    const id = parts[1] ?? "";

    try {
      switch (route) {
        case "GET /this.#repo":
          return this.#json(await this.#repoInfo());
        case "GET /compare":
          return this.#json(
            await this.#compare(
              url.searchParams.get("base") ?? "",
              url.searchParams.get("head") ?? "",
            ),
          );
        case "GET /reviews":
          return this.#json({
            reviews: await Promise.all(
              this.#registry.list().map((record) => this.#summary(record)),
            ),
          });
        case "POST /reviews":
          return this.#json(await this.#create(await readBody(CreateReviewSchema, request)));
        case "GET /reviews/:id":
          return this.#json(await this.#detail(id));
        case "GET /reviews/:id/session":
          return this.#json(await this.#readSessions(id));
        case "POST /tasks":
          return this.#json(await this.#startTask(await readBody(TaskSchema, request)));
        case "POST /reviews/:id/change":
          await this.#change(id, await readBody(ChangeSchema, request));

          return this.#json(await this.#detail(id));
        case "POST /reviews/:id/approve":
          await this.#approve(id, (await readBody(ApproveSchema, request)).head);

          return this.#json(await this.#detail(id));
        case "POST /reviews/:id/guide":
          await this.#writeGuide(id, (await readBody(WriteGuideSchema, request)).head);

          return this.#json(await this.#detail(id));
        case "GET /reviews/:id/patches":
          return this.#json({
            patches: await this.#patches(
              id,
              url.searchParams.get("base") ?? "",
              url.searchParams.get("head") ?? "",
            ),
          });
        case "POST /reviews/:id/ask":
          await this.#ask(id, await readBody(AskSchema, request));

          return this.#json(await this.#detail(id));
        default:
          return this.#json({ error: `No route ${route}` }, 404);
      }
    } catch (cause) {
      if (cause instanceof BadRequest) return this.#json({ error: cause.message }, 400);

      this.#log(
        `${route} failed: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`,
      );

      return this.#json({ error: cause instanceof Error ? cause.message : String(cause) }, 500);
    }
  }
}

export async function createReviews(
  deps: ReviewDeps,
): Promise<(request: Request) => Promise<Response>> {
  const defaultBase =
    (await deps.repo.resolve("origin/main")) === undefined ? "main" : "origin/main";
  const reviews = new Reviews(deps, defaultBase);

  return (request) => reviews.handle(request);
}
