/**
 * The renderer's copy of the host's session directory. The host pushes
 * changes in numbered revisions; a snapshot read names the revision it
 * folded in. Events before a snapshot wait for it, contiguous events apply,
 * and a gap means something was missed, so a fresh snapshot is read.
 */
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import type {
  SessionDirectoryChange,
  SessionDirectorySnapshot,
  SessionDirectorySource,
  WorkspaceSessionDirectory,
} from "./bridge.ts";

export interface SessionDirectoryEvent {
  readonly revision: number;
  readonly changes: readonly SessionDirectoryChange[];
}

export interface SessionDirectorySink {
  /** Replace the top-level rows; a snapshot or the fold of one change event. */
  directory(
    update: (
      directories: readonly WorkspaceSessionDirectory[] | undefined,
    ) => readonly WorkspaceSessionDirectory[] | undefined,
  ): void;
  /** Per-session caches beside the directory: rows, child lists, a removed session's memory. */
  rows(changes: readonly SessionDirectoryChange[]): void;
  /** A revision was missed: read the snapshot again. */
  resync(): void;
}

function sameSource(directory: WorkspaceSessionDirectory, source: SessionDirectorySource): boolean {
  return directory.environment === "cloud"
    ? source.environment === "cloud"
    : source.environment === "local" && directory.workspacePath === source.workspacePath;
}

function without(sessions: readonly SessionInfo[], sessionId: SessionId): readonly SessionInfo[] {
  return sessions.filter((session) => session.sessionId !== sessionId);
}

/** Fold one change into the top-level rows. Children never enter a directory. */
export function applyDirectoryChange(
  directories: readonly WorkspaceSessionDirectory[],
  change: SessionDirectoryChange,
): readonly WorkspaceSessionDirectory[] {
  switch (change.kind) {
    case "upsert": {
      const { session, source } = change;

      if (session.parent !== undefined) return directories;
      const index = directories.findIndex((directory) => sameSource(directory, source));

      if (index === -1) {
        return [
          ...directories.map((directory) => ({
            ...directory,
            sessions: without(directory.sessions, session.sessionId),
          })),
          source.environment === "cloud"
            ? {
                environment: "cloud",
                sessions: [session],
                delegating: [],
                availability: { kind: "ready" },
              }
            : {
                environment: "local",
                workspacePath: source.workspacePath,
                sessions: [session],
                delegating: [],
              },
        ];
      }

      return directories.map((directory, at) => {
        if (at !== index) {
          return { ...directory, sessions: without(directory.sessions, session.sessionId) };
        }

        const held = directory.sessions.some((row) => row.sessionId === session.sessionId);

        return {
          ...directory,
          sessions: held
            ? directory.sessions.map((row) => (row.sessionId === session.sessionId ? session : row))
            : [session, ...directory.sessions],
        };
      });
    }

    case "removed":
      return directories.map((directory) => ({
        ...directory,
        sessions: without(directory.sessions, change.sessionId),
      }));
    case "dropped":
      return directories.filter((directory) => !sameSource(directory, change.source));
    case "availability": {
      const cloud = directories.find((directory) => directory.environment === "cloud");

      if (cloud === undefined) {
        return [
          ...directories,
          { environment: "cloud", sessions: [], delegating: [], availability: change.availability },
        ];
      }

      return directories.map((directory) =>
        directory.environment === "cloud"
          ? { ...directory, availability: change.availability }
          : directory,
      );
    }

    case "delegating":
      return directories.map((directory) =>
        sameSource(directory, change.source)
          ? { ...directory, delegating: change.sessionIds }
          : directory,
      );

    default: {
      const _exhaustive: never = change;

      return _exhaustive;
    }
  }
}

export function applyDirectoryChanges(
  directories: readonly WorkspaceSessionDirectory[],
  changes: readonly SessionDirectoryChange[],
): readonly WorkspaceSessionDirectory[] {
  return changes.reduce(applyDirectoryChange, directories);
}

export class SessionDirectoryFeed {
  readonly #sink: SessionDirectorySink;
  #revision: number | undefined;
  #buffered: SessionDirectoryEvent[] = [];

  constructor(sink: SessionDirectorySink) {
    this.#sink = sink;
  }

  /** A snapshot arrived: it becomes the directory, with any later buffered events folded in. */
  snapshot(snapshot: SessionDirectorySnapshot): readonly WorkspaceSessionDirectory[] {
    let directories = snapshot.directories;
    this.#revision = snapshot.revision;
    const buffered = this.#buffered.toSorted((left, right) => left.revision - right.revision);
    this.#buffered = [];

    for (const [index, event] of buffered.entries()) {
      if (event.revision <= this.#revision) continue;

      if (event.revision !== this.#revision + 1) {
        this.#buffered = buffered.slice(index);
        this.#revision = undefined;
        this.#sink.resync();
        break;
      }

      this.#revision = event.revision;
      this.#sink.rows(event.changes);
      directories = applyDirectoryChanges(directories, event.changes);
    }

    this.#sink.directory(() => directories);

    return directories;
  }

  receive(event: SessionDirectoryEvent): void {
    if (this.#revision === undefined) {
      this.#buffered.push(event);

      return;
    }

    if (event.revision <= this.#revision) return;

    if (event.revision !== this.#revision + 1) {
      this.#revision = undefined;
      this.#buffered = [event];
      this.#sink.resync();

      return;
    }

    this.#revision = event.revision;
    this.#sink.rows(event.changes);
    this.#sink.directory((directories) =>
      directories === undefined ? directories : applyDirectoryChanges(directories, event.changes),
    );
  }
}
