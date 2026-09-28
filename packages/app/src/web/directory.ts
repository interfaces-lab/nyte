/**
 * The web bridge's session directory: the server's selected store, re-listed
 * on demand and diffed against the rows already published, so the renderer
 * receives the same numbered `session_directory` changes the desktop sends.
 */
import type { SessionId, SessionInfo, WorkspaceSelection } from "@nyte-ai/protocol";
import type {
  HostEvent,
  SessionDirectoryChange,
  SessionDirectorySnapshot,
  SessionDirectorySource,
  SessionsBridge,
} from "../bridge.ts";
import { loadSessionDirectory } from "../session-directory.ts";

export interface WebSessionDirectory {
  /** Re-list the selected store and publish what changed. Calls during a sweep share it. */
  refresh(): Promise<void>;
  snapshot(): Promise<SessionDirectorySnapshot>;
  /** Adopt the server's selection; a move drops the old store and announces the new one. */
  follow(selection: WorkspaceSelection): void;
  /** Drop everything held, as when the bridge moves to another server. */
  reset(): void;
}

export function createSessionDirectory(dependencies: {
  readonly current: () => Promise<WorkspaceSelection>;
  readonly list: SessionsBridge["list"];
  readonly emit: (event: HostEvent) => void;
}): WebSessionDirectory {
  let rows = new Map<SessionId, SessionInfo>();
  /** Undefined until a sweep or a selection names the store. */
  let workspacePath: string | null | undefined;
  let revision = 0;
  /** Bumped whenever held rows stop describing the server; a sweep that sees it move reads again. */
  let generation = 0;
  let sweeping: Promise<void> | undefined;
  let again = false;

  const publish = (changes: readonly SessionDirectoryChange[]): void => {
    if (changes.length === 0) return;
    revision += 1;
    dependencies.emit({ kind: "session_directory", revision, changes });
  };

  const reset = (): void => {
    generation += 1;
    rows = new Map();

    if (workspacePath !== undefined) {
      publish([{ kind: "dropped", source: { environment: "local", workspacePath } }]);
    }

    workspacePath = undefined;
  };

  const follow = (selection: WorkspaceSelection): void => {
    const path = selection.kind === "home" ? null : selection.workspace.path;

    if (path === workspacePath) return;
    reset();
    workspacePath = path;
    dependencies.emit(
      selection.kind === "home"
        ? { kind: "workspace_closed" }
        : { kind: "workspace_opened", workspace: selection.workspace },
    );
  };

  const sweep = async (): Promise<void> => {
    const selected = generation;
    const selection = await dependencies.current();

    if (selected !== generation) {
      again = true;

      return;
    }

    if (workspacePath === undefined) {
      workspacePath = selection.kind === "home" ? null : selection.workspace.path;
    } else follow(selection);

    const listed = generation;
    const { items } = await loadSessionDirectory(dependencies.list);
    const path = workspacePath;

    if (listed !== generation || path === undefined) {
      again = true;

      return;
    }

    const source: SessionDirectorySource = { environment: "local", workspacePath: path };
    const next = new Map(items.map((session) => [session.sessionId, session]));
    const changes: SessionDirectoryChange[] = [];

    for (const session of items) {
      const held = rows.get(session.sessionId);

      if (held === undefined || JSON.stringify(held) !== JSON.stringify(session)) {
        changes.push({ kind: "upsert", source, session });
      }
    }

    for (const sessionId of rows.keys()) {
      if (!next.has(sessionId)) changes.push({ kind: "removed", sessionId });
    }

    rows = next;
    publish(changes);
  };

  const refresh = (): Promise<void> => {
    if (sweeping !== undefined) {
      again = true;

      return sweeping;
    }

    const run = async (): Promise<void> => {
      try {
        do {
          again = false;
          await sweep();
        } while (again);
      } finally {
        sweeping = undefined;
      }
    };

    sweeping = run();

    return sweeping;
  };

  return {
    refresh,
    follow,
    reset,
    snapshot: async () => {
      await refresh();

      return {
        revision,
        directories:
          workspacePath === undefined
            ? []
            : [{ environment: "local", workspacePath, sessions: [...rows.values()] }],
      };
    },
  };
}
