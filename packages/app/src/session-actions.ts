import type { QueryClient } from "@tanstack/react-query";
import { keyedSerial } from "@nyte-ai/schema/serial";
import type { Connection, SessionId, SessionInfo } from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import { ActionToasts } from "./action-toasts.ts";
import { keys } from "./query-keys.ts";
import { connection, findListedSession } from "./sdk.tsx";

type SessionChange =
  | { readonly kind: "archive"; readonly archived: boolean }
  | { readonly kind: "pin"; readonly pinned: boolean }
  | { readonly kind: "rename"; readonly name: string }
  | { readonly kind: "delete" };

interface PendingChange {
  readonly sessionId: SessionId;
  readonly change: SessionChange;
}

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

export class SessionActions {
  readonly #client: QueryClient;
  readonly #connection: () => Pick<Connection, "session">;
  readonly #toasts: ActionToasts;
  readonly #listeners = new Set<() => void>();
  readonly #queues = keyedSerial<SessionId>();
  readonly #archiveVersions = new Map<SessionId, PendingChange>();
  readonly #archiveNotifications = new Map<SessionId, () => void>();
  #pending: readonly PendingChange[] = [];

  constructor({
    client,
    sessions = connection,
    toasts = new ActionToasts(),
  }: {
    client: QueryClient;
    sessions?: () => Pick<Connection, "session">;
    toasts?: ActionToasts;
  }) {
    this.#client = client;
    this.#connection = sessions;
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
      if (pending.sessionId === session.id && projected !== null)
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

  restore(sessionId: SessionId): void {
    if (this.#find(sessionId)?.archived !== true) return;
    this.#archiveNotifications.get(sessionId)?.();
    this.#archiveVersions.delete(sessionId);
    void this.#run(this.#add(sessionId, { kind: "archive", archived: false }));
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
      findListedSession(sessionId) ??
      this.#client.getQueryData<SessionInfo | null>(keys.session(sessionId)) ??
      undefined;

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
    return this.#queues.run(pending.sessionId, async () => {
      try {
        const { sessionId, change } = pending;

        const session = this.#connection().session(sessionId);

        const outcome =
          change.kind === "delete"
            ? await session.remove()
            : await session.update(
                change.kind === "archive"
                  ? { archived: change.archived }
                  : change.kind === "pin"
                    ? { pinned: change.pinned }
                    : { name: change.name },
              );

        if (outcome.kind !== "updated" && outcome.kind !== "removed")
          throw new Error(`The host answered ${outcome.kind}`);
        this.#commit(pending);

        return true;
      } catch {
        const verb =
          pending.change.kind === "archive" && !pending.change.archived
            ? "restore"
            : pending.change.kind;

        toast.add({
          type: "error",
          title: `Couldn't ${verb} this chat. Try again.`,
          id: `session-action-error-${verb}`,
        });

        return false;
      } finally {
        this.#remove(pending);
      }
    });
  }

  #commit({ sessionId, change }: PendingChange): void {
    if (change.kind === "delete") {
      this.#client.removeQueries({ queryKey: keys.session(sessionId), exact: true });

      return;
    }

    this.#client.setQueryData<SessionInfo | null>(keys.session(sessionId), (session) =>
      session === undefined || session === null
        ? session
        : (applyChange(session, change) ?? session),
    );
  }
}
