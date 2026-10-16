import { homedir } from "node:os";
import { mountClientPlugins } from "@nyte-ai/plugin/client/mount";
import { asId } from "@nyte-ai/schema";
import { pagedViews } from "@nyte-ai/sdk/client";
import type { Connection, MessageId, PagedViews, Session } from "@nyte-ai/sdk";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import type { Task } from "../lib/tasks.ts";
import { follow } from "../lib/view-helpers.ts";
import { addFolder, rootSessions, tuiPlugins } from "../run.ts";
import { loginProvider, logoutProvider, runLogin } from "../services/auth.ts";
import { TaskIndex } from "../services/task-index.ts";
import type { HostPort, PluginsPort, SessionPort } from "./ports.ts";

export function hostPort(host: Connection, folder: string | null): HostPort {
  return {
    session: (id) => sessionPort(host, host.session(id)),
    async create(input) {
      const workspace = input.workspace ?? (folder === null ? null : await addFolder(host, folder));
      const session = await host.sessions.create({
        ...(workspace === null ? {} : { workspace }),
        ...(input.selection === null
          ? {}
          : { configuration: { model: input.selection.model, thinking: input.selection.effort } }),
      });

      return session.id;
    },
    rootSessions: () => rootSessions(host),
    catalog: () => host.watch(),
    sessionInfos: () => host.sessions.watch({ parents: { kind: "all" } }),
    listModels: () => host.models.list(),
    accounts: (provider) => host.models.accounts(provider ?? undefined),
    selectAccount: (provider, account) => host.models.selectAccount(provider, account),
    usage: () => host.models.usage(),
    refreshModels: (provider) => host.models.refresh(provider),
    async setDefaultModel(ref) {
      await host.models.setDefault(ref);
    },
    async login(provider, driver) {
      const found = await loginProvider({
        connection: host,
        driver,
        ...(provider === null ? {} : { providerId: provider }),
      });

      return { provider: found.id, name: found.name };
    },
    async logout(provider, driver) {
      const { provider: found } = await logoutProvider({
        connection: host,
        driver,
        ...(provider === null ? {} : { providerId: provider }),
      });

      return { provider: found.id, name: found.name };
    },
    async hostPlugins() {
      for await (const view of host.watch()) return view.plugins;

      return [];
    },
    async trustInfo(workspace) {
      const info = await host.workspace(workspace).info();
      const inspected = await host.workspaces.inspect(info.target).catch(() => null);

      const path = "path" in info.target ? info.target.path : info.id;

      return {
        path,
        home: path.replace(/\/+$/u, "") === homedir().replace(/\/+$/u, ""),
        decision: info.projectResources,
        trusted: info.trusted,
        sources: inspected?.projectSources ?? info.projectSources,
      };
    },
    async trust(workspace, value) {
      const outcome = await host.workspace(workspace).update({ projectResources: value });

      if (outcome.kind === "missing") throw new Error("This folder is no longer registered.");
    },
    async mcp(workspace) {
      for await (const view of host.workspace(workspace).mcp.watch()) return view;

      throw new Error("The MCP view ended.");
    },
    mcpAction(workspace, server, action) {
      const mcp = host.workspace(workspace).mcp;

      switch (action) {
        case "reconnect":
          return mcp.reconnect(server);
        case "enable":
        case "disable":
          return mcp.setEnabled(server, action === "enable");
        case "logout":
          return mcp.logout(server);
        default: {
          const _exhaustive: never = action;

          return _exhaustive;
        }
      }
    },
    mcpLogin: (workspace, server, driver) =>
      runLogin(host.workspace(workspace).mcp.login(server), driver, server),
    applySetting: (id, value) => host.settings.apply(id, value),
    tasks(session) {
      return {
        [Symbol.asyncIterator]() {
          let latest: readonly Task[] | null = null;
          let failure: { readonly error: unknown } | null = null;
          let waiting: (() => void) | null = null;
          let index: TaskIndex | null = null;
          let closed = false;
          let opening: Promise<void> | null = null;

          const wake = (): void => {
            const resume = waiting;
            waiting = null;
            resume?.();
          };

          return {
            async next(): Promise<IteratorResult<readonly Task[]>> {
              if (closed) return { done: true, value: undefined };
              opening ??= host
                .session(session)
                .info()
                .then((info) => {
                  if (closed) return;

                  const opened = new TaskIndex(info, {
                    connection: host,
                    jobs: host.workspace(info.workspace).jobs.watch(),
                    onChange() {
                      latest = opened.tasks;
                      wake();
                    },
                    onError(error) {
                      failure = { error };
                      wake();
                    },
                  });

                  index = opened;
                });
              await opening;

              for (;;) {
                if (closed) return { done: true, value: undefined };

                if (failure !== null) throw failure.error;

                if (latest !== null) {
                  const value = latest;

                  latest = null;

                  return { done: false, value };
                }

                await new Promise<void>((resolve) => {
                  waiting = resolve;
                });
              }
            },
            async return(): Promise<IteratorResult<readonly Task[]>> {
              closed = true;
              index?.close();
              latest = null;
              failure = null;
              wake();

              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    async *blob(id) {
      const reader = await host.blob(asId(id));
      yield* reader.chunks();
    },
  };
}

function sessionPort(host: Connection, session: Session): SessionPort {
  const readReceipt = (message: MessageId) => session.receipt(asId(message));
  let views: PagedViews | null = null;

  return {
    id: session.id,
    watch: () => (views = pagedViews(session)),
    earlier: (limit) => views?.earlier(limit) ?? Promise.resolve(0),
    info: () => session.info(),
    async workspace() {
      const info = await session.info();
      const workspace = await host.workspace(info.workspace).info();

      return {
        id: info.workspace,
        cwd:
          workspace.target.kind === "local" && "path" in workspace.target
            ? workspace.target.path
            : null,
      };
    },
    async send(content, options) {
      const receipt = await session.send(content, options);

      return { message: receipt.message };
    },
    async withdraw(message) {
      const receipt = readReceipt(message);
      const before = await receipt.status();

      if (before.kind === "missing") return "gone";

      if (before.kind === "settled")
        return reportsWithdrawn(before.outcome) ? "gone" : "landed-first";
      const stopped = await receipt.stop();

      if (stopped.kind === "missing") return "gone";

      if (stopped.kind === "settled")
        return reportsWithdrawn(stopped.outcome) ? "withdrawn" : "landed-first";
      const after = await receipt.status();

      return after.kind === "settled" && reportsWithdrawn(after.outcome)
        ? "withdrawn"
        : "landed-first";
    },
    async revise(message, content, options) {
      const status = await readReceipt(message).status();

      if (status.kind === "missing") return "gone";

      if (status.kind === "settled")
        return reportsWithdrawn(status.outcome) ? "gone" : "landed-first";
      await session.send(content, { ...options, replace: message });

      return "revised";
    },
    async stopRun(run) {
      const outcome = await session.run(run).stop();

      return outcome.kind === "missing" ? "missing" : "stopped";
    },
    async answer(part, answers) {
      const outcome = await session.part(part).act("answer", { answers });

      return outcome.kind === "ok";
    },
    async move(position, options) {
      const receipt = await session.move(position, options);

      return receipt.settled();
    },
    tree: () => session.tree(),
    async compact(instructions) {
      const outcome = await session.compact(instructions === null ? undefined : { instructions });

      return outcome.kind === "nothing-to-compact" ? "nothing" : outcome.kind;
    },
    configure: (patch) =>
      session.configure({
        ...(patch.model === undefined ? {} : { model: patch.model }),
        ...(patch.effort === undefined ? {} : { thinking: patch.effort }),
      }),
    applySetting: (id, value) => session.configure({ settings: { [id]: value } }),
    command: (name, argument) => session.command(name, argument === null ? undefined : argument),
    async stopTask(task) {
      if (task.kind === "agent") {
        const stopped = await host.session(task.session).stop();

        return stopped.stopped.length > 0 || stopped.withdrawn.length > 0 ? "stopped" : "missing";
      }

      const info = await session.info();
      const outcome = await host.workspace(info.workspace).job(asId(task.job)).stop();

      return outcome.kind === "missing" ? "missing" : "stopped";
    },
    async changeDirectory(path) {
      const seen = await host.workspaces.inspect({ kind: "local", path });

      const added = await host.workspaces.add(seen.target, {
        expect: { identity: seen.identity },
      });

      if (added.kind === "stale")
        return { kind: "refused", reason: `${path} changed while it was opened; try again.` };

      if (added.kind === "unavailable")
        return { kind: "refused", reason: `Couldn't open ${path}: ${added.reason}` };
      const outcome = await session.update({ workspace: added.workspace });

      if (outcome.kind === "busy")
        return {
          kind: "refused",
          reason: "Wait for active runs and jobs to finish before changing directories.",
        };

      if (outcome.kind !== "updated")
        return { kind: "refused", reason: `Couldn't open ${path} for this session.` };

      return { kind: "changed", cwd: path };
    },
    async reload() {
      const info = await session.info();
      const outcome = await host.workspace(info.workspace).reload();

      return outcome.kind;
    },
    async upload(bytes) {
      const files = await host.workspace((await session.info()).workspace).files();

      if (files.kind !== "available") throw new Error(`Can't attach images here: ${files.reason}`);

      return files.api.upload(
        (async function* () {
          yield bytes;
        })(),
      );
    },
    async mentions(signal) {
      const files = await host.workspace((await session.info()).workspace).files();

      if (files.kind !== "available") return [];
      const found: string[] = [];

      for await (const frame of files.api.scan({ ignored: "exclude" })) {
        if (signal.aborted) return found;

        if (frame.kind !== "entries") continue;

        for (const entry of frame.entries) {
          if (entry.kind === "symlink") continue;
          found.push(entry.kind === "directory" ? `${entry.path}/` : entry.path);
        }
      }

      return found;
    },
  };
}

export async function pluginsPort(
  host: Connection,
  options: {
    readonly notify: (title: string, body: string, sound: boolean) => void;
    readonly report: (plugin: string, message: string) => void;
  },
): Promise<
  PluginsPort & {
    readonly draw: (message: PartMessage) => unknown;
    readonly dispose: () => Promise<void>;
  }
> {
  let current: Session | null = null;

  const plugins = await mountClientPlugins({
    connection: host,
    plugins: tuiPlugins(),
    client: { name: "tui", frameworks: ["tui"] },
    session: () => current,
    notify: (input) => options.notify(input.title ?? "Nyte", input.message, input.sound === true),
    report: options.report,
  });

  const stopDirectory = follow(
    host.sessions.watch({ parents: { kind: "all" } }),
    (sessions) => plugins.sessionsChanged(sessions),
    (cause) =>
      options.report("notifications", cause instanceof Error ? cause.message : String(cause)),
  );

  return {
    draw: (message) =>
      current === null
        ? undefined
        : plugins.draw(current, message, { kind: "transcript", role: message.role }),
    ids: plugins.ids,
    dispose: async () => {
      stopDirectory();
      await plugins.dispose();
    },
    async switched(previous, next) {
      const opened = host.session(next);
      current = opened;
      await plugins.switched(previous === null ? null : host.session(previous), opened);
    },
    async beforeSubmit(draft) {
      const decision = await plugins.beforeSubmit(draft);

      switch (decision.action) {
        case "continue":
          return { kind: "accept", draft };
        case "modify":
          return { kind: "accept", draft: decision.value };
        case "reject":
          return { kind: "reject", reason: decision.reason };
        case "error":
          return { kind: "reject", reason: decision.message };
        default: {
          const _exhaustive: never = decision;

          return _exhaustive;
        }
      }
    },
  };
}

function reportsWithdrawn(outcome: unknown): boolean {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    "kind" in outcome &&
    outcome.kind === "withdrawn"
  );
}
