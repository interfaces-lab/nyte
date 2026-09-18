import type { QueryClient } from "@tanstack/react-query";
import type { SessionId, SessionInfo, SessionSnapshot } from "@nyte-ai/protocol";
import { toast } from "@nyte-ai/ui/sonner";
import type { SessionsBridge, WorkspaceSessionDirectory } from "../../shared/ipc.ts";
import { ActionToasts } from "./action-toasts.ts";
import { keys } from "./query-keys.ts";
import type { SessionPage } from "./session-directory.ts";

type SessionWrites = Pick<SessionsBridge, "rename" | "setPinned" | "setArchived" | "delete">;

type SessionChange =
  | { readonly kind: "archive"; readonly archived: boolean }
  | { readonly kind: "pin"; readonly pinned: boolean }
  | { readonly kind: "rename"; readonly name: string }
  | { readonly kind: "delete" };

interface PendingChange {
  readonly sessionId: SessionId;
  readonly change: SessionChange;
}

/** Closing a pane returns a guarded restoration, so Undo cannot replace a newer selection. */
type HideSession = (sessionId: SessionId) => () => void;

function applyChange(session: SessionInfo, change: SessionChange): SessionInfo | null {
  switch (change.kind) {
    case "archive":
      return { ...session, archived: change.archived };
    case "pin":
      return { ...session, pinned: change.pinned };
    case "rename":
      return { ...session, name: change.name };
    case "delete":
      return null;
    default: {
      const exhaustive: never = change;
      return exhaustive;
    }
  }
}

/**
 * Query caches retain host data. Pending edits are projected at read time so
 * polling, watch snapshots, and workspace reloads cannot erase local intent.
 * Successful edits patch the caches before their projection is removed.
 */
export class SessionActions {
  readonly #client: QueryClient;
  readonly #sessions: SessionWrites;
  readonly #toasts: ActionToasts;
  readonly #listeners = new Set<() => void>();
  readonly #queues = new Map<SessionId, Promise<boolean>>();
  readonly #archiveVersions = new Map<SessionId, PendingChange>();
  readonly #archiveNotifications = new Map<SessionId, () => void>();
  #pending: readonly PendingChange[] = [];

  constructor({
    client,
    sessions,
    toasts = new ActionToasts(),
  }: {
    client: QueryClient;
    sessions: SessionWrites;
    toasts?: ActionToasts;
  }) {
    this.#client = client;
    this.#sessions = sessions;
    this.#toasts = toasts;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly PendingChange[] => this.#pending;

  projectSession(session: SessionInfo, changes = this.#pending): SessionInfo | null {
    let projected: SessionInfo | null = session;
    for (const pending of changes) {
      if (pending.sessionId === session.sessionId && projected !== null)
        projected = applyChange(projected, pending.change);
    }
    return projected;
  }

  projectList(sessions: readonly SessionInfo[], changes = this.#pending): readonly SessionInfo[] {
    return sessions.flatMap((session) => {
      const projected = this.projectSession(session, changes);
      return projected === null ? [] : [projected];
    });
  }

  rename(input: { sessionId: SessionId; name: string }): Promise<boolean> {
    return this.#run(this.#add(input.sessionId, { kind: "rename", name: input.name }));
  }

  pin(input: { sessionId: SessionId; pinned: boolean }): void {
    void this.#run(this.#add(input.sessionId, { kind: "pin", pinned: input.pinned }));
  }

  archive(sessionIds: readonly SessionId[], archived: boolean, hide?: HideSession): void {
    for (const sessionId of new Set(sessionIds)) {
      const session = this.#find(sessionId);
      if (session === undefined || session.archived === archived) continue;
      this.#archiveNotifications.get(sessionId)?.();
      const pending = this.#add(sessionId, { kind: "archive", archived });
      this.#archiveVersions.set(sessionId, pending);
      const closed = Promise.withResolvers<void>();
      const restore = archived ? hide?.(sessionId) : undefined;
      const removeToastEntry = this.#toasts.add(archived ? "archived" : "restored", {
        undo: () => {
          if (this.#archiveVersions.get(sessionId) !== pending) {
            closed.resolve();
            return;
          }
          const inverse = this.#add(sessionId, { kind: "archive", archived: session.archived });
          this.#archiveVersions.set(sessionId, inverse);
          const restoreUndo = session.archived ? hide?.(sessionId) : undefined;
          restore?.();
          void this.#run(inverse).then((saved) => {
            if (this.#archiveVersions.get(sessionId) === inverse) {
              this.#archiveVersions.delete(sessionId);
              if (!saved && this.#find(sessionId)?.archived === archived) {
                if (session.archived) restoreUndo?.();
                else hide?.(sessionId);
              }
            }
            closed.resolve();
          });
        },
        commit: () => closed.resolve(),
      });
      const discard = (): void => {
        removeToastEntry();
        closed.resolve();
      };
      this.#archiveNotifications.set(sessionId, discard);
      const work = this.#run(pending).then((saved) => {
        if (saved) return;
        discard();
        if (this.#archiveVersions.get(sessionId) === pending) restore?.();
      });
      void Promise.all([work, closed.promise]).then(() => {
        if (this.#archiveNotifications.get(sessionId) === discard)
          this.#archiveNotifications.delete(sessionId);
        if (this.#archiveVersions.get(sessionId) === pending)
          this.#archiveVersions.delete(sessionId);
      });
    }
  }

  delete(sessionId: SessionId, hide: HideSession): void {
    if (
      this.#pending.some(
        (pending) => pending.sessionId === sessionId && pending.change.kind === "delete",
      )
    )
      return;
    this.#archiveNotifications.get(sessionId)?.();
    this.#archiveVersions.delete(sessionId);
    const pending = this.#add(sessionId, { kind: "delete" });
    const restore = hide(sessionId);
    this.#toasts.add("deleted", {
      undo: () => {
        this.#remove(pending);
        restore();
      },
      commit: () => {
        void this.#run(pending).then((saved) => {
          if (!saved) restore();
        });
      },
    });
  }

  #find(sessionId: SessionId): SessionInfo | undefined {
    const session =
      this.#client
        .getQueryData<readonly WorkspaceSessionDirectory[]>(keys.sessionDirectory)
        ?.flatMap((directory) => directory.sessions)
        .find((item) => item.sessionId === sessionId) ??
      this.#client.getQueryData<SessionInfo | null>(keys.session(sessionId)) ??
      this.#client.getQueryData<SessionSnapshot>(keys.snapshot(sessionId))?.session ??
      this.#client
        .getQueryData<SessionPage>(keys.sessionPreview)
        ?.items.find((item) => item.sessionId === sessionId);
    return session === undefined ? undefined : (this.projectSession(session) ?? undefined);
  }

  #add(sessionId: SessionId, change: SessionChange): PendingChange {
    const pending = { sessionId, change };
    this.#pending = [...this.#pending, pending];
    this.#emit();
    return pending;
  }

  #remove(pending: PendingChange): void {
    this.#pending = this.#pending.filter((item) => item !== pending);
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  #run(pending: PendingChange): Promise<boolean> {
    const previous = this.#queues.get(pending.sessionId) ?? Promise.resolve(true);
    const work = previous.then(async () => {
      try {
        const { sessionId, change } = pending;
        switch (change.kind) {
          case "archive":
            await this.#sessions.setArchived({ sessionId, archived: change.archived });
            break;
          case "pin":
            await this.#sessions.setPinned({ sessionId, pinned: change.pinned });
            break;
          case "rename":
            await this.#sessions.rename({ sessionId, name: change.name });
            break;
          case "delete":
            await this.#sessions.delete({ sessionId });
            break;
          default: {
            const exhaustive: never = change;
            return exhaustive;
          }
        }
        // Discard reads started before the write before removing its projection.
        await Promise.all([
          this.#client.cancelQueries({ queryKey: keys.sessions }),
          this.#client.cancelQueries({ queryKey: keys.session(sessionId), exact: true }),
          this.#client.cancelQueries({ queryKey: keys.snapshot(sessionId), exact: true }),
        ]);
        this.#commit(pending);
        return true;
      } catch {
        const verb =
          pending.change.kind === "archive" && !pending.change.archived
            ? "restore"
            : pending.change.kind;
        toast.error(`Couldn't ${verb} this chat. Try again.`, {
          id: `session-action-error-${verb}`,
        });
        return false;
      } finally {
        this.#remove(pending);
      }
    });
    this.#queues.set(pending.sessionId, work);
    void work.then(() => {
      if (this.#queues.get(pending.sessionId) !== work) return;
      this.#queues.delete(pending.sessionId);
      void this.#client.invalidateQueries({ queryKey: keys.sessions });
      void this.#client.invalidateQueries({
        queryKey: keys.session(pending.sessionId),
        exact: true,
      });
      if (pending.change.kind !== "delete")
        void this.#client.invalidateQueries({
          queryKey: keys.snapshot(pending.sessionId),
          exact: true,
        });
    });
    return work;
  }

  #commit({ sessionId, change }: PendingChange): void {
    const update = (sessions: readonly SessionInfo[]): readonly SessionInfo[] =>
      sessions.flatMap((session) => {
        if (session.sessionId !== sessionId) return [session];
        const changed = applyChange(session, change);
        return changed === null ? [] : [changed];
      });
    this.#client.setQueryData<readonly WorkspaceSessionDirectory[]>(
      keys.sessionDirectory,
      (directories) =>
        directories?.map((directory) => ({ ...directory, sessions: update(directory.sessions) })),
    );
    this.#client.setQueryData<SessionPage>(keys.sessionPreview, (page) =>
      page === undefined ? page : { ...page, items: update(page.items) },
    );
    this.#client.setQueriesData<SessionPage>({ queryKey: ["sessions", "search"] }, (page) =>
      page === undefined
        ? page
        : { ...page, items: update(page.items).filter((session) => !session.archived) },
    );
    this.#client.setQueryData<SessionInfo | null>(keys.session(sessionId), (session) =>
      session === null || session === undefined ? session : applyChange(session, change),
    );
    if (change.kind === "delete") {
      this.#client.removeQueries({ queryKey: keys.snapshot(sessionId), exact: true });
      return;
    }
    this.#client.setQueryData<SessionSnapshot>(keys.snapshot(sessionId), (snapshot) =>
      snapshot === undefined
        ? snapshot
        : { ...snapshot, session: applyChange(snapshot.session, change) ?? snapshot.session },
    );
  }
}
