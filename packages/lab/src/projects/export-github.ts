import { execFileSync, spawnSync } from "node:child_process";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { CheckFact, CheckFailure, CheckState, Evidence, PullRequestFact } from "./evidence.ts";

export const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };

const ESCAPE = String.fromCharCode(27);

const Text = Type.String();

const Count = Type.Number();

const MaybeText = Type.Union([Type.String(), Type.Null()]);

export function command(binary: string, args: readonly string[]): string {
  return execFileSync(binary, args, { env: ENV, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function gh<S extends TSchema>(schema: S, args: readonly string[]): Static<S> {
  const parsed: unknown = JSON.parse(command("gh", args));

  if (!Value.Check(schema, parsed))
    throw new Error(`gh ${args.join(" ")} answered an unexpected shape`);

  return parsed;
}

interface Head {
  readonly sha: string;
  readonly checks: readonly CheckFact[];
}

export interface GitHubFacts {
  readonly repository: string;
  readonly pullRequests: readonly PullRequestFact[];
  readonly base: Evidence["base"];
  readonly ciHistory: readonly { readonly conclusion: string; readonly createdAt: string }[];
  readonly releaseMinutes: readonly number[];
}

export function readGitHub(openers: ReadonlyMap<number, string>, at: number): GitHubFacts {
  const PullRequestList = Type.Array(
    Type.Object({
      number: Count,
      title: Text,
      state: Type.Union([Type.Literal("OPEN"), Type.Literal("MERGED"), Type.Literal("CLOSED")]),
      baseRefName: Text,
      headRefName: Text,
      headRefOid: Text,
      createdAt: Text,
      mergedAt: MaybeText,
      closedAt: MaybeText,
    }),
  );

  const RunList = Type.Array(
    Type.Object({
      databaseId: Count,
      workflowName: Text,
      headSha: Text,
      conclusion: Text,
      createdAt: Text,
      updatedAt: Text,
    }),
  );

  const RunJobs = Type.Object({
    jobs: Type.Array(Type.Object({ name: Text, conclusion: Text, completedAt: Text })),
  });

  const repository = gh(Type.Object({ nameWithOwner: Text }), [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
  ]);

  const ghRepository = ["--repo", repository.nameWithOwner];

  const listed = gh(PullRequestList, [
    "pr",
    "list",
    ...ghRepository,
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "number,title,state,baseRefName,headRefName,headRefOid,createdAt,mergedAt,closedAt",
  ]);

  const failures = new Map<number, CheckFailure | null>();

  function readFailure(runId: number): CheckFailure | null {
    const known = failures.get(runId);

    if (known !== undefined) return known;

    const ran = spawnSync("gh", ["run", "view", String(runId), ...ghRepository, "--log-failed"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });

    const lines = ran.stdout.split("\n").map((line) => ({
      step: line.split("\t")[1] ?? "",
      text: (line.split("\t").at(-1) ?? "")
        .replace(/^﻿/, "")
        .replaceAll(ESCAPE, "^[")
        .replace(/\^\[\[[0-9;]*m/g, "")
        .replace(/^\S+Z /, ""),
    }));

    const errorAt = lines.findIndex((line) => line.text.startsWith("##[error]"));
    const ahead = lines.slice(0, errorAt).map((line) => line.text);
    const named = lines[errorAt]?.step.replace(/^Run /, "");

    const failure =
      errorAt === -1
        ? null
        : {
            step:
              named === undefined || named === "" || named === "UNKNOWN STEP"
                ? (ahead
                    .findLast((line) => line.startsWith("##[group]Run "))
                    ?.slice("##[group]Run ".length) ?? "unknown")
                : named,
            files: ahead
              .filter((line) => /^[\w./-]+\.\w+ \(\d+ms\)$/.test(line))
              .map((line) => line.replace(/ \(\d+ms\)$/, "")),
            message:
              ahead.findLast(
                (line) =>
                  /issues found|no changesets|error/i.test(line) &&
                  !line.startsWith("[ELIFECYCLE]"),
              ) ?? "",
          };

    failures.set(runId, failure);

    return failure;
  }

  function readState(
    conclusion: string | undefined,
    status: string | undefined,
    state: string | undefined,
  ): CheckState {
    const word = (conclusion ?? state ?? status ?? "").toUpperCase();

    if (word === "SUCCESS") return "passed";

    if (word === "FAILURE" || word === "ERROR" || word === "CANCELLED" || word === "TIMED_OUT")
      return "failed";

    return word === "SKIPPED" || word === "NEUTRAL" ? "skipped" : "pending";
  }

  function runsBefore(filters: readonly string[]): Static<typeof RunList> {
    return gh(RunList, [
      "run",
      "list",
      ...ghRepository,
      ...filters,
      "--limit",
      "500",
      "--json",
      "databaseId,workflowName,headSha,conclusion,createdAt,updatedAt",
    ])
      .filter((run) => Date.parse(run.createdAt) <= at)
      .toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  function jobChecks(run: Static<typeof RunList>[number]): readonly CheckFact[] {
    return gh(RunJobs, [
      "run",
      "view",
      String(run.databaseId),
      ...ghRepository,
      "--json",
      "jobs",
    ]).jobs.map((job) => {
      const state =
        Date.parse(job.completedAt) <= at
          ? readState(job.conclusion, undefined, undefined)
          : "pending";

      return {
        workflow: run.workflowName,
        name: job.name,
        state,
        runId: run.databaseId,
        failure: state === "failed" ? readFailure(run.databaseId) : null,
      };
    });
  }

  function headAt(branch: string, fallback: string): Head {
    const runs = runsBefore(["--branch", branch]);
    const sha = runs[0]?.headSha ?? fallback;

    const newest = [
      ...new Map(
        runs
          .filter((run) => run.headSha === sha)
          .toReversed()
          .map((run) => [run.workflowName, run]),
      ).values(),
    ];

    return { sha, checks: newest.flatMap((run) => jobChecks(run)) };
  }

  function stateAt(pull: Static<typeof PullRequestList>[number]): PullRequestFact["state"] {
    if (pull.mergedAt !== null && Date.parse(pull.mergedAt) <= at) return "MERGED";

    return pull.closedAt !== null && Date.parse(pull.closedAt) <= at ? "CLOSED" : "OPEN";
  }

  const pullRequests: readonly PullRequestFact[] = listed
    .filter((pull) => Date.parse(pull.createdAt) <= at)
    .toSorted((left, right) => left.number - right.number)
    .map((pull) => {
      const state = stateAt(pull);
      const head = state === "OPEN" ? headAt(pull.headRefName, pull.headRefOid) : null;

      return {
        number: pull.number,
        title: pull.title,
        state,
        base: pull.baseRefName,
        head: pull.headRefName,
        headSha: head?.sha ?? pull.headRefOid,
        createdAt: Date.parse(pull.createdAt),
        mergedAt: state === "MERGED" && pull.mergedAt !== null ? Date.parse(pull.mergedAt) : null,
        closedAt: state === "OPEN" || pull.closedAt === null ? null : Date.parse(pull.closedAt),
        openedBy: openers.get(pull.number) ?? null,
        checks: head?.checks ?? [],
      };
    });

  const newestBase = runsBefore([
    "--branch",
    "main",
    "--workflow",
    "CI",
    "--status",
    "completed",
  ]).find((run) => Date.parse(run.updatedAt) <= at);

  if (newestBase === undefined) throw new Error("main has no CI run finished by then");

  const base = {
    branch: "main",
    sha: newestBase.headSha,
    at: Date.parse(newestBase.createdAt),
    checks: jobChecks(newestBase),
  };

  const ciHistory = runsBefore(["--workflow", "CI"]).filter(
    (run) => Date.parse(run.updatedAt) <= at,
  );

  const releaseRuns = runsBefore(["--workflow", "Release", "--status", "success"])
    .filter((run) => Date.parse(run.updatedAt) <= at)
    .slice(0, 5);

  return {
    repository: repository.nameWithOwner,
    pullRequests,
    base,
    ciHistory,
    releaseMinutes: releaseRuns.map(
      (run) => (Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 60_000,
    ),
  };
}
