/**
 * The host's model of every session row it knows about, children included,
 * across local stores and the server. Producers (tracked watches, sweeps,
 * mutation hooks) write whole rows; the model emits only what actually
 * changed, coalesced into one `session_directory` event per flush. The
 * snapshot the renderer starts from is read straight from here.
 */
import { isDeepStrictEqual } from "node:util";
import { sessionMark } from "@nyte-ai/client";
import type { SessionId, SessionInfo } from "@nyte-ai/core";
import type {
  CloudAvailability,
  HostEvent,
  SessionDirectoryChange,
  SessionDirectorySnapshot,
  SessionDirectorySource,
  WorkspaceSessionDirectory,
} from "@nyte-ai/app/bridge.ts";

const FLUSH_MS = 50;

interface Row {
  readonly session: SessionInfo;
  /** The model's write clock when this row landed; a sweep older than it does not replace it. */
  readonly writtenAt: number;
}

interface SourceRows {
  readonly key: string;
  readonly source: SessionDirectorySource;
  readonly rows: Map<SessionId, Row>;
  hydrated: boolean;
  availability: CloudAvailability;
  /** Top-level rows with a working subagent, as last sent. */
  delegating: ReadonlySet<SessionId>;
}

export type SessionTransition = (
  previous: SessionInfo | undefined,
  next: SessionInfo | undefined,
) => void;

export function sourceKey(source: SessionDirectorySource): string {
  return source.environment === "cloud" ? "cloud" : `local:${source.workspacePath ?? ""}`;
}

export class SessionDirectory {
  readonly #emit: (event: HostEvent) => void;
  readonly #sources = new Map<string, SourceRows>();
  readonly #owners = new Map<SessionId, string>();
  readonly #tombstones = new Map<SessionId, { readonly key: string; readonly at: number }>();
  readonly #transitions = new Set<SessionTransition>();
  #pending: SessionDirectoryChange[] = [];
  #flush: ReturnType<typeof setTimeout> | undefined;
  #revision = 0;
  #clock = 0;
  #closed = false;

  constructor(emit: (event: HostEvent) => void) {
    this.#emit = emit;
  }

  /** The write clock: a sweep records it when it starts so `replace` keeps rows written since. */
  clock(): number {
    return this.#clock;
  }

  get(sessionId: SessionId): SessionInfo | undefined {
    const key = this.#owners.get(sessionId);

    return key === undefined ? undefined : this.#sources.get(key)?.rows.get(sessionId)?.session;
  }

  /** Every row held for a source, children included. */
  rows(source: SessionDirectorySource): readonly SessionInfo[] {
    const held = this.#sources.get(sourceKey(source));

    return held === undefined ? [] : [...held.rows.values()].map((row) => row.session);
  }

  onTransition(listener: SessionTransition): () => void {
    this.#transitions.add(listener);

    return () => this.#transitions.delete(listener);
  }

  upsert(source: SessionDirectorySource, session: SessionInfo): void {
    this.#write(this.#source(source), session, true);
  }

  /** The session and every descendant leave at once, and a sweep already listing cannot bring them back. */
  remove(sessionId: SessionId): void {
    const key = this.#owners.get(sessionId);

    if (key === undefined) return;
    const held = this.#sources.get(key);

    if (held === undefined) return;

    for (const member of this.#subtree(held, sessionId)) {
      this.#tombstones.set(member, { key, at: this.#tick() });
      this.#delete(key, member, true);
    }
  }

  /**
   * A sweep's rows for one source, children included. Rows written after
   * `startedAt` keep their newer copy, and rows removed after it stay removed.
   */
  replace(
    source: SessionDirectorySource,
    sessions: readonly SessionInfo[],
    startedAt: number,
  ): void {
    const held = this.#source(source);
    const notify = held.hydrated;
    const listed = this.#fill(held, sessions, startedAt);

    for (const [sessionId, row] of held.rows) {
      if (listed.has(sessionId) || row.writtenAt > startedAt) continue;
      this.#delete(held.key, sessionId, notify);
    }

    for (const [sessionId, tombstone] of this.#tombstones) {
      if (tombstone.key === held.key && tombstone.at <= startedAt) {
        this.#tombstones.delete(sessionId);
      }
    }

    held.hydrated = true;
  }

  /**
   * One page of a sweep still listing: its rows land under `replace`'s rules so
   * a snapshot read mid-sweep shows them, and nothing is removed until the
   * sweep's full list arrives.
   */
  fill(source: SessionDirectorySource, sessions: readonly SessionInfo[], startedAt: number): void {
    this.#fill(this.#source(source), sessions, startedAt);
  }

  drop(source: SessionDirectorySource): void {
    const key = sourceKey(source);
    const held = this.#sources.get(key);

    if (held === undefined) return;
    this.#sources.delete(key);

    for (const sessionId of held.rows.keys()) this.#owners.delete(sessionId);

    for (const [sessionId, tombstone] of this.#tombstones) {
      if (tombstone.key === key) this.#tombstones.delete(sessionId);
    }

    this.#pending = this.#pending.filter(
      (change) =>
        !(
          ((change.kind === "upsert" || change.kind === "delegating") &&
            sourceKey(change.source) === key) ||
          (change.kind === "availability" && key === "cloud")
        ),
    );
    this.#queue({ kind: "dropped", source });
  }

  /** The server's reachability; opening a cloud source that holds no rows yet. */
  setAvailability(availability: CloudAvailability): void {
    const known = this.#sources.has("cloud");
    const held = this.#source({ environment: "cloud" });

    if (known && isDeepStrictEqual(held.availability, availability)) return;
    held.availability = availability;
    this.#pending = this.#pending.filter((change) => change.kind !== "availability");
    this.#queue({ kind: "availability", availability });
  }

  snapshot(): SessionDirectorySnapshot {
    this.flush();

    return {
      revision: this.#revision,
      directories: [...this.#sources.values()].map((held): WorkspaceSessionDirectory => {
        const sessions = held.rows
          .values()
          .map((row) => row.session)
          .filter((session) => session.parent === undefined)
          .toArray();

        const delegating = [...held.delegating];

        return held.source.environment === "cloud"
          ? { environment: "cloud", sessions, delegating, availability: held.availability }
          : {
              environment: "local",
              workspacePath: held.source.workspacePath,
              sessions,
              delegating,
            };
      }),
    };
  }

  flush(): void {
    clearTimeout(this.#flush);
    this.#flush = undefined;

    if (this.#pending.length === 0 || this.#closed) return;

    for (const held of this.#sources.values()) {
      const delegating = this.#delegating(held);

      if (
        delegating.size === held.delegating.size &&
        delegating.values().every((sessionId) => held.delegating.has(sessionId))
      )
        continue;

      held.delegating = delegating;
      this.#pending.push({
        kind: "delegating",
        source: held.source,
        sessionIds: [...delegating],
      });
    }

    const changes = this.#pending;
    this.#pending = [];
    this.#revision += 1;
    this.#emit({ kind: "session_directory", revision: this.#revision, changes });
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#flush);
    this.#flush = undefined;
    this.#pending = [];
    this.#sources.clear();
    this.#owners.clear();
    this.#tombstones.clear();
    this.#transitions.clear();
  }

  #tick(): number {
    this.#clock += 1;

    return this.#clock;
  }

  #source(source: SessionDirectorySource): SourceRows {
    const key = sourceKey(source);
    const existing = this.#sources.get(key);

    if (existing !== undefined) return existing;

    const created: SourceRows = {
      key,
      source,
      rows: new Map(),
      hydrated: false,
      availability: { kind: "ready" },
      delegating: new Set(),
    };

    this.#sources.set(key, created);

    return created;
  }

  /** The rows above a child, nearest first, stopping where the chain leaves what is held. */
  #ancestors(held: SourceRows, session: SessionInfo): readonly SessionInfo[] {
    const chain: SessionInfo[] = [];
    let current = session;

    while (current.parent !== undefined && chain.length <= held.rows.size) {
      const above = held.rows.get(current.parent.sessionId)?.session;

      if (above === undefined) break;
      chain.push(above);
      current = above;
    }

    return chain;
  }

  /** Top-level rows with a subagent still running, at any depth. */
  #delegating(held: SourceRows): ReadonlySet<SessionId> {
    const roots = new Set<SessionId>();

    for (const { session } of held.rows.values()) {
      if (session.parent === undefined) continue;
      const mark = sessionMark(session);

      if (mark !== "working" && mark !== "retry") continue;
      const root = this.#ancestors(held, session).at(-1);

      if (root !== undefined && root.parent === undefined) roots.add(root.sessionId);
    }

    return roots;
  }

  #subtree(held: SourceRows, sessionId: SessionId): readonly SessionId[] {
    return [
      sessionId,
      ...held.rows
        .values()
        .filter(({ session }) =>
          this.#ancestors(held, session).some((above) => above.sessionId === sessionId),
        )
        .map(({ session }) => session.sessionId),
    ];
  }

  #fill(
    held: SourceRows,
    sessions: readonly SessionInfo[],
    startedAt: number,
  ): ReadonlySet<SessionId> {
    const listed = new Set<SessionId>();

    for (const session of sessions) {
      listed.add(session.sessionId);
      const tombstone = this.#tombstones.get(session.sessionId);

      if (tombstone !== undefined && tombstone.at > startedAt) continue;
      const current = held.rows.get(session.sessionId);

      if (current !== undefined && current.writtenAt > startedAt) continue;
      this.#write(held, session, held.hydrated);
    }

    return listed;
  }

  #write(held: SourceRows, session: SessionInfo, notify: boolean): void {
    const previousKey = this.#owners.get(session.sessionId);

    if (previousKey !== undefined && previousKey !== held.key) {
      this.#delete(previousKey, session.sessionId, false);
    }

    const previous = held.rows.get(session.sessionId)?.session;

    if (previous !== undefined && isDeepStrictEqual(previous, session)) return;
    held.rows.set(session.sessionId, { session, writtenAt: this.#tick() });
    this.#owners.set(session.sessionId, held.key);
    this.#tombstones.delete(session.sessionId);
    this.#queue({ kind: "upsert", source: held.source, session });

    if (notify) for (const listener of this.#transitions) listener(previous, session);
  }

  #delete(key: string, sessionId: SessionId, notify: boolean): void {
    const held = this.#sources.get(key);
    const previous = held?.rows.get(sessionId)?.session;

    if (held === undefined || previous === undefined) return;
    held.rows.delete(sessionId);
    this.#owners.delete(sessionId);
    this.#queue({ kind: "removed", sessionId });

    if (notify) for (const listener of this.#transitions) listener(previous, undefined);
  }

  #queue(change: SessionDirectoryChange): void {
    if (this.#closed) return;

    if (change.kind === "upsert" || change.kind === "removed") {
      const sessionId = change.kind === "upsert" ? change.session.sessionId : change.sessionId;
      this.#pending = this.#pending.filter(
        (pending) =>
          !(
            (pending.kind === "upsert" && pending.session.sessionId === sessionId) ||
            (pending.kind === "removed" && pending.sessionId === sessionId)
          ),
      );
    }

    this.#pending.push(change);
    this.#flush ??= setTimeout(() => this.flush(), FLUSH_MS);
  }
}
