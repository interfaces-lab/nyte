import { asId, isJson } from "@nyte-ai/schema";
import type {
  CredentialSource,
  HeadName,
  HostId,
  JournalEntry,
  Json,
  Message,
  PrincipalId,
  SessionId,
} from "@nyte-ai/schema";
import { SdkError, closable, dev } from "@nyte-ai/core";
import type { Connection, Head, Login, PluginFile, RequestJournal, Session } from "@nyte-ai/core";
import type { OperationOutput, Transport } from "@nyte-ai/protocol";
import { createFolds, watchHead, watchHost, withUnsent } from "./fold.ts";
import type { Folds } from "./fold.ts";
import { journalLoop } from "./journal.ts";
import type { JournalLoop } from "./journal.ts";
import { partHandle } from "./part.ts";
import { moveOutcome, receiptHandle, runHandle, sendReceipt } from "./receipts.ts";
import { createLink, createRows } from "./rows.ts";
import type { Rows } from "./rows.ts";
import { workspaceHandle } from "./workspace.ts";

/** Describes what a client is bound to once `connect` has authenticated: the host that answered, the principal it acts as, the credential to reconnect with, the journal its sends go through, and the entries that journal held at connect, resent in order. */
export type ClientContext = {
  readonly hostId: HostId;
  readonly principal: PrincipalId;
  readonly credential: CredentialSource;
  readonly journal: RequestJournal;
  readonly journaled: readonly JournalEntry[];
};

type Bound = {
  readonly rows: Rows;
  readonly journal: JournalLoop;
  readonly folds: Folds;
};

const MAIN = asId<"head">("main");

/**
 * Returns a connection over a transport: the handle tree, each handle bound synchronously with no I/O,
 * sends through the journal's retry loop (the journaled entries resent first, in order), watches
 * resumed across link loss and folded on the client. `close()` closes the link as `client`: every
 * request and stream ends, and a send still retrying rejects `unavailable` and keeps its journal row.
 */
export function createClient(transport: Transport, context: ClientContext): Connection {
  const link = createLink();
  const rows = createRows(transport, link);

  const bound: Bound = {
    rows,
    journal: journalLoop(rows, context.journal),
    folds: createFolds(rows, context.principal),
  };

  bound.journal.replay(context.journaled);

  const close = async (): Promise<void> => {
    link.close("client");
  };

  return {
    hostId: context.hostId,
    principal: context.principal,
    credential: context.credential,
    sessions: {
      watch: (input) => rows.watch("sessions.watch", input ?? {}),
      create: async (input) =>
        sessionHandle(bound, (await rows.call("sessions.create", input ?? {})).session),
      list: (input) => rows.call("sessions.list", input ?? {}),
    },
    workspaces: {
      list: () => rows.call("workspaces.list", {}),
      inspect: (target) => rows.call("workspaces.inspect", { target }),
      add: (target, options) => rows.call("workspaces.add", { target, options }),
      forget: (id) => rows.call("workspaces.forget", { id }),
    },
    session: (id) => sessionHandle(bound, id),
    workspace: (id) => workspaceHandle(rows, id),
    watch: () => watchHost(rows),
    blob: (id) => rows.bytes("connection.blob", { id }),
    models: {
      list: () => rows.call("models.list", {}),
      async refresh(provider) {
        await rows.call("models.refresh", { provider });
      },
      setDefault: (ref) => rows.call("models.setDefault", { ref }),
      verify: (provider) => rows.call("models.verify", { provider }),
      login: (input) => loginHandle(rows, input),
      async logout(provider) {
        await rows.call("models.logout", { provider });
      },
    },
    settings: { apply: (id, value) => rows.call("settings.apply", { id, value }) },
    plugins: {
      replace: (plugins, scope) => rows.call("plugins.replace", { plugins: files(plugins), scope }),
      check: (plugins) => rows.call("plugins.check", { plugins: files(plugins) }),
    },
    principals: {
      list: async () =>
        (await rows.call("principals.list", {})).map((view) => ({
          ...view,
          authority: new Set(view.authority),
        })),
      pair: (input) =>
        rows.call("principals.pair", { authority: [...input.authority], label: input.label }),
      async revoke(id) {
        await rows.call("principals.revoke", { id });
      },
    },
    close,
    [Symbol.asyncDispose]: close,
  };
}

/** Returns a handle on a session: its main head, plus heads, runs, receipts, parts and the `session.*` rows. Binds synchronously. */
function sessionHandle(bound: Bound, session: SessionId): Session {
  const { rows } = bound;

  return {
    ...headHandle(bound, session, MAIN),
    id: session,
    head: (name) => headHandle(bound, session, name),
    heads: {
      create: (name, input) => rows.call("heads.create", { session, name, input }),
      merge: (name, options) => rows.call("heads.merge", { session, name, options }),
      remove: (name, options) => rows.call("heads.remove", { session, name, options }),
    },
    run: (id) => runHandle(rows, session, id),
    receipt: (id) => receiptHandle(rows, session, id, (outcome): unknown => outcome),
    info: () => rows.call("session.info", { session }),
    update: (patch) => rows.call("session.update", { session, patch }),
    remove: () => rows.call("session.remove", { session }),
    stop: () => rows.call("session.stop", { session }),
    command: (name, args) => rows.call("session.command", { session, name, args }),
    parts: {
      async create(kind, input) {
        const { part } = await rows.call("parts.create", {
          session,
          kind: kind.kind,
          input: { ...input, state: jsonState(input.state) },
        });

        return partHandle(rows, session, part, kind);
      },
    },
    part: (id) => partHandle(rows, session, id, null),
  };
}

/**
 * Returns a handle on a head over the `head.*` rows, bound synchronously. `send` mints the receipt id
 * (or takes `options.id`) and journals the send, a `replace` included, as its own row; `view` and
 * `watch` merge this client's unsent sends, and `move` mints its wire-only id (§40o).
 */
function headHandle(bound: Bound, session: SessionId, head: HeadName): Head {
  const { rows, journal } = bound;

  return {
    sessionId: session,
    name: head,
    async send(content, options) {
      const { id, ...rest } = options ?? {};
      const receipt = id ?? asId<"receipt">(crypto.randomUUID());
      dev("sdk", "send", { session, head, receipt });

      const sent = await journal.send({
        id: receipt,
        session,
        head,
        content,
        options: rest,
        at: Date.now(),
      });

      return sendReceipt(rows, session, sent.receipt, sent.message);
    },
    configure: (patch) => rows.call("head.configure", { session, head, patch }),
    async view(options) {
      const view = await rows.call("head.view", { session, head, options });

      const known = (id: Message["id"]): boolean =>
        view.messages.some((message) => message.id === id);

      journal.landed(known);

      return withUnsent(view, journal.unsent(session, head), known);
    },
    watch: (options) => watchHead(bound.folds, journal, { session, head, options }),
    history: (input) => rows.call("head.history", { session, head, ...input }),
    tree: () => rows.call("head.tree", { session, head }),
    async move(position, options) {
      const { receipt } = await rows.call("head.move", {
        session,
        head,
        position,
        options,
        id: asId<"receipt">(crypto.randomUUID()),
      });

      return receiptHandle(rows, session, receipt, moveOutcome);
    },
    compact: (input) => rows.call("head.compact", { session, head, ...input }),
  };
}

/** Returns a login attempt: nothing happens until `steps()` is iterated, which starts the attempt with `models.login` and streams `login.steps`; dropping the iterator ends the attempt on the host. */
function loginHandle(rows: Rows, input: Parameters<Connection["models"]["login"]>[0]): Login {
  return {
    steps: () =>
      closable<OperationOutput<"login.steps">>(() => {
        let steps: AsyncIterator<OperationOutput<"login.steps">> | null = null;
        let closed = false;

        return {
          async pull() {
            if (steps === null) {
              await rows.call("models.login", input);

              if (closed) return { done: true, value: undefined };
              steps = rows
                .frames("login.steps", { provider: input.provider })
                [Symbol.asyncIterator]();
            }

            return steps.next();
          },
          close() {
            closed = true;
            void steps?.return?.();
          },
        };
      }),
    async answer(code) {
      await rows.call("login.answer", { provider: input.provider, code });
    },
  };
}

/** Returns a part's state as the JSON the wire carries; a state that is not JSON is invalid. */
function jsonState(state: unknown): Json {
  if (isJson(state)) return state;

  throw new SdkError("invalid", "A part's state must be JSON.");
}

/** Returns plugin files as the wire carries them: each one's path alone. */
function files(plugins: readonly PluginFile[]): readonly PluginFile[] {
  return plugins.map((plugin) => ({ path: plugin.path }));
}
