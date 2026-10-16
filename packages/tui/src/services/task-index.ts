import { foldJobs } from "@nyte-ai/sdk";
import type { Connection, JobView, SessionId, SessionInfo, SessionView } from "@nyte-ai/sdk";
import type { Task } from "../lib/tasks.ts";
import { follow } from "../lib/view-helpers.ts";

interface Child {
  info: SessionInfo;
  view: SessionView | undefined;
  stop: () => void;
}

interface TaskIndexOptions {
  readonly connection: Connection;
  readonly onChange: () => void;
  readonly onError: (error: unknown) => void;
}

export class TaskIndex {
  private readonly options: TaskIndexOptions;
  private readonly children = new Map<SessionId, Child>();
  private jobs: readonly JobView[] = [];
  private readonly stops: (() => void)[] = [];

  constructor(session: SessionInfo, options: TaskIndexOptions) {
    this.options = options;
    const { connection } = options;

    this.stops.push(
      follow(
        connection.sessions.watch({ parents: { kind: "children", session: session.id } }),
        (children) => this.syncChildren(children),
        options.onError,
      ),
      follow(
        foldJobs(connection.workspace(session.workspace).jobs.watch()),
        (jobs) => {
          this.jobs = jobs.filter((job) => job.session === session.id);
          options.onChange();
        },
        options.onError,
      ),
    );
  }

  get tasks(): readonly Task[] {
    return [
      ...[...this.children.values()]
        .toSorted((left, right) => left.info.createdAt - right.info.createdAt)
        .map((child): Task => ({
          kind: "agent",
          id: child.info.id,
          info: child.info,
          view: child.view,
        })),
      ...this.jobs.map((job): Task => ({ kind: "job", id: job.id, job })),
    ];
  }

  close(): void {
    for (const stop of this.stops.splice(0)) stop();

    for (const child of this.children.values()) child.stop();
    this.children.clear();
  }

  private syncChildren(children: readonly SessionInfo[]): void {
    const listed = new Set(children.map((info) => info.id));

    for (const [id, child] of this.children) {
      if (listed.has(id)) continue;
      child.stop();
      this.children.delete(id);
    }

    for (const info of children) {
      const known = this.children.get(info.id);

      if (known !== undefined) {
        known.info = info;
        continue;
      }

      const entry: Child = { info, view: undefined, stop: () => undefined };

      this.children.set(info.id, entry);
      entry.stop = follow(
        this.options.connection.session(info.id).watch(),
        (view) => {
          entry.view = view;
          this.options.onChange();
        },
        this.options.onError,
      );
    }

    this.options.onChange();
  }
}
