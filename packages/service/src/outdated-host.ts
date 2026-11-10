import { statSync } from "node:fs";
import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import type { Cursor, HeadInfo, JobView, Paged, ParentFilter, WorkspaceId } from "@nyte-ai/schema";

const CHECK_MS = 60_000;

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

/**
 * Calls `replace` once `buildFile` has changed identity (inode or mtime) since this call and
 * nothing runs on `host`. Checks every minute until it calls `replace` or the returned stop runs.
 * A `buildFile` missing at the start is never followed.
 */
export function replaceOutdatedHost(
  host: Activity,
  buildFile: string,
  replace: () => void,
): () => void {
  const first = statSync(buildFile, { throwIfNoEntry: false });

  if (first === undefined) return () => undefined;
  const started = identity(first);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = async (): Promise<void> => {
    const now = await stat(buildFile).then(identity, () => null);

    if (now !== null && now !== started) {
      const idle = hostIdle(await listSessions(host), await listJobs(host));

      if (idle && !stopped) {
        stopped = true;
        replace();

        return;
      }
    }

    schedule();
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => void check().catch(schedule), CHECK_MS);
  };

  schedule();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** A run waiting on the user or on a timer is idle: its wait survives a restart. A running job is not, a terminal at its prompt included: its shell's state dies with the host. */
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

function identity(stats: Stats): string {
  return `${String(stats.ino)}:${String(stats.mtimeMs)}`;
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
