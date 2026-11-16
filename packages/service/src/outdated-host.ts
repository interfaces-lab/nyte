import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fault } from "@nyte-ai/core";
import type { Cursor, HeadInfo, JobView, Paged, ParentFilter, WorkspaceId } from "@nyte-ai/schema";
import { hostRetirePath, processAlive } from "./host-endpoint.ts";
import type { Supervisor } from "./host-thread.ts";

const CHECK_MS = 10_000;

interface Activity {
  readonly sessions: {
    list(input: {
      readonly parents: ParentFilter;
      readonly cursor?: Cursor;
    }): Promise<Paged<SessionHeads>>;
  };
  readonly workspaces: { list(): Promise<readonly { readonly id: WorkspaceId }[]> };
  workspace(id: WorkspaceId): {
    readonly jobs: { list(): Promise<readonly JobView[]> };
  };
}

interface SessionHeads {
  readonly heads: readonly Pick<HeadInfo, "execution">[];
}

export interface RetireRequest {
  consumed(): Promise<boolean>;
  withdraw(): Promise<void>;
}

export function retireOnRequest(
  host: Activity,
  supervisor: Supervisor | null,
  retire: () => void,
): () => void {
  if (supervisor === null) return () => undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = async (): Promise<void> => {
    const asked = await liveRequests(supervisor);

    if (asked.length > 0 && hostIdle(await listSessions(host), await listJobs(host)) && !stopped) {
      stopped = true;
      await Promise.all(asked.map((path) => rm(path, { force: true })));
      retire();

      return;
    }

    schedule();
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(
      () =>
        void check().catch((error: unknown) => {
          fault("host", "retire check failed", { error: String(error) });
          schedule();
        }),
      CHECK_MS,
    );
  };

  schedule();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

export async function requestRetire(supervisor: Supervisor): Promise<RetireRequest> {
  const folder = hostRetirePath();
  const path = join(folder, String(process.pid));

  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(path, supervisor, { mode: 0o600 });

  return {
    consumed: () =>
      access(path).then(
        () => false,
        () => true,
      ),
    withdraw: () => rm(path, { force: true }),
  };
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/u;

export function supersedes(candidate: string, current: string): boolean {
  const next = SEMVER.exec(candidate.trim());
  const now = SEMVER.exec(current.trim());

  if (next === null || now === null) return false;

  for (const index of [1, 2, 3]) {
    const order = Number(next[index]) - Number(now[index]);

    if (order !== 0) return order > 0;
  }

  return comparePrerelease(next[4], now[4]) > 0;
}

function comparePrerelease(left: string | undefined, right: string | undefined): number {
  if (left === undefined || right === undefined)
    return (left === undefined ? 1 : 0) - (right === undefined ? 1 : 0);

  const lefts = left.split(".");
  const rights = right.split(".");

  for (let index = 0; index < Math.min(lefts.length, rights.length); index++) {
    const order = compareIdentifier(lefts[index] ?? "", rights[index] ?? "");

    if (order !== 0) return order;
  }

  return lefts.length - rights.length;
}

function compareIdentifier(left: string, right: string): number {
  const numbers = /^\d+$/u;

  if (numbers.test(left) && numbers.test(right)) return Number(left) - Number(right);

  if (numbers.test(left) !== numbers.test(right)) return numbers.test(left) ? -1 : 1;

  return left < right ? -1 : left > right ? 1 : 0;
}

export function hostIdle(
  sessions: readonly SessionHeads[],
  jobs: readonly Pick<JobView, "state">[],
): boolean {
  const running = sessions.some((session) =>
    session.heads.some(
      (head) => head.execution.kind === "live" || head.execution.kind === "retrying",
    ),
  );

  return !running && jobs.every((job) => job.state.kind !== "running");
}

async function liveRequests(supervisor: Supervisor): Promise<readonly string[]> {
  const folder = hostRetirePath();
  const names = await readdir(folder).catch(() => []);

  const requests = await Promise.all(
    names.map(async (name) => {
      const path = join(folder, name);
      const pid = Number(name);

      if (!(Number.isSafeInteger(pid) && pid > 0 && processAlive(pid))) {
        await rm(path, { force: true });

        return null;
      }

      return (await readFile(path, "utf8").catch(() => null)) === supervisor ? path : null;
    }),
  );

  return requests.filter((path) => path !== null);
}

async function listSessions(host: Activity): Promise<readonly SessionHeads[]> {
  let page = await host.sessions.list({ parents: { kind: "all" } });
  const rows = [...page.items];

  while (page.next !== null) {
    page = await host.sessions.list({ parents: { kind: "all" }, cursor: page.next });
    rows.push(...page.items);
  }

  return rows;
}

async function listJobs(host: Activity): Promise<readonly JobView[]> {
  const workspaces = await host.workspaces.list();
  const jobs = await Promise.all(workspaces.map((entry) => host.workspace(entry.id).jobs.list()));

  return jobs.flat();
}
