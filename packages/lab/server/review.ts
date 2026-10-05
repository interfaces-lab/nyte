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
import { calculateCost, type MutableModels } from "@nyte-ai/ai";
import { isThinkingLevel } from "@nyte-ai/core";
import { branch, type Session } from "@nyte-ai/core/store";
import { environmentId } from "@nyte-ai/host";
import {
  isTerminalPhase,
  type Commit,
  type HeadInfo,
  type RunConfig,
  type SessionId,
} from "@nyte-ai/protocol";
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
  type FileChange,
  type Guide,
  type Patch,
  type Repo as RepoInfo,
  type Revision,
  type ReviewDetail,
  type ReviewSummary,
  type Sessions,
  type Task,
} from "../src/review/wire.ts";
import type { CommitInfo, Repo } from "./git.ts";
import { CACHE_DIR, type ReviewHost } from "./host.ts";
import type { Author as AuthorRecord, Registry, ReviewRecord } from "./registry.ts";
import { AUTHOR_PREFIX, REVIEWER_VERSION } from "./reviewer.ts";

/** Patches up to this size ride in the brief; larger ones are read with diff_file. */
const INLINE_PATCH = 60_000;

/** A file patch larger than this is not drawn; its counts still are. */
const DRAWN_PATCH = 400_000;

const LISTED_COMMITS = 80;

class BadRequest extends Error {}

const briefName = (head: string): string => `brief-${head.slice(0, 12)}`;

/** One side chat thread about a head: a fork of that head's brief. */
const threadPrefix = (head: string): string => `side-${head.slice(0, 12)}-`;

function fenced(language: string, text: string): string {
  return ["```" + language, text.replace(/\n$/, ""), "```"].join("\n");
}

function commitLines(commits: readonly CommitInfo[]): readonly string[] {
  const shown = commits
    .slice(0, LISTED_COMMITS)
    .map((entry) => `- ${entry.short} ${entry.subject} (${entry.author})`);

  const rest = commits.length - shown.length;

  return rest > 0 ? [...shown, `- … and ${rest} older commits`] : shown;
}

function fileLines(files: readonly FileChange[]): readonly string[] {
  const letter = { added: "A", modified: "M", deleted: "D", renamed: "R" } as const;

  return files.map(
    (file) =>
      `${letter[file.status]} ${file.path}${file.previousPath === undefined ? "" : ` (from ${file.previousPath})`} +${file.added} −${file.removed}`,
  );
}

function totals(files: readonly FileChange[]) {
  return {
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

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
  readonly uncachedCost: number;
}

/** Every model call on `commits`, and what it would have cost with no cache at all. */
function usageOf(commits: readonly Commit[], models: MutableModels): UsageTotals {
  return commits.reduce(
    (total, commit) => {
      if (commit.body.kind !== "message" || commit.body.message.role !== "assistant") return total;

      const { usage, provider, model: id } = commit.body.message;
      const model = models.getModel(provider, id);

      const uncachedCost =
        model === undefined
          ? usage.cost.total
          : calculateCost(model, {
              input: usage.input + usage.cacheRead + usage.cacheWrite,
              output: usage.output,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: usage.totalTokens,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            }).total;

      return {
        calls: total.calls + 1,
        fresh: total.fresh + usage.input + usage.cacheWrite,
        cached: total.cached + usage.cacheRead,
        cost: total.cost + usage.cost.total,
        uncachedCost: total.uncachedCost + uncachedCost,
      };
    },
    { calls: 0, fresh: 0, cached: 0, cost: 0, uncachedCost: 0 },
  );
}

const tokens = (count: number): string =>
  count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);

function guideOf(commits: readonly Commit[], revision: Revision): Guide | undefined {
  return commits
    .flatMap((commit) => {
      if (commit.body.kind !== "message") return [];

      const message = commit.body.message;

      if (message.role !== "toolResult" || message.toolName !== "publish_guide" || message.isError)
        return [];

      const details: unknown = message.details;

      return Value.Check(GuideSchema, details) &&
        details.head === revision.head &&
        details.base === revision.base
        ? [details]
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

/** A message with the code it is about: each reference fenced under its place in the change. */
function message(text: string, references: Ask["references"]): string {
  const quoted = references.map(
    (reference) =>
      `${reference.path}:${reference.start}-${reference.end} (${reference.side === "new" ? "head" : "base"} ${reference.revision})\n${fenced("", reference.text)}`,
  );

  return [text, ...quoted].filter((part) => part !== "").join("\n\n");
}

/** A task's title: its first line, cut at a word near 72 characters. */
function titleOf(task: string): string {
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

export async function createReviews(deps: {
  readonly host: ReviewHost;
  readonly repo: Repo;
  readonly registry: Registry;
  readonly log: (message: string) => void;
}) {
  const { host, repo, registry, log } = deps;
  const { sdk } = host;
  const defaultBase = (await repo.resolve("origin/main")) === undefined ? "main" : "origin/main";
  const sessions = new Map<string, Promise<SessionId>>();
  const reported = new Set<string>();
  /** Runs that settled before this server opened were reported, and paid for, by an earlier one. */
  const openedAt = Date.now();
  const changes = memoized((base, head) => repo.changes(base, head));
  const commits = memoized((base, head) => repo.log(base, head));
  const fullPatch = memoized((base, head) => repo.patch(base, head));

  /** Where the review's refs point now; a ref that no longer resolves keeps its last head. */
  const revisionOf = async (record: ReviewRecord): Promise<Revision> => {
    const last = record.revisions.at(-1);
    const head = await repo.resolve(record.headRef);
    const baseTip = await repo.resolve(record.baseRef);

    if (head === undefined || baseTip === undefined) {
      if (last === undefined) throw new BadRequest(`${record.headRef} no longer resolves`);

      return last;
    }

    const base = (await repo.mergeBase(baseTip, head)) ?? baseTip;

    if (last?.head === head && last.base === base) return last;

    const revision = { head, base, at: Date.now() };

    registry.observe(record.id, revision);

    return revision;
  };

  const sessionOf = (record: ReviewRecord): Promise<SessionId> => {
    const known = sessions.get(record.id);

    if (known !== undefined) return known;

    const name = `review ${record.id} · reviewer ${REVIEWER_VERSION}`;

    const opened = (async () => {
      const page = await sdk.sessions.list({ search: name, limit: 20 });
      const found = page.items.find((item) => item.name === name && !item.archived);

      return found?.sessionId ?? (await sdk.sessions.create({ name })).sessionId;
    })();

    sessions.set(record.id, opened);
    opened.catch(() => sessions.delete(record.id));

    return opened;
  };

  /** A head's status, its own commits after the fork point, and when it was cut. */
  const readHead = async (store: Session, sessionId: SessionId, head: HeadInfo) => {
    const base = head.stack?.base ?? null;
    const entries = await branch(store.objects, head.tip);
    const start = base === null ? 0 : entries.findIndex((entry) => entry.oid === base) + 1;
    const own = entries.slice(start).map((entry) => entry.commit);
    const phase = head.run?.phase;
    const terminal = phase !== undefined && isTerminalPhase(phase);

    // A message waiting on the head is work the run has not started yet.
    const queued =
      phase === undefined || terminal
        ? (await sdk.messages.pending({ sessionId, head: head.head })).length
        : 0;

    const settled = terminal && queued === 0;

    return {
      own,
      settled,
      phase,
      forkedAt: start === 0 ? null : (entries[start - 1]?.commit.at ?? null),
      doneAt: settled ? own.at(-1)?.at : undefined,
    };
  };

  const report = (name: string, from: string, own: readonly Commit[], status: string): void => {
    const key = `${name}:${own.length}`;

    if (reported.has(key)) return;

    reported.add(key);

    if ((own.at(-1)?.at ?? 0) < openedAt) return;

    const usage = usageOf(own, host.models);

    log(
      `${name} ${status} from ${from}: ${usage.calls} calls, ${tokens(usage.cached)} cached, ` +
        `${tokens(usage.fresh)} new, $${usage.cost.toFixed(3)} ($${usage.uncachedCost.toFixed(3)} without the cache)`,
    );
  };

  const spentOn = (own: readonly Commit[]) => {
    const { calls, cached, fresh, cost } = usageOf(own, host.models);

    return { calls, cached, fresh, cost };
  };

  /** Every brief and side chat thread the review session holds, read from core. */
  const coreState = async (record: ReviewRecord, sessionId: SessionId) => {
    const store = await host.store.open(sessionId);

    try {
      const heads = await sdk.heads.list({ sessionId });
      const briefs: Brief[] = [];
      const threads: Thread[] = [];

      for (const revision of record.revisions) {
        const brief = heads.find((head) => head.head === briefName(revision.head));

        if (brief !== undefined && !briefs.some((entry) => entry.head === revision.head)) {
          const read = await readHead(store, sessionId, brief);
          const guide = guideOf(read.own, revision);
          const parent = brief.stack?.base === null ? undefined : brief.stack?.parent;

          const from = record.revisions.find(
            (entry) => parent !== undefined && briefName(entry.head) === parent,
          )?.head;

          // A published guide passed publish_guide's checks; how the closing reply ended does not undo it.
          const failure =
            !read.settled || guide !== undefined
              ? undefined
              : read.phase?.kind === "failed"
                ? read.phase.failure.message
                : read.phase?.kind === "aborted"
                  ? "Stopped"
                  : "The reviewer finished without publishing a guide.";

          const entry: Brief = {
            head: revision.head,
            name: brief.head,
            status: !read.settled ? "running" : failure === undefined ? "done" : "failed",
            forkedAt: read.forkedAt,
            usage: spentOn(read.own),
          };

          if (failure !== undefined) entry.failure = failure;

          if (guide !== undefined) entry.guide = guide;

          if (read.doneAt !== undefined) entry.doneAt = read.doneAt;

          if (from !== undefined) entry.from = from;

          if (read.settled) report(brief.head, parent ?? "the patch", read.own, entry.status);

          briefs.push(entry);
        }

        const prefix = threadPrefix(revision.head);

        for (const side of heads.filter((head) => head.head.startsWith(prefix))) {
          if (threads.some((entry) => entry.name === side.head)) continue;

          const read = await readHead(store, sessionId, side);

          threads.push({
            head: revision.head,
            thread: side.head.slice(prefix.length),
            name: side.head,
            status: read.settled ? (read.phase?.kind === "failed" ? "failed" : "done") : "running",
            forkedAt: read.forkedAt,
            usage: spentOn(read.own),
          });
        }
      }

      return { heads, briefs, threads };
    } finally {
      await store.close();
    }
  };

  /** What `head` last ran with: a fork pins it, because a cached prefix belongs to one model. */
  const pinned = (heads: readonly HeadInfo[], name: string): RunConfig | undefined =>
    heads.find((head) => head.head === name)?.run?.config;

  /**
   * Cut `head` from `from`, pin the model and effort it must share a cache
   * with, and send it one message. A repeat finds the head and the key, and
   * changes nothing.
   */
  const fork = async (input: {
    readonly sessionId: SessionId;
    readonly head: string;
    readonly from: string;
    readonly config: RunConfig | undefined;
    readonly key: string;
    readonly content: string;
  }): Promise<void> => {
    const created = await sdk.heads.create({
      sessionId: input.sessionId,
      head: input.head,
      from: { head: input.from },
    });

    if (created.kind === "unknown_parent") throw new BadRequest(`${input.from} is gone`);

    const model = input.config?.model;
    const level = input.config?.thinkingLevel;

    if (created.kind === "created" && model?.provider !== undefined) {
      const configured = await sdk.sessions.configure({
        sessionId: input.sessionId,
        head: input.head,
        model: { provider: model.provider, id: model.id },
        thinkingLevel: level !== undefined && isThinkingLevel(level) ? level : undefined,
      });

      if (configured.kind !== "queued")
        throw new BadRequest(`${model.provider}/${model.id} is not available: ${configured.kind}`);
    }

    await sdk.messages.send({
      sessionId: input.sessionId,
      head: input.head,
      key: input.key,
      content: input.content,
    });
  };

  const briefPrompt = async (record: ReviewRecord, revision: Revision): Promise<string> => {
    const [list, files, patch] = await Promise.all([
      commits(revision.base, revision.head),
      changes(revision.base, revision.head),
      fullPatch(revision.base, revision.head),
    ]);

    const sum = totals(files);

    return [
      `Review: ${record.title}`,
      `Base: ${revision.base} (${record.baseRef})`,
      `Head: ${revision.head} (${record.headRef})`,
      "",
      `${list.length} commits, newest first:`,
      ...commitLines(list),
      "",
      `${files.length} changed files, +${sum.added} −${sum.removed}:`,
      ...fileLines(files),
      "",
      patch.length <= INLINE_PATCH
        ? `Patch:\n${fenced("diff", patch)}`
        : `The patch is ${patch.split("\n").length} lines, too long to include. Read files with diff_file from ${revision.base} to ${revision.head}.`,
      "",
      `Write the guide for ${revision.head}.`,
    ].join("\n");
  };

  const updatePrompt = async (
    record: ReviewRecord,
    from: string,
    revision: Revision,
  ): Promise<string> => {
    const [added, before, after, interdiff] = await Promise.all([
      commits(from, revision.head),
      changes(revision.base, from),
      changes(revision.base, revision.head),
      fullPatch(from, revision.head),
    ]);

    const was = new Set(before.map((file) => file.path));
    const now = new Set(after.map((file) => file.path));
    const joined = after.filter((file) => !was.has(file.path)).map((file) => file.path);
    const left = before.filter((file) => !now.has(file.path)).map((file) => file.path);

    return [
      `${record.headRef} moved from ${from} to ${revision.head}; the base is unchanged.`,
      "",
      "New commits, newest first:",
      ...commitLines(added),
      "",
      joined.length === 0
        ? "No file joined the change."
        : `Files that joined the change: ${joined.join(", ")}`,
      left.length === 0
        ? "No file left the change."
        : `Files that left the change: ${left.join(", ")}`,
      "",
      interdiff.length <= INLINE_PATCH
        ? `Interdiff ${from}..${revision.head}:\n${fenced("diff", interdiff)}`
        : `The interdiff is too long to include. Read it with diff_file from ${from} to ${revision.head}.`,
      "",
      `Write the guide for ${revision.head}: publish the complete guide for ${revision.base}..${revision.head}, not only what changed.`,
    ].join("\n");
  };

  /**
   * Ask for the current head's guide unless it exists. An earlier head on the
   * same base that the current one descends from lends its brief, so only the
   * interdiff is new; while that brief is still running, wait for it.
   */
  const ensureBrief = async (
    record: ReviewRecord,
    sessionId: SessionId,
    revision: Revision,
    state: Awaited<ReturnType<typeof coreState>>,
    retry: boolean,
  ): Promise<void> => {
    // A branch with no commits past its base has nothing to guide yet.
    if (revision.head === revision.base) return;

    const name = briefName(revision.head);
    const existing = state.briefs.find((entry) => entry.head === revision.head);

    if (existing !== undefined && !(retry && existing.status === "failed")) return;

    if (existing !== undefined) {
      const outcome = await sdk.heads.delete({ sessionId, head: name });

      if (outcome.kind === "busy") throw new BadRequest(`${name} is still running`);
    }

    const earlier = [...record.revisions]
      .reverse()
      .filter((entry) => entry.base === revision.base && entry.head !== revision.head);

    const lenders = await Promise.all(
      earlier.map(async (entry) => ({
        entry,
        brief: state.briefs.find((brief) => brief.head === entry.head),
        descends: await repo.isAncestor(entry.head, revision.head),
      })),
    );

    if (lenders.some((lender) => lender.descends && lender.brief?.status === "running")) return;

    const lender = lenders.find(
      (candidate) =>
        candidate.descends &&
        candidate.brief?.status === "done" &&
        candidate.brief.guide !== undefined,
    )?.entry;

    await fork({
      sessionId,
      head: name,
      // A fresh brief is cut from the unborn `main` so the runner lists it before its message lands.
      from: lender === undefined ? "main" : briefName(lender.head),
      config: lender === undefined ? host.config : pinned(state.heads, briefName(lender.head)),
      key: retry ? `${name}-retry-${Date.now()}` : name,
      content:
        lender === undefined
          ? await briefPrompt(record, revision)
          : await updatePrompt(record, lender.head, revision),
    });
    log(
      lender === undefined
        ? `${name}: writing the guide for ${record.title} from the patch`
        : `${name}: cut from ${briefName(lender.head)}, sending the interdiff`,
    );
  };

  const environment = await environmentId();
  const opening = new Map<string, Promise<AuthorRecord>>();
  const worktreeOf = (id: string): string => join(CACHE_DIR, "worktrees", id);

  const openAuthor = async (id: string, worktree: string) =>
    (
      await sdk.sessions.create({
        name: `${AUTHOR_PREFIX}${id}`,
        workspace: { kind: "local", id: environment, cwd: worktree },
      })
    ).sessionId;

  /** Why Nyte cannot code on this review's branch, or undefined when it can. */
  const blockedOf = async (record: ReviewRecord): Promise<string | undefined> => {
    if (record.author !== undefined) return undefined;

    if (!(await repo.isBranch(record.headRef)))
      return `${record.headRef} is not a local branch, so Nyte has nowhere to commit.`;

    const taken = (await repo.worktrees()).find((tree) => tree.branch === record.headRef);

    return taken === undefined
      ? undefined
      : `${record.headRef} is checked out at ${taken.path}. Nyte codes in a worktree of its own, so it leaves a branch checked out elsewhere alone.`;
  };

  /** Nyte's session on the branch, opened in a new worktree the first time it is asked for. */
  const authorOf = (record: ReviewRecord): Promise<AuthorRecord> => {
    if (record.author !== undefined) return Promise.resolve(record.author);

    const known = opening.get(record.id);

    if (known !== undefined) return known;

    const opened = (async () => {
      const blocked = await blockedOf(record);

      if (blocked !== undefined) throw new BadRequest(blocked);

      const worktree = worktreeOf(record.id);

      if (!(await repo.worktrees()).some((tree) => tree.path === worktree))
        await repo.addWorktree(worktree, record.headRef);

      const author = { sessionId: await openAuthor(record.id, worktree), worktree };

      registry.update(record.id, (current) => ({ ...current, author }));
      log(`${record.headRef}: Nyte opened a worktree at ${worktree}`);

      return author;
    })();

    opening.set(record.id, opened);
    opened.finally(() => opening.delete(record.id)).catch(() => undefined);

    return opened;
  };

  const authorState = async (author: AuthorRecord): Promise<Author> => {
    const [run, queued] = await Promise.all([
      sdk.runs.current({ sessionId: author.sessionId }),
      sdk.messages.pending({ sessionId: author.sessionId }),
    ]);

    const phase = run?.phase;
    const working = queued.length > 0 || (phase !== undefined && !isTerminalPhase(phase));

    const state: Author = {
      sessionId: author.sessionId,
      worktree: author.worktree,
      status: working ? "working" : phase?.kind === "failed" ? "failed" : "idle",
    };

    if (!working && phase?.kind === "failed") state.failure = phase.failure.message;

    return state;
  };

  const find = (id: string): ReviewRecord => {
    const record = registry.get(id);

    if (record === undefined) throw new BadRequest(`No review ${id}`);

    return record;
  };

  /** Reading a review never calls the model: the guide is written when someone opens it. */
  const detail = async (id: string): Promise<ReviewDetail> => {
    const revision = await revisionOf(find(id));
    const record = find(id);
    const sessionId = await sessionOf(record);
    const state = await coreState(record, sessionId);

    const [list, files] = await Promise.all([
      commits(revision.base, revision.head),
      changes(revision.base, revision.head),
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

    if (record.author !== undefined) view.author = await authorState(record.author);
    else {
      const blocked = await blockedOf(record);

      if (blocked !== undefined) view.blocked = blocked;
    }

    return view;
  };

  const summary = async (record: ReviewRecord): Promise<ReviewSummary> => {
    const revision = await revisionOf(record);

    const [list, files, sessionId] = await Promise.all([
      commits(revision.base, revision.head),
      changes(revision.base, revision.head),
      sessionOf(record),
    ]);

    const state = await coreState(find(record.id), sessionId);
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
      author: record.author === undefined ? "none" : (await authorState(record.author)).status,
      approved: (record.approvals ?? []).at(-1)?.head === revision.head,
      createdAt: record.createdAt,
    };
  };

  const compare = async (baseRef: string, headRef: string): Promise<Compare> => {
    const [baseTip, head] = await Promise.all([repo.resolve(baseRef), repo.resolve(headRef)]);

    if (baseTip === undefined) throw new BadRequest(`${baseRef} is not a commit`);

    if (head === undefined) throw new BadRequest(`${headRef} is not a commit`);

    const base = (await repo.mergeBase(baseTip, head)) ?? baseTip;
    const [list, files] = await Promise.all([commits(base, head), changes(base, head)]);
    const sum = totals(files);

    return { base, head, commits: [...list], files: files.length, ...sum };
  };

  const create = async (input: Static<typeof CreateReviewSchema>): Promise<{ id: string }> => {
    const compared = await compare(input.base, input.head);

    if (compared.files === 0) throw new BadRequest("These commits change no files");

    const record = registry.create({
      id: randomUUID().slice(0, 8),
      title: input.title.trim(),
      baseRef: input.base,
      headRef: input.head,
      revision: { head: compared.head, base: compared.base, at: Date.now() },
    });

    await sessionOf(record);

    return { id: record.id };
  };

  /**
   * The one call that spends on a guide: the page makes it only when you press
   * Write Guide, Update or Try Again.
   */
  const writeGuide = async (id: string, head: string): Promise<void> => {
    const record = find(id);
    const revision = await revisionOf(record);

    if (revision.head !== head)
      throw new BadRequest(`The branch moved to ${revision.head.slice(0, 7)}; reload the review`);

    const sessionId = await sessionOf(record);

    await ensureBrief(record, sessionId, revision, await coreState(record, sessionId), true);
  };

  const patches = async (id: string, base: string, head: string): Promise<readonly Patch[]> => {
    find(id);

    const [baseOid, headOid] = await Promise.all([repo.resolve(base), repo.resolve(head)]);

    if (baseOid === undefined || headOid === undefined) throw new BadRequest("Unknown commits");

    const [files, patch] = await Promise.all([
      changes(baseOid, headOid),
      fullPatch(baseOid, headOid),
    ]);

    const split = splitPatch(patch);

    return files.map((file) => {
      const text = split.get(file.path) ?? "";
      const truncated = text.length > DRAWN_PATCH;

      return { ...file, patch: truncated ? "" : text, truncated };
    });
  };

  const ask = async (id: string, input: Ask): Promise<void> => {
    if (input.text.trim() === "" && input.references.length === 0)
      throw new BadRequest("Write a question or attach code");

    const record = find(id);
    const sessionId = await sessionOf(record);
    const state = await coreState(record, sessionId);
    const brief = state.briefs.find((entry) => entry.head === input.head);

    if (brief?.status !== "done" || brief.guide === undefined)
      throw new BadRequest("Side chats fork the guide; write it first");

    // A thread's first question cuts it from the brief; later ones land on the same fork.
    await fork({
      sessionId,
      head: `${threadPrefix(input.head)}${input.thread}`,
      from: brief.name,
      config: pinned(state.heads, brief.name),
      key: input.key,
      content: message(input.text, input.references),
    });
  };

  /** A new branch from `base`, checked out in a worktree of its own, with Nyte working the task there. */
  const startTask = async (input: Task): Promise<{ id: string }> => {
    const baseTip = await repo.resolve(input.base);

    if (baseTip === undefined) throw new BadRequest(`${input.base} is not a commit`);

    const id = randomUUID().slice(0, 8);
    const title = titleOf(input.task);
    const branch = `nyte/${slug(title)}-${id.slice(0, 4)}`;
    const worktree = worktreeOf(id);

    await repo.addWorktree(worktree, branch, baseTip);

    const authorSession = await openAuthor(id, worktree);

    registry.create({
      id,
      title,
      baseRef: input.base,
      headRef: branch,
      revision: { head: baseTip, base: baseTip, at: Date.now() },
      task: input.task,
      author: { sessionId: authorSession, worktree },
    });
    await sdk.messages.send({ sessionId: authorSession, key: `task-${id}`, content: input.task });
    log(`${branch}: Nyte started "${title}" in ${worktree}`);

    return { id };
  };

  const change = async (id: string, input: Change): Promise<void> => {
    if (input.text.trim() === "" && input.references.length === 0)
      throw new BadRequest("Say what to change");

    const author = await authorOf(find(id));

    await sdk.messages.send({
      sessionId: author.sessionId,
      key: input.key,
      content: message(input.text, input.references),
    });
  };

  /** Approve the head the branch is at; a later push leaves the approval behind. */
  const approve = async (id: string, head: string): Promise<void> => {
    const revision = await revisionOf(find(id));

    if (revision.head !== head)
      throw new BadRequest("The branch moved. Review the new head first.");

    registry.update(id, (record) => ({
      ...record,
      approvals: [...(record.approvals ?? []), { head, at: Date.now() }],
    }));
  };

  const sessionsOf = async (id: string): Promise<Sessions> => {
    const record = find(id);
    const reply: Sessions = { sessionId: await sessionOf(record) };

    if (record.author !== undefined) reply.authorSessionId = record.author.sessionId;

    return reply;
  };

  const repoInfo = async (): Promise<RepoInfo> => {
    const [branches, current] = await Promise.all([repo.branches(defaultBase), repo.current()]);
    const info: RepoInfo = { root: repo.root, base: defaultBase, branches: [...branches] };

    if (current !== undefined) info.current = current;

    return info;
  };

  const json = (
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
  ): Response => Response.json(body, { status });

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter((part) => part !== "");
    const route = `${request.method} /${parts.map((part, index) => (index === 1 ? ":id" : part)).join("/")}`;
    const id = parts[1] ?? "";

    try {
      switch (route) {
        case "GET /repo":
          return json(await repoInfo());
        case "GET /compare":
          return json(
            await compare(url.searchParams.get("base") ?? "", url.searchParams.get("head") ?? ""),
          );
        case "GET /reviews":
          return json({ reviews: await Promise.all(registry.list().map(summary)) });
        case "POST /reviews":
          return json(await create(await readBody(CreateReviewSchema, request)));
        case "GET /reviews/:id":
          return json(await detail(id));
        case "GET /reviews/:id/session":
          return json(await sessionsOf(id));
        case "POST /tasks":
          return json(await startTask(await readBody(TaskSchema, request)));
        case "POST /reviews/:id/change":
          await change(id, await readBody(ChangeSchema, request));

          return json(await detail(id));
        case "POST /reviews/:id/approve":
          await approve(id, (await readBody(ApproveSchema, request)).head);

          return json(await detail(id));
        case "POST /reviews/:id/guide":
          await writeGuide(id, (await readBody(WriteGuideSchema, request)).head);

          return json(await detail(id));
        case "GET /reviews/:id/patches":
          return json({
            patches: await patches(
              id,
              url.searchParams.get("base") ?? "",
              url.searchParams.get("head") ?? "",
            ),
          });
        case "POST /reviews/:id/ask":
          await ask(id, await readBody(AskSchema, request));

          return json(await detail(id));
        default:
          return json({ error: `No route ${route}` }, 404);
      }
    } catch (cause) {
      if (cause instanceof BadRequest) return json({ error: cause.message }, 400);

      log(
        `${route} failed: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`,
      );

      return json({ error: cause instanceof Error ? cause.message : String(cause) }, 500);
    }
  };
}
