import { asId, isJson, SdkError } from "@nyte-ai/schema";
import type {
  CredentialSource,
  HeadName,
  HostId,
  JournalEntry,
  Json,
  PrincipalId,
  SessionId,
} from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { Connection, Head, PluginFile, RequestJournal, Session } from "@nyte-ai/core";
import type { Transport } from "@nyte-ai/protocol";
import { createHeadViews, watchHead, watchHost, withUnsent } from "./watch.ts";
import type { HeadViews } from "./watch.ts";
import { journalLoop } from "./journal.ts";
import type { JournalLoop } from "./journal.ts";
import { partHandle } from "./part.ts";
import { moveOutcome, receiptHandle, runHandle, sendReceipt } from "./receipts.ts";
import { createLink, createRows } from "./rows.ts";
import type { Rows } from "./rows.ts";
import { loginHandle } from "./login.ts";
import { workspaceHandle } from "./workspace.ts";

type ClientContext = {
  readonly hostId: HostId;
  readonly principal: PrincipalId;
  readonly credential: CredentialSource;
  readonly journal: RequestJournal;
  readonly journaled: readonly JournalEntry[];
};

type Bound = {
  readonly rows: Rows;
  readonly journal: JournalLoop;
  readonly views: HeadViews;
};

const MAIN = asId<"head">("main");

export function createClient(transport: Transport, context: ClientContext): Connection {
  const link = createLink();
  const rows = createRows(transport, link);

  const bound: Bound = {
    rows,
    journal: journalLoop(rows, context.journal),
    views: createHeadViews(rows),
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
      accounts: (provider) => rows.call("models.accounts", { provider }),
      async selectAccount(provider, account) {
        await rows.call("models.selectAccount", { provider, account });
      },
      usage: () => rows.call("models.usage", {}),
      async refresh(provider) {
        await rows.call("models.refresh", { provider });
      },
      setDefault: (ref) => rows.call("models.setDefault", { ref }),
      verify: (provider) => rows.call("models.verify", { provider }),
      login: (input) =>
        loginHandle(
          rows,
          async () => {
            await rows.call("models.login", input);

            return input.provider;
          },
          input.provider,
        ),
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
      journal.landed(session, head, view);
      const ids = new Set(view.messages.map((message) => message.id));

      return withUnsent(view, journal.unsent(session, head), (id) => ids.has(id));
    },
    watch: (options) => watchHead(bound.views, journal, { session, head, options }),
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

function jsonState(state: unknown): Json {
  if (isJson(state)) return state;

  throw new SdkError("invalid", "A part's state must be JSON.");
}

function files(plugins: readonly PluginFile[]): readonly PluginFile[] {
  return plugins.map((plugin) => ({ path: plugin.path }));
}
