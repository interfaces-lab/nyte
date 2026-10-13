/**
 * The SDK adapter: `Host` in, `HostPort` out. The only module that imports
 * SDK values, builds receipt ids from message ids, and reads wire outcomes.
 */
import { asId } from "@nyte-ai/schema";
import type { Cursor, Host, MessageId, Session, SessionInfo } from "@nyte-ai/sdk";
import type { Task } from "../lib/tasks.ts";
import { tuiPlugins } from "../run.ts";
import { loginProvider, logoutProvider } from "../services/auth.ts";
import { mountClientPlugins } from "../services/plugins.ts";
import type { ClientPlugins } from "../services/plugins.ts";
import { TaskIndex } from "../services/task-index.ts";
import type { HostPort, PluginsPort, SessionPort } from "./ports.ts";

type TuiHost = Omit<Host, "listen">;

export function hostPort(host: TuiHost): HostPort {
  return {
    session: (id) => sessionPort(host, host.session(id)),
    async create(input) {
      const session = await host.sessions.create({
        ...(input.workspace === null ? {} : { workspace: input.workspace }),
        ...(input.selection === null
          ? {}
          : { configuration: { model: input.selection.model, thinking: input.selection.effort } }),
      });

      return session.id;
    },
    async rootSessions() {
      const sessions: SessionInfo[] = [];
      let cursor: Cursor | null = null;

      do {
        const page = await host.sessions.list(
          cursor === null ? { parents: { kind: "roots" } } : { parents: { kind: "roots" }, cursor },
        );

        sessions.push(...page.items);
        cursor = page.next;
      } while (cursor !== null);

      return sessions.toSorted((left, right) => right.lastActivityAt - left.lastActivityAt);
    },
    async *catalog() {
      let seen: string | null = null;
      let generation = 0;

      for await (const view of host.watch()) {
        if (view.catalog === seen) continue;
        seen = view.catalog;
        generation += 1;
        yield { generation, list: () => host.models.list() };
      }
    },
    listModels: () => host.models.list(),
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
    applySetting: (id, value) => host.settings.apply(id, value),
    async *tasks(session) {
      const info = await host.session(session).info();
      const updates = latestOf<readonly Task[]>();

      const index = new TaskIndex(info, {
        connection: host,
        onChange: () => updates.push(index.tasks),
        onError: (error) => updates.fail(error),
      });

      try {
        yield* updates;
      } finally {
        index.close();
      }
    },
    async *blob(id) {
      const reader = await host.blob(asId(id));
      yield* reader.chunks();
    },
  };
}

function sessionPort(host: TuiHost, session: Session): SessionPort {
  const receiptOf = (message: MessageId) => session.receipt(asId(message));

  return {
    id: session.id,
    watch: () => session.watch(),
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
      const receipt = receiptOf(message);
      const before = await receipt.status();

      if (before.kind === "missing") return "gone";

      if (before.kind === "settled") return isWithdrawn(before.outcome) ? "gone" : "landed-first";
      const stopped = await receipt.stop();

      if (stopped.kind === "missing") return "gone";

      if (stopped.kind === "settled")
        return isWithdrawn(stopped.outcome) ? "withdrawn" : "landed-first";
      // `requested` is a withdrawal or a stop of the run the message joined: the receipt tells which.
      const after = await receipt.status();

      return after.kind === "settled" && isWithdrawn(after.outcome) ? "withdrawn" : "landed-first";
    },
    async revise(message, content, options) {
      const status = await receiptOf(message).status();

      if (status.kind === "missing") return "gone";

      if (status.kind === "settled") return isWithdrawn(status.outcome) ? "gone" : "landed-first";
      await session.send(content, { ...options, replace: message });

      return "revised";
    },
    async stopRun(run) {
      const outcome = await session.run(run).stop();

      return outcome.kind === "missing" ? "missing" : "stopped";
    },
    async answer(part, choice) {
      const outcome = await session.part(part).act("answer", { choice });

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

/** The client plugins mounted over the host; `beforeSubmit`, `switched` and `ids` are the port, `draw`/`dispose` the kit's. */
export async function pluginsPort(
  host: TuiHost,
  options: {
    readonly notify: (title: string, body: string, sound: boolean) => void;
    readonly report: (plugin: string, message: string) => void;
  },
): Promise<PluginsPort & Pick<ClientPlugins, "draw" | "dispose">> {
  let current: Session | null = null;

  const plugins = await mountClientPlugins({
    connection: host,
    plugins: tuiPlugins(),
    session: () => current,
    notify: (input) => options.notify(input.title ?? "Nyte", input.message, input.sound === true),
    report: options.report,
  });

  return {
    draw: (message) => plugins.draw(message),
    ids: plugins.ids,
    dispose: () => plugins.dispose(),
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

function isWithdrawn(outcome: unknown): boolean {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    "kind" in outcome &&
    outcome.kind === "withdrawn"
  );
}

/** An async iterable of the newest value pushed since the last read; a pushed error ends it. */
function latestOf<T>(): AsyncIterable<T> & { push(value: T): void; fail(error: unknown): void } {
  let latest: { readonly value: T } | null = null;
  let failure: { readonly error: unknown } | null = null;
  let waiting: (() => void) | null = null;

  const wake = (): void => {
    const resume = waiting;
    waiting = null;
    resume?.();
  };

  return {
    push(value) {
      latest = { value };
      wake();
    },
    fail(error) {
      failure = { error };
      wake();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (failure !== null) throw failure.error;

        if (latest !== null) {
          const { value } = latest;
          latest = null;
          yield value;
          continue;
        }

        await new Promise<void>((resolve) => {
          waiting = resolve;
        });
      }
    },
  };
}
