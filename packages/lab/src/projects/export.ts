import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { ENV, command, readGitHub } from "./export-github.ts";
import type {
  Baseline,
  CiFixFact,
  Evidence,
  FileLoss,
  PriceFact,
  RecoveryAsk,
  RestoredFile,
  SessionFact,
  WorktreeFact,
} from "./evidence.ts";

const HOME = homedir();

const STORE = join(HOME, ".nyte/nyte.db");

const REPOSITORY = process.env["NYTE_REPOSITORY"] ?? join(HOME, "Developer/nyte");

const OUT = process.argv[2] ?? join(import.meta.dirname, "../../research_notes/projects/export");

const RED_STACK_AT = Date.parse("2026-10-25T05:00:00Z");

const WIPE = {
  session: "7af0e645-1703-491a-9288-106638ee95db",
  run: "80f808c5-1771-489b-b934-79e73d01a7d7",
  call: "80f808c5-1771-489b-b934-79e73d01a7d7:9:toolu_012eRA7NYbx4VqzKa5SKXajR",
};

const CI_FIXES = [
  "eb90eb31-807e-4231-b801-15feaaf5fafb",
  "f168535a-db36-406d-8fca-e4eeb2b82e93",
  "c423d393-5cb4-4101-84f0-ed20384f1496",
  "3e7da05e-83f2-4895-8c80-49a3c3353540",
  "5a8d24e1-e2f3-468c-ac43-584e969f3538",
  "622e792b-fde6-4965-9fc7-06de85e28a2a",
  "a2605c02-a469-4e9c-bd55-57a5e01d8fae",
  "73c788bc-d336-433d-9863-07777c5249a2",
  "f3603cb3-9f95-413d-b40f-25f5aa533b86",
  "f5819364-fc79-43ed-800a-c1432edc2e8c",
];

const db = new DatabaseSync(new URL(`file://${STORE}?mode=ro`), { readOnly: true });

function select<S extends TSchema>(schema: S, sql: string): readonly Static<S>[] {
  return db
    .prepare(sql)
    .all()
    .map((row) => {
      if (!Value.Check(schema, row))
        throw new Error(`Unexpected row for ${sql.slice(0, 80)}: ${JSON.stringify(row)}`);

      return row;
    });
}

function only<S extends TSchema>(schema: S, sql: string): Static<S> {
  const row = select(schema, sql)[0];

  if (row === undefined) throw new Error(`No row for ${sql.slice(0, 80)}`);

  return row;
}

function git(args: readonly string[]): string {
  return command("git", ["-C", REPOSITORY, ...args]);
}

const Text = Type.String();

const Count = Type.Number();

const MaybeText = Type.Union([Type.String(), Type.Null()]);

const MaybeCount = Type.Union([Type.Number(), Type.Null()]);

db.exec(`
create temp table records as
  select substr(r.name, 10) id, o.body from refs r join objects o on o.id = r.target
  where r.name like 'sessions/%' and instr(substr(r.name, 10), '/') = 0;
create temp table workspaces as
  select o.body from refs r join objects o on o.id = r.target where r.name like 'workspaces/%';
create temp table run_records as
  select substr(r.name, 10, 36) session, o.body from refs r join objects o on o.id = r.target
  where r.name like 'sessions/%/ended/%' or r.name like 'sessions/%/runs/%';
create temp table runs as
  select session, json_extract(event, '$.run') run, seq start_seq, at start_at,
    json_extract(event, '$.view.configuration.model.provider') || '/' || json_extract(event, '$.view.configuration.model.id') model,
    json_extract(event, '$.view.origin.message') origin_message
  from log where json_extract(event, '$.kind') = 'run' and json_extract(event, '$.change') = 'started';
create temp table run_ends as
  select json_extract(event, '$.run') run, seq end_seq, at end_at
  from log where json_extract(event, '$.kind') = 'run' and json_extract(event, '$.change') = 'ended';
create temp table spans as
  select r.session, r.run, r.start_seq, coalesce(e.end_seq, 9e18) end_seq, r.start_at, e.end_at, r.model, r.origin_message
  from runs r left join run_ends e on e.run = r.run;
create index spans_session on spans(session, start_seq);
create temp table requests as
  select session, seq, at, json_extract(event, '$.step') step,
    json_extract(event, '$.usage.input') input, json_extract(event, '$.usage.output') output,
    json_extract(event, '$.usage.cacheRead') cache_read, json_extract(event, '$.usage.cacheWrite') cache_write,
    json_extract(event, '$.usage.cost.total') cost, json_extract(event, '$.context.tokens') context
  from log where json_extract(event, '$.kind') = 'request';
create temp table request_runs as
  select q.*, (select sp.run from spans sp where sp.session = q.session and sp.start_seq < q.seq and sp.end_seq > q.seq
    order by sp.start_seq desc limit 1) run from requests q;
create index request_runs_run on request_runs(run);
create temp table run_cost as
  select sp.*, coalesce((select sum(cost) from request_runs q where q.run = sp.run), 0) cost from spans sp;
create temp table humans as
  select session, json_extract(event, '$.message') message, min(at) at, max(json_extract(event, '$.content')) content
  from log where json_extract(event, '$.kind') = 'input' and json_extract(event, '$.change') = 'admitted'
    and json_extract(event, '$.source.kind') = 'user'
  group by 1, 2;
create temp table calls as
  select session, seq, at, json_extract(event, '$.part') call, json_extract(event, '$.run') run,
    json_extract(event, '$.state.name') tool, json_extract(event, '$.state.args.command') command,
    json_extract(event, '$.state.args.path') path, json_extract(event, '$.state.args') args
  from log where json_extract(event, '$.kind') = 'part' and json_extract(event, '$.change') = 'created'
    and json_extract(event, '$.partKind') = 'tool';
create index calls_session on calls(session, seq);
create temp table outcomes as
  select session, seq, at, json_extract(event, '$.call') call, json_extract(event, '$.outcome.content') content,
    json_extract(event, '$.changes') changes
  from log where json_extract(event, '$.kind') = 'call' and json_extract(event, '$.change') = 'settled';
create index outcomes_call on outcomes(call);
create temp table change_events as
  select session, seq, at, json_extract(event, '$.files') files from log where json_extract(event, '$.kind') = 'changes';
`);

const window = only(
  Type.Object({ from: Count, to: Count }),
  'select min(at) "from", max(at) "to" from log',
);

const SessionRow = Type.Object({ id: Text, body: Text });

const SessionBody = Type.Object({
  body: Type.Object({
    id: Text,
    name: MaybeText,
    parent: MaybeText,
    workspace: Text,
    archived: Type.Boolean(),
    createdAt: Count,
    lastActivityAt: Count,
  }),
});

const WorkspaceBody = Type.Object({
  body: Type.Object({
    id: Text,
    target: Type.Object({ path: Type.Optional(Text) }),
    isolation: Type.Union([
      Type.Null(),
      Type.Object({ session: Text, branch: Text, base: Text, source: Text }),
    ]),
  }),
});

function parsed<S extends TSchema>(schema: S, json: string): Static<S> {
  const value: unknown = JSON.parse(json);

  if (!Value.Check(schema, value)) throw new Error(`Unexpected record: ${json.slice(0, 120)}`);

  return value;
}

const workspaces = select(Type.Object({ body: Text }), "select body from workspaces").map(
  (row) => parsed(WorkspaceBody, row.body).body,
);

const folders = new Map(
  workspaces.map((workspace) => [workspace.id, workspace.target.path ?? null]),
);

const records = select(SessionRow, "select id, body from records").map(
  (row) => parsed(SessionBody, row.body).body,
);

const PerSession = Type.Object({ session: Text });

const runRows = select(
  Type.Object({ session: Text, runs: Count, running: Count, models: Text }),
  `select session, count(*) runs, sum(end_at is null) running,
     (select group_concat(model, ',') from (select model, count(*) n from run_cost r2 where r2.session = r.session group by model order by n desc)) models
   from run_cost r group by session`,
);

const costRows = select(
  Type.Object({ session: Text, cost: Count, context: MaybeCount }),
  `select session, sum(cost) cost, (select context from requests q2 where q2.session = q.session order by seq desc limit 1) context
   from requests q group by session`,
);

const humanRows = select(
  Type.Object({ session: Text, messages: Count, skills: MaybeText }),
  `select h.session, count(*) messages,
     (select group_concat(distinct json_extract(c.value, '$.name')) from humans h2, json_each(h2.content) c
       where h2.session = h.session and instr(h2.message, ':') = 0 and json_valid(h2.content) and json_type(h2.content) = 'array'
         and json_extract(c.value, '$.kind') = 'skill') skills
   from humans h where instr(h.message, ':') = 0 group by h.session`,
);

const openerRows = select(
  Type.Object({ session: Text, at: Count, text: MaybeText }),
  `select c.session, c.at, json_extract(o.content, '$[0].text') text
   from calls c join outcomes o on o.call = c.call where c.command like '%gh pr create%' order by c.at`,
);

const openers = new Map(
  openerRows.flatMap((row) =>
    [...(row.text ?? "").matchAll(/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/g)].map(
      (match) => [Number(match[1]), row.session] as const,
    ),
  ),
);

const byRun = new Map(runRows.map((row) => [row.session, row]));

const byCost = new Map(costRows.map((row) => [row.session, row]));

const byHuman = new Map(humanRows.map((row) => [row.session, row]));

const sessions: readonly SessionFact[] = records.map((record) => {
  const workspace = workspaces.find((candidate) => candidate.id === record.workspace);
  const runs = byRun.get(record.id);
  const cost = byCost.get(record.id);
  const human = byHuman.get(record.id);

  return {
    id: record.id,
    title: record.name,
    parent: record.parent,
    folder: folders.get(record.workspace) ?? null,
    isolation:
      workspace?.isolation === null || workspace?.isolation === undefined
        ? null
        : { branch: workspace.isolation.branch, base: workspace.isolation.base },
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    archived: record.archived,
    runs: runs?.runs ?? 0,
    running: (runs?.running ?? 0) > 0,
    costUsd: round(cost?.cost ?? 0),
    models: runs === undefined ? [] : runs.models.split(","),
    contextTokens: cost?.context ?? 0,
    humanMessages: record.parent === null ? (human?.messages ?? 0) : 0,
    skills: human?.skills?.split(",") ?? [],
    opened: [...openers].flatMap(([number, session]) => (session === record.id ? [number] : [])),
  };
});

function round(value: number, places = 2): number {
  const scale = 10 ** places;

  return Math.round(value * scale) / scale;
}

const github = readGitHub(openers, RED_STACK_AT);

const pullRequests = github.pullRequests;

const base = github.base;

const ciHistory = github.ciHistory;

const RunBody = Type.Object({
  body: Type.Object({
    view: Type.Object({ id: Text, startedAt: Count }),
    snapshot: MaybeText,
    lastSnapshot: MaybeText,
  }),
});

const runRecords = select(
  Type.Object({ session: Text, body: Text }),
  "select session, body from run_records",
).map((row) => ({
  session: row.session,
  run: parsed(RunBody, row.body).body,
}));

function snapshotTree(id: string | null): string | null {
  return id?.startsWith("git:") === true ? id.slice(4) : null;
}

function changedPaths(from: string, to: string): readonly string[] {
  return git(["diff-tree", "-r", "--name-only", "--no-commit-id", from, to])
    .split("\n")
    .filter((line) => line !== "");
}

function attributedPaths(session: string): ReadonlySet<string> {
  const rows = select(
    Type.Object({ changes: MaybeText }),
    `select changes from outcomes where session = '${session}' and changes is not null`,
  );

  return new Set(
    rows.flatMap((row) => {
      const changes: unknown = JSON.parse(row.changes ?? "null");

      return Value.Check(Type.Object({ paths: Type.Array(Text) }), changes) ? changes.paths : [];
    }),
  );
}

const porcelain = git(["worktree", "list", "--porcelain"])
  .split("\n\n")
  .filter((block) => block.trim() !== "");

const worktrees: readonly WorktreeFact[] = porcelain.flatMap((block) => {
  const fields = new Map(
    block
      .split("\n")
      .map((line) => [line.split(" ")[0] ?? "", line.slice(line.indexOf(" ") + 1)] as const),
  );

  const path = fields.get("worktree") ?? "";
  const head = fields.get("HEAD") ?? "";
  const branch = fields.get("branch")?.replace("refs/heads/", "") ?? null;

  if (path === REPOSITORY) return [];

  const isolation =
    workspaces.find((workspace) => workspace.target.path === path)?.isolation ?? null;

  const owner = isolation?.session ?? null;

  const owned = runRecords
    .filter((record) => record.session === owner)
    .toSorted((left, right) => left.run.view.startedAt - right.run.view.startedAt);

  const first = snapshotTree(owned[0]?.run.snapshot ?? null);
  const last = snapshotTree(owned.at(-1)?.run.lastSnapshot ?? owned.at(-1)?.run.snapshot ?? null);
  const attributed = owner === null ? new Set<string>() : attributedPaths(owner);

  const copied =
    first === null || isolation === null ? [] : changedPaths(`${isolation.base}^{tree}`, first);

  const current = last === null ? [] : changedPaths(`${head}^{tree}`, last);

  return [
    {
      path,
      branch,
      head,
      owner,
      base: isolation?.base ?? null,
      ahead: Number(git(["rev-list", "--count", `origin/main..${head}`]).trim()),
      merged:
        spawnSync("git", ["-C", REPOSITORY, "merge-base", "--is-ancestor", head, "origin/main"], {
          env: ENV,
        }).status === 0,
      bytes: Number(command("du", ["-sk", path]).split("\t")[0] ?? 0) * 1024,
      uncommitted: {
        snapshot: last === null ? null : `git:${last}`,
        own: current.filter((file) => attributed.has(file)),
        copied: current.filter((file) => !attributed.has(file) && copied.includes(file)),
        unknown: current.filter((file) => !attributed.has(file) && !copied.includes(file)),
      },
    },
  ];
});

const wipe = only(
  Type.Object({ at: Count, seq: Count, command: Text, changes: Text }),
  `select c.at, c.seq, c.command, o.changes from calls c join outcomes o on o.call = c.call where c.call = '${WIPE.call}'`,
);

const checkoutWorkspaces = workspaces
  .filter(
    (workspace) =>
      workspace.isolation === null &&
      (workspace.target.path === REPOSITORY ||
        workspace.target.path?.startsWith(`${REPOSITORY}/`) === true),
  )
  .map((workspace) => workspace.id);

if (checkoutWorkspaces.length === 0) throw new Error(`${REPOSITORY} is not a registered workspace`);

const inCheckout = `(${checkoutWorkspaces.map((id) => `'${id}'`).join(",")})`;

const writersAtWipe = select(
  PerSession,
  `with last_changes as (select session, files, max(seq) seq from change_events where at < ${wipe.at} group by session)
   select l.session from last_changes l join records r on r.id = l.session
   where json_extract(r.body, '$.body.workspace') in ${inCheckout} and json_array_length(l.files) > 0
     and exists (select 1 from spans s where s.session = l.session and s.start_at > ${wipe.at} - 6 * 3600 * 1000)`,
).map((row) => row.session);

const writersNow = select(
  PerSession,
  `with last_changes as (select session, files, max(seq) seq from change_events group by session)
   select l.session from last_changes l join records r on r.id = l.session
   where json_extract(r.body, '$.body.workspace') in ${inCheckout} and json_array_length(l.files) > 0
     and exists (select 1 from spans s where s.session = l.session and s.start_at > ${String(Date.now())} - 24 * 3600 * 1000)`,
).map((row) => row.session);

const runningAtWipe = select(
  PerSession,
  `select distinct s.session from spans s join records r on r.id = s.session
   where json_extract(r.body, '$.body.workspace') in ${inCheckout} and s.start_at <= ${wipe.at} and coalesce(s.end_at, 9e15) >= ${wipe.at}`,
).map((row) => row.session);

const FileChange = Type.Array(Type.Object({ path: Text, added: Count, removed: Count }));

const aroundWipe = select(
  Type.Object({ files: Text }),
  `select files from (select files, seq from change_events where session = '${WIPE.session}' and seq < ${wipe.seq} order by seq desc limit 1)
   union all
   select files from (select files, seq from change_events where session = '${WIPE.session}' and seq > ${wipe.seq} order by seq limit 1)`,
).map((row) => parsed(FileChange, row.files));

const [beforeWipe = [], afterWipe = []] = aroundWipe;

const afterByPath = new Map(afterWipe.map((file) => [file.path, file]));

const lost: readonly FileLoss[] = beforeWipe.flatMap((file) => {
  const after = afterByPath.get(file.path);

  if (after !== undefined && after.added === file.added && after.removed === file.removed)
    return [];

  return [
    { path: file.path, added: file.added, removed: file.removed, whole: after === undefined },
  ];
});

const wipeRun = runRecords.find((record) => record.run.view.id === WIPE.run)?.run;

const before = wipeRun?.snapshot ?? null;

const after = wipeRun?.lastSnapshot ?? null;

if (before === null || after === null) throw new Error("The wipe's run record lost its snapshots");

const keptIn =
  git(["ls-tree", "refs/nyte/kept"])
    .split("\n")
    .map((line) => line.split("\t")[1] ?? "")
    .find(
      (generation) =>
        generation !== "" &&
        git(["ls-tree", `refs/nyte/kept:${generation}`]).includes(before.slice(4)),
    ) ?? "";

const asked: readonly RecoveryAsk[] = select(
  Type.Object({
    session: Text,
    at: Count,
    content: Text,
    runs: Count,
    cost: Count,
    minutes: Count,
  }),
  `select h.session, h.at, h.content,
     (select count(*) from run_cost r where r.session = h.session and r.origin_message = h.message) runs,
     (select coalesce(sum(cost), 0) from run_cost r where r.session = h.session and r.origin_message = h.message) cost,
     (select coalesce(sum(coalesce(end_at, start_at) - start_at), 0) / 60000.0 from run_cost r where r.session = h.session and r.origin_message = h.message) minutes
   from humans h where h.at between ${wipe.at} and ${wipe.at} + 50 * 60 * 1000
     and (h.content like 'Another session%' or h.content like '%/tmp/stack/patches%')
   order by h.at`,
).map((row) => ({
  session: row.session,
  at: row.at,
  ask: row.content.startsWith("Another session") ? "redo" : "split",
  runs: row.runs,
  costUsd: round(row.cost),
  minutes: round(row.minutes, 1),
}));

const EditArgs = Type.Object({ edits: Type.Array(Type.Object({ oldText: Text, newText: Text })) });

const restoreDirectory = join(OUT, "restore");

const rootWorkspaces = new Set(
  workspaces.flatMap((workspace) =>
    workspace.isolation === null && workspace.target.path === REPOSITORY ? [workspace.id] : [],
  ),
);

const handRebuild = select(
  Type.Object({ session: Text, run: Text, ended: Count }),
  `select r.session, r.run, r.end_at ended from run_cost r
   join humans h on h.session = r.session and h.message = r.origin_message
   where h.at between ${wipe.at} and ${wipe.at} + 50 * 60 * 1000
     and (h.content like 'Another session%' or h.content like '%/tmp/stack/patches%')
     and r.end_at is not null
   order by r.end_at desc`,
).flatMap((row) => {
  const workspace = records.find((record) => record.id === row.session)?.workspace;

  const tree = snapshotTree(
    runRecords.find((entry) => entry.run.view.id === row.run)?.run.lastSnapshot ?? null,
  );

  if (tree === null || workspace === undefined || !rootWorkspaces.has(workspace)) return [];

  return [{ session: row.session, at: row.ended, snapshot: `git:${tree}`, tree }];
})[0];

if (handRebuild === undefined) throw new Error("No recovery run left a snapshot of the checkout");

interface LineCount {
  readonly added: number;
  readonly removed: number;
}

function numstat(left: string, right: string): LineCount {
  const ran = spawnSync("git", ["diff", "--no-index", "--numstat", left, right], {
    env: ENV,
    encoding: "utf8",
  });

  const [added = "0", removed = "0"] = ran.stdout.trim().split("\t");

  return { added: Number(added), removed: Number(removed) };
}

const restored: readonly RestoredFile[] = lost.flatMap((file): readonly RestoredFile[] => {
  if (!file.whole) return [];

  const target = join(restoreDirectory, file.path);
  const rebuiltFile = join(restoreDirectory, ".hand-rebuild", file.path);

  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(dirname(rebuiltFile), { recursive: true });
  writeFileSync(target, git(["show", `${before.slice(4)}:${file.path}`]));

  const present =
    spawnSync("git", ["cat-file", "-e", `${handRebuild.tree}:${file.path}`], { env: ENV })
      .status === 0;

  writeFileSync(rebuiltFile, present ? git(["show", `${handRebuild.tree}:${file.path}`]) : "");
  const difference = numstat(target, rebuiltFile);

  if (difference.added + difference.removed === 0)
    return [{ path: file.path, differingLines: 0, laterEdit: null }];
  const rebuilt = readFileSync(rebuiltFile, "utf8");

  const edits = select(
    Type.Object({ session: Text, at: Count, args: Text }),
    `select session, at, args from calls where tool = 'edit' and at > ${wipe.at} and at <= ${handRebuild.at} and path like '%${file.path}' order by at`,
  );

  const explaining = edits.find((edit) => {
    const applied = parsed(EditArgs, edit.args).edits.reduce(
      (text, change) => text.replace(change.oldText, change.newText),
      readFileSync(target, "utf8"),
    );

    return applied === rebuilt;
  });

  return [
    {
      path: file.path,
      differingLines: difference.added + difference.removed,
      laterEdit:
        explaining === undefined
          ? null
          : {
              session: explaining.session,
              at: explaining.at,
              removed: difference.removed,
              added: difference.added,
            },
    },
  ];
});

const ModelCost = Type.Object({ input: Count, output: Count, cacheRead: Count, cacheWrite: Count });

const Catalog = Type.Object({
  rawCatalogs: Type.Record(
    Text,
    Type.Object({ models: Type.Array(Type.Object({ id: Text, cost: Type.Optional(ModelCost) })) }),
  ),
});

const catalog = parsed(Catalog, readFileSync(join(HOME, ".nyte/models-store.json"), "utf8"));

function price(provider: string, id: string): PriceFact {
  const cost = catalog.rawCatalogs[provider]?.models.find((model) => model.id === id)?.cost;

  if (cost === undefined) throw new Error(`The catalog has no price for ${provider}/${id}`);

  return {
    model: `${provider}/${id}`,
    ...cost,
    source: `~/.nyte/models-store.json rawCatalogs.${provider}`,
  };
}

const sol = price("openai-codex", "gpt-6.1-sol");

const prices = [sol, price("anthropic", "claude-opus-5-5")];

const ciFixes: readonly CiFixFact[] = select(
  Type.Object({
    session: Text,
    requests: Count,
    minutes: Count,
    recorded: Count,
    input: Count,
    output: Count,
    cacheRead: Count,
    cacheWrite: Count,
  }),
  `select session, count(*) requests, (max(at) - min(at)) / 60000.0 minutes, sum(cost) recorded,
     sum(input) input, sum(output) output, sum(cache_read) cacheRead, sum(cache_write) cacheWrite
   from requests where step = 'assistant' and session in (${CI_FIXES.map((id) => `'${id}'`).join(",")}) group by session`,
).map((row) => {
  const session = sessions.find((candidate) => candidate.id === row.session);

  return {
    session: row.session,
    title: session?.title ?? "",
    model: session?.models[0] ?? "",
    requests: row.requests,
    minutes: round(row.minutes, 0),
    recordedUsd: round(row.recorded),
    atSolUsd: round(
      (row.input * sol.input +
        row.output * sol.output +
        row.cacheRead * sol.cacheRead +
        row.cacheWrite * sol.cacheWrite) /
        1e6,
    ),
  };
});

function measure(
  id: Baseline["id"],
  source: Baseline["source"],
  label: string,
  unit: Baseline["unit"],
  query: string,
  describe: (row: Record<string, number>) => { readonly value: number; readonly detail: string },
): Baseline {
  const row = only(Type.Record(Text, Type.Number()), query);

  return { id, source, label, unit, query, ...describe(row) };
}

const HUMAN = `select session, message, content from humans h where instr(message, ':') = 0
  and exists (select 1 from records r where r.id = h.session and json_extract(r.body, '$.body.parent') is null)`;

const baselines: readonly Baseline[] = [
  measure(
    "hand-skills",
    "store",
    "Messages that attach a skill by hand",
    "messages",
    `with human as (${HUMAN}), skilled as (
       select distinct session, message from human, json_each(human.content) c
       where json_valid(content) and json_type(content) = 'array' and json_extract(c.value, '$.kind') = 'skill')
     select (select count(*) from skilled) skilled, (select count(distinct session) from skilled) chats,
       (select count(*) from human) messages, (select count(distinct session) from human) all_chats`,
    (row) => ({
      value: row["skilled"] ?? 0,
      detail: `${String(row["skilled"])} of ${String(row["messages"])} messages in top-level chats, in ${String(row["chats"])} of ${String(row["all_chats"])} chats.`,
    }),
  ),
  measure(
    "restated-rules",
    "store",
    "Delegation prompts that restate repo rules or skills",
    "prompts",
    `with first as (select h.session, h.content, row_number() over (partition by h.session order by h.at) n from humans h
       join records r on r.id = h.session where json_extract(r.body, '$.body.parent') is not null)
     select count(*) prompts,
       sum(content like '%AGENTS.md%' or content like '%no casts%' or content like '%no type casts%' or content like '%no \`any\`%'
         or content like '%skill%' or content like '%Other agents are editing%') restating,
       avg(length(content)) chars
     from first where n = 1`,
    (row) => ({
      value: row["restating"] ?? 0,
      detail: `${String(row["restating"])} of ${String(row["prompts"])} first prompts to subagents name AGENTS.md, restate a style rule, name a skill or warn about the shared tree; they average ${String(Math.round(row["chars"] ?? 0))} characters.`,
    }),
  ),
  measure(
    "subagent-share",
    "store",
    "Spend in subagents",
    "percent",
    `select sum(case when json_extract(r.body, '$.body.parent') is not null then c.cost end) child, sum(c.cost) total,
       sum(json_extract(r.body, '$.body.parent') is not null) child_runs, count(*) runs
     from run_cost c join records r on r.id = c.session`,
    (row) => ({
      value: round((100 * (row["child"] ?? 0)) / (row["total"] ?? 1), 1),
      detail: `$${String(round(row["child"] ?? 0))} of $${String(round(row["total"] ?? 0))} in ${String(row["child_runs"])} of ${String(row["runs"])} runs.`,
    }),
  ),
  measure(
    "child-steering",
    "store",
    "Messages you typed into a subagent",
    "messages",
    `with child as (select h.session, h.message from humans h join records r on r.id = h.session
       where json_extract(r.body, '$.body.parent') is not null),
     firsts as (select session, min(message) message from child where instr(message, ':') = 0 group by session)
     select (select count(*) from child where instr(message, ':') = 0) - (select count(*) from firsts) typed,
       (select count(*) from firsts) children, (select count(*) from child where instr(message, ':') > 0) from_parent`,
    (row) => ({
      value: row["typed"] ?? 0,
      detail: `${String(row["children"])} subagents got one prompt each; their parents sent ${String(row["from_parent"])} more with send; you typed ${String(row["typed"])}.`,
    }),
  ),
  measure(
    "opus-ci-polling",
    "store",
    "Opus turns spent reading a CI poll",
    "usd",
    `with polls as (select session, seq from calls where tool = 'bash' and (command like '%gh pr checks%' or command like '%gh run watch%'
       or command like '%gh run view%' or command like '%statusCheckRollup%' or command like '%gh run list%')),
     reads as (select q.cost, q.run from request_runs q where q.step = 'assistant'
       and (select c.seq from calls c where c.session = q.session and c.seq < q.seq order by c.seq desc limit 1) in (select seq from polls p where p.session = q.session))
     select count(*) turns, sum(reads.cost) cost from reads join spans s on s.run = reads.run where s.model = 'anthropic/claude-opus-5-5'`,
    (row) => ({
      value: round(row["cost"] ?? 0),
      detail: `${String(row["turns"])} Opus 5.5 turns read the output of a gh checks or runs query.`,
    }),
  ),
  measure(
    "opus-sleep-turns",
    "store",
    "Opus turns after a sleep",
    "usd",
    `with sleeps as (select session, seq from calls where tool = 'bash' and command like '%sleep %'),
     reads as (select q.cost, q.run from request_runs q where q.step = 'assistant'
       and (select c.seq from calls c where c.session = q.session and c.seq < q.seq order by c.seq desc limit 1) in (select seq from sleeps s where s.session = q.session))
     select count(*) turns, sum(reads.cost) cost from reads join spans s on s.run = reads.run where s.model = 'anthropic/claude-opus-5-5'`,
    (row) => ({
      value: round(row["cost"] ?? 0),
      detail: `${String(row["turns"])} Opus 5.5 turns read the output of a command that slept.`,
    }),
  ),
  measure(
    "unattributed-calls",
    "store",
    "Calls whose changes no chat could own",
    "calls",
    `select count(*) calls, count(distinct session) chats from outcomes where json_extract(changes, '$.unattributed') = 1`,
    (row) => ({
      value: row["calls"] ?? 0,
      detail: `${String(row["calls"])} shell calls in ${String(row["chats"])} chats changed files while another chat was live in the same folder, so the tool runner recorded none of it.`,
    }),
  ),
];

const nyteOpened = pullRequests.filter((pull) => pull.openedBy !== null);

const landed = sessions.find((session) => session.id === "25e38e5a-173e-4ef8-b26d-f4364ed23f98");

const nineteen = pullRequests.find((pull) => pull.number === 19);

const red = pullRequests.filter(
  (pull) => pull.state === "OPEN" && pull.checks.some((check) => check.state === "failed"),
);

const live = worktrees.filter((tree) => tree.owner !== null);

const exportedAt = Date.now();

const evidence: Evidence = {
  exportedAt,
  observedAt: RED_STACK_AT,
  sources: {
    store: `${STORE}?mode=ro`,
    repository: REPOSITORY,
    github: github.repository,
    head: git(["rev-parse", "HEAD"]).trim(),
    originMain: git(["rev-parse", "origin/main"]).trim(),
  },
  window,
  baselines: [
    ...baselines,
    {
      id: "pr-to-merge",
      source: "github",
      label: "Hours #19 has waited since “land it as pr”",
      value: round((RED_STACK_AT - (nineteen?.createdAt ?? RED_STACK_AT)) / 3_600_000, 1),
      unit: "hours",
      detail: `${String(nyteOpened.filter((pull) => pull.state === "MERGED").length)} of ${String(nyteOpened.length)} pull requests opened from Nyte chats merged; #19, asked for in ${landed?.id.slice(0, 8) ?? "25e38e5a"}, is still ${nineteen?.state ?? "OPEN"}.`,
      query:
        "gh pr list --state all --json number,state,createdAt,mergedAt, joined to the store's gh pr create outcomes",
    },
    {
      id: "red-prs",
      source: "github",
      label: "Open pull requests with a failing check",
      value: red.length,
      unit: "prs",
      detail: `${String(red.length)} of ${String(pullRequests.filter((pull) => pull.state === "OPEN").length)} open; every failure stops at ${red[0]?.checks.find((check) => check.failure !== null)?.failure?.step ?? "?"}.`,
      query: "gh pr view <n> --json statusCheckRollup; gh run view <id> --log-failed",
    },
    {
      id: "ci-never-green",
      source: "github",
      label: "CI runs that passed",
      value: ciHistory.filter((run) => run.conclusion === "success").length,
      unit: "runs",
      detail: `${String(ciHistory.filter((run) => run.conclusion === "success").length)} of ${String(ciHistory.length)} CI runs since ${ciHistory.at(-1)?.createdAt.slice(0, 10) ?? "?"} passed (${String(ciHistory.filter((run) => run.conclusion === "failure").length)} failed, ${String(ciHistory.filter((run) => run.conclusion === "cancelled").length)} cancelled); a successful Release build takes ${github.releaseMinutes.map((minutes) => String(round(minutes, 1))).join(", ")} minutes.`,
      query:
        "gh run list --workflow CI --limit 500 --json conclusion,createdAt; gh run list --workflow Release --status success --json createdAt,updatedAt",
    },
    {
      id: "shared-checkout-writers",
      source: "store",
      label: "Chats with uncommitted work in one checkout at the wipe",
      value: writersAtWipe.length,
      unit: "chats",
      detail: `${String(writersAtWipe.length)} chats' newest change events listed files of their own in ${REPOSITORY}; ${String(runningAtWipe.length)} had a run in progress at 18:31:03.`,
      query:
        "change_events before the wipe joined to session records on every workspace inside the checkout, active in the 6 hours before",
    },
    {
      id: "worktree-disk",
      source: "disk",
      label: "Disk held by worktrees Nyte made",
      value: round(live.reduce((sum, tree) => sum + tree.bytes, 0) / 1e9, 1),
      unit: "gigabytes",
      detail: `${String(live.length)} worktrees owned by a Nyte chat, of ${String(worktrees.length)} linked to the repository.`,
      query: "git worktree list --porcelain; du -sk <path>",
    },
    {
      id: "copied-files",
      source: "disk",
      label: "Uncommitted files in worktrees that are not their owner's",
      value: live.reduce(
        (sum, tree) => sum + tree.uncommitted.copied.length + tree.uncommitted.unknown.length,
        0,
      ),
      unit: "files",
      detail: `against ${String(live.reduce((sum, tree) => sum + tree.uncommitted.own.length, 0))} files of the owners' own, by diffing each owner's first and newest snapshot trees.`,
      query:
        "git diff-tree <base>^{tree} <first snapshot>; git diff-tree <HEAD>^{tree} <newest snapshot>; call changes.paths",
    },
    {
      id: "hand-recovery",
      source: "store",
      label: "Spend redoing work after the wipe",
      value: round(asked.reduce((sum, ask) => sum + ask.costUsd, 0)),
      unit: "usd",
      detail: `${String(new Set(asked.map((ask) => ask.session)).size)} chats asked ${String(asked.length)} times, ${String(asked.reduce((sum, ask) => sum + ask.runs, 0))} runs, ${String(round(asked.reduce((sum, ask) => sum + ask.minutes, 0) / 60, 1))} agent-hours.`,
      query:
        "runs whose origin is a message starting 'Another session' or naming /tmp/stack/patches",
    },
  ],
  sessions,
  pullRequests,
  base,
  worktrees,
  checkout: {
    folder: REPOSITORY,
    workspaces: checkoutWorkspaces,
    chats: records.filter((record) => checkoutWorkspaces.includes(record.workspace)).length,
    changedFiles: git(["diff", "--name-only"])
      .split("\n")
      .filter((line) => line !== "").length,
    writersAtWipe,
    runningAtWipe,
    writersNow,
  },
  incident: {
    session: WIPE.session,
    run: WIPE.run,
    call: WIPE.call,
    at: wipe.at,
    command: wipe.command,
    recorded: (() => {
      const recorded = parsed(
        Type.Object({ paths: Type.Array(Text), unattributed: Type.Optional(Type.Boolean()) }),
        wipe.changes,
      );

      return { paths: recorded.paths.length, unattributed: recorded.unattributed === true };
    })(),
    before,
    after,
    keptIn,
    lost,
    asked,
    restored,
    restoreDirectory,
    handRebuild: {
      session: handRebuild.session,
      at: handRebuild.at,
      snapshot: handRebuild.snapshot,
    },
  },
  ciFixes,
  prices,
};

mkdirSync(OUT, { recursive: true });

writeFileSync(join(OUT, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);

console.log(
  `Wrote ${join(OUT, "evidence.json")}: ${String(sessions.length)} sessions, ${String(pullRequests.length)} pull requests, ${String(worktrees.length)} worktrees, ${String(restored.length)} restored files.`,
);
