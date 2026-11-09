import { asId, isJson, SdkError } from "@nyte-ai/schema";
import type {
  CommitId,
  CredentialSource,
  HeadName,
  HostId,
  JournalEntry,
  Json,
  PrincipalId,
  SessionId,
} from "@nyte-ai/schema";
import { dev, followTrace, holdMessage, traced } from "@nyte-ai/core/client";
import type { Connection, Head, PluginFile, RequestJournal, Session } from "@nyte-ai/core";
import type { Transport } from "@nyte-ai/protocol";
import { watchHost, withUnsent } from "./watch.ts";
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
  readonly hostFrames?: AsyncIterator<Json>;
};

type Bound = {
  readonly rows: Rows;
  readonly journal: JournalLoop;
  readonly seen: Map<string, CommitId>;
};

const MAIN = asId<"head">("main");

export const journals = new WeakMap<Connection, JournalLoop>();

export function createClient(transport: Transport, context: ClientContext): Connection {
  const link = createLink();
  const rows = createRows(transport, link);

  const bound: Bound = {
    rows,
    journal: journalLoop(rows, context.journal),
    seen: new Map(),
  };

  bound.journal.replay(context.journaled);
  let hostFrames = context.hostFrames;

  link.signal.addEventListener("abort", () => void hostFrames?.return?.(), { once: true });

  const close = async (): Promise<void> => {
    link.close("client");
  };

  const connection: Connection = {
    hostId: context.hostId,
    principal: context.principal,
    credential: context.credential,
    sessions: {
      async start(input) {
        const id = input.id ?? asId<"session">(crypto.randomUUID());
        followTrace(id, id);

        const started = await traced("sdk.send", id, { session: id }, () =>
          rows.wait("sessions.start", { ...input, id }),
        );

        return {
          session: sessionHandle(bound, started.session),
          receipt: sendReceipt(rows, started.session, started.receipt, started.message),
        };
      },
      list: (input) => rows.call("sessions.list", input ?? {}),
      read: (input) => rows.call("sessions.read", input ?? {}),
    },
    workspaces: {
      list: () => rows.call("workspaces.list", {}),
      inspect: (target) => rows.call("workspaces.inspect", { target }),
      add: (target, options) => rows.call("workspaces.add", { target, options }),
      forget: (id) => rows.call("workspaces.forget", { id }),
      cleanWorktrees: () => rows.call("workspaces.cleanWorktrees", {}),
    },
    projects: {
      create: (input) => rows.call("projects.create", { input }),
      draft: (input) => rows.call("projects.draft", { input }),
    },
    session: (id) => sessionHandle(bound, id),
    workspace: (id) => workspaceHandle(rows, id),
    project: (id) => ({
      id,
      update: (patch) => rows.call("project.update", { project: id, patch }),
    }),
    watch: () => {
      const opened = hostFrames;
      hostFrames = undefined;

      return watchHost(rows, opened);
    },
    blob: (id) => rows.bytes("connection.blob", { id }),
    documents: {
      read: (path, options) => rows.call("documents.read", { path, options }),
      bytes: (path) => rows.bytes("documents.bytes", { path }),
      write: (path, contents, options) =>
        rows.upload(
          "documents.write",
          { path, options },
          typeof contents === "string" ? new TextEncoder().encode(contents) : contents,
        ),
      watch: (paths) => rows.watch("documents.watch", { paths }),
    },
    catalogs: { read: (id) => rows.call("catalogs.read", { id }) },
    models: {
      list: () => rows.call("models.list", {}),
      accounts: (provider) => rows.call("models.accounts", { provider }),
      async selectAccount(provider, account) {
        await rows.call("models.selectAccount", { provider, account });
      },
      async renameAccount(provider, account, label) {
        await rows.call("models.renameAccount", { provider, account, label });
      },
      usage: () => rows.call("models.usage", {}),
      async refresh(provider) {
        await rows.call("models.refresh", { provider });
      },
      setDefault: (ref) => rows.call("models.setDefault", { ref }),
      setListing: (refs, listing) => rows.call("models.setListing", { refs, listing }),
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
    github: {
      account: () => rows.call("github.account", {}),
      signIn: () => rows.call("github.signIn", {}),
      signOut: () => rows.call("github.signOut", {}),
    },
    plugins: {
      replace: (plugins, scope) => rows.call("plugins.replace", { plugins: files(plugins), scope }),
      check: (plugins) => rows.call("plugins.check", { plugins: files(plugins) }),
    },
    operations: {
      describe: (names) => rows.call("operations.describe", names === undefined ? {} : { names }),
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

  journals.set(connection, bound.journal);

  return connection;
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
    fork: (input) => rows.call("session.fork", { session, ...input }),
    stop: () => rows.call("session.stop", { session }),
    command: (name, text) => rows.call("session.command", { session, name, text }),
    completeCommand: (name, prefix) =>
      rows.call("session.completeCommand", { session, name, prefix }),
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

  const revise: Head["revise"] = (message, content, options) =>
    rows.call("head.revise", { session, head, message, content, options });

  return {
    sessionId: session,
    name: head,
    async send(content, options) {
      const { id, ...rest } = options ?? {};
      const receipt = id ?? asId<"receipt">(crypto.randomUUID());
      dev("sdk", "send", { session, head, receipt });
      followTrace(session, receipt);

      const sent = await traced("sdk.send", receipt, { session }, () =>
        journal.send({
          id: receipt,
          session,
          head,
          content,
          options: rest,
          at: Date.now(),
        }),
      );

      return sendReceipt(rows, session, sent.receipt, sent.message);
    },
    revise,
    hold: (message) =>
      holdMessage(message, {
        hold: () => rows.call("head.hold", { session, head, message }),
        revise: (content, options) => revise(message, content, options),
        async release() {
          await rows.call("head.release", { session, head, message });
        },
      }),
    configure: (patch) => rows.call("head.configure", { session, head, patch }),
    async view(options) {
      const view = await rows.call("head.view", { session, head, options });
      journal.landed(session, head, view, view.seq);

      return withUnsent(view, journal.unsent(session, head));
    },
    async see(commit) {
      const key = JSON.stringify([session, head]);

      if (bound.seen.get(key) === commit) return;
      await rows.call("head.see", { session, head, commit });
      bound.seen.set(key, commit);
    },
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
