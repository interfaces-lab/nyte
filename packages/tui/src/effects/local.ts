import type { McpServerView, WorkspaceId } from "@nyte-ai/sdk";
import { availableModels, findModel, modelId } from "../lib/catalog.ts";
import { usageCard, usageLines } from "../lib/usage.ts";
import type { DialogData } from "../model/dialogs/dialog.ts";
import { mcpActionChoices, mcpDetailLines, mcpServerChoices } from "../model/mcp.ts";
import type { Choice } from "../model/dialogs/list.ts";
import type { ModelRow } from "../model/dialogs/model-picker.ts";
import { gitHubLines } from "../lib/pull-request.ts";
import type { Effect } from "../model/effect.ts";
import { followedSession } from "../model/state.ts";
import type { ShellJob } from "../model/state.ts";
import { describeUpdateOutcome, selfUpdate as selfUpdateBinary } from "../update.ts";
import type { HandlerContext, LocalHandlerContext } from "./scope.ts";

type Of<K extends Effect["kind"]> = Extract<Effect, { readonly kind: K }>;

export async function shellStart(
  effect: Of<"shell-start">,
  context: LocalHandlerContext,
): Promise<void> {
  const { dispatch, ports, scope } = context;

  const job: ShellJob = {
    id: effect.id,
    session: effect.session,
    command: effect.command,
    include: effect.include,
    startedAt: ports.clock.now(),
    output: "",
    state: { kind: "running" },
    delivered: false,
  };

  let latest = job;

  const publish = (next: ShellJob): void => {
    latest = next;
    dispatch({ kind: "shell-job", job: next });
  };

  publish(job);

  const done = ports.shell
    .start(effect.id, effect.command, effect.cwd, (output) => publish({ ...latest, output }))
    .then((end) => publish({ ...latest, state: end }))
    .finally(() => {
      scope.shells.delete(effect.id);
    });

  scope.shells.set(effect.id, { stop: () => ports.shell.stop(effect.id), done });
  await done;
}

export async function shellStop(
  effect: Of<"shell-stop">,
  context: LocalHandlerContext,
): Promise<void> {
  context.ports.shell.stop(effect.id);
}

export async function composer(
  effect: Of<"composer">,
  context: LocalHandlerContext,
): Promise<void> {
  const port = context.ports.composer.current();

  if (port === null) return;
  const { op } = effect;

  switch (op.kind) {
    case "set":
      port.set(op.draft);

      return;
    case "insert":
      port.insert(op.text, op.at);

      return;
    case "replace-range":
      port.replaceRange(op.from, op.to, op.text);

      return;
    case "clear":
      port.clear();

      return;
    case "focus":
      port.focus();

      return;
    case "cursor":
      port.cursor(op.to);

      return;
    default: {
      const _exhaustive: never = op;

      return _exhaustive;
    }
  }
}

export async function scroll(effect: Of<"scroll">, context: LocalHandlerContext): Promise<void> {
  const port = context.ports.scroll.current();

  if (port === null) return;
  const { op } = effect;

  switch (op.kind) {
    case "page":
      port.page(op.direction);

      return;
    case "latest":
      port.latest();

      return;
    case "row":
      port.row(op.key);

      return;
    case "keep-viewport":
      port.keepViewport();

      return;
    case "turn":
      port.turn(op.direction);

      return;
    default: {
      const _exhaustive: never = op;

      return _exhaustive;
    }
  }
}

export async function load(effect: Of<"load">, context: HandlerContext): Promise<void> {
  const { dispatch } = context;

  try {
    const data = await loaded(effect, context);
    dispatch({ kind: "loaded", dialog: effect.dialog, data });
  } catch (error) {
    dispatch({
      kind: "load-failed",
      dialog: effect.dialog,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loaded(effect: Of<"load">, context: HandlerContext): Promise<DialogData> {
  const { ports, read, scope } = context;
  const { request } = effect;

  switch (request.kind) {
    case "sessions":
      return { kind: "sessions", sessions: await Array.fromAsync(ports.host.rootSessions()) };
    case "accounts":
      return { kind: "accounts", accounts: await ports.host.accounts(request.provider) };
    case "tree": {
      const view = await ports.host.session(request.session).tree();

      if (view.tip.kind !== "commit") throw new Error("Nothing to move to yet");

      return { kind: "tree", tree: { view, tip: view.tip.id } };
    }

    case "models": {
      const catalog = await ports.host.listModels();
      const generation = (scope.catalogGeneration += 1);
      context.dispatch({ kind: "catalog", generation, catalog });
      const models = availableModels(catalog);

      const fastRefs = new Set(
        models.flatMap((model) => (model.fast === null ? [] : [modelId(model.fast)])),
      );

      const rows = models
        .filter((model) => !fastRefs.has(modelId(model.ref)))
        .map((model): ModelRow => ({
          ref: model.ref,
          info: model,
          fast: model.fast === null ? null : (findModel(models, model.fast) ?? null),
        }));

      const costCeiling = rows.reduce(
        (ceiling, row) => Math.max(ceiling, row.info.cost.input + row.info.cost.output),
        0,
      );

      return { kind: "models", models: { rows, costCeiling } };
    }

    case "usage": {
      const providers = await ports.host.usage();
      const state = read();
      const view = followedSession(state)?.view ?? null;

      if (view === null && state.facts.chat?.kind !== "blank") throw new Error("No chat is open");

      return {
        kind: "text",
        lines: usageLines(usageCard(view, providers)),
      };
    }

    case "directory": {
      const entries = await ports.files.listDirectory(request.path, read().facts.workspace.cwd);

      return {
        kind: "list",
        choices: {
          kind: "ready",
          items: entries.map((path): Choice => ({
            id: path,
            label: path,
            description: "",
            timing: null,
            status: null,
            mark: null,
          })),
        },
      };
    }

    case "plugins": {
      const rows = await ports.host.hostPlugins();

      const lines = [
        ...ports.plugins.ids.map((id) => `${id} client`),
        ...rows.map((plugin) => {
          const where = plugin.path === null ? plugin.source : `${plugin.source} ${plugin.path}`;
          const issues = plugin.issues.map((issue) => issue.message).join("; ");

          return issues === "" ? `${plugin.id} ${where}` : `${plugin.id} ${where}: ${issues}`;
        }),
      ];

      const commands = followedSession(read())?.view?.catalog.commands ?? [];

      if (commands.length > 0)
        lines.push(`Commands: ${commands.map((command) => `/${command.name}`).join(" ")}`);

      return { kind: "text", lines: lines.length === 0 ? ["No plugins"] : lines };
    }

    case "pull-request":
      return { kind: "text", lines: gitHubLines(await ports.host.github(request.workspace)) };

    case "mcp-servers":
      return {
        kind: "list",
        choices: {
          kind: "ready",
          items: mcpServerChoices(await ports.host.mcp(request.workspace)),
        },
      };

    case "mcp-server":
      return {
        kind: "list",
        choices: {
          kind: "ready",
          items: mcpActionChoices(await mcpServer(ports, request.workspace, request.server)),
        },
      };

    case "mcp-details":
      return {
        kind: "text",
        lines: mcpDetailLines(await mcpServer(ports, request.workspace, request.server)),
      };

    default: {
      const _exhaustive: never = request;

      return _exhaustive;
    }
  }
}

async function mcpServer(
  ports: HandlerContext["ports"],
  workspace: WorkspaceId,
  name: string,
): Promise<McpServerView> {
  const found = (await ports.host.mcp(workspace)).servers.find((server) => server.name === name);

  if (found === undefined) throw new Error(`No MCP server is named ${name}.`);

  return found;
}

export async function listDirectory(
  effect: Of<"list-directory">,
  context: LocalHandlerContext,
): Promise<void> {
  const entries = await context.ports.files.listDirectory(effect.path, effect.cwd);
  context.dispatch({ kind: "directory-listed", path: effect.path, entries });
}

export async function resolveMention(
  effect: Of<"resolve-mention">,
  context: LocalHandlerContext,
): Promise<void> {
  const file = await context.ports.files.resolveMention(effect.query, effect.cwd);
  context.dispatch({ kind: "mention-resolved", query: effect.query, cwd: effect.cwd, file });
}

export async function readPreview(
  effect: Of<"read-preview">,
  context: LocalHandlerContext,
): Promise<void> {
  const body = await context.ports.files.readText(effect.path);
  context.dispatch({ kind: "preview-loaded", marker: effect.marker, path: effect.path, body });
}

export async function resolvePaste(
  effect: Of<"resolve-paste">,
  context: LocalHandlerContext,
): Promise<void> {
  const { dispatch, ports, scope } = context;

  const work = ports.files
    .resolvePaste(effect.text, effect.bytes, effect.cwd)
    .then((insert) => dispatch({ kind: "paste-resolved", generation: effect.generation, insert }))
    .finally(() => {
      scope.pastes.delete(work);
    });

  scope.pastes.add(work);
  await work;
}

export async function readClipboard(
  effect: Of<"read-clipboard">,
  context: LocalHandlerContext,
): Promise<void> {
  const { dispatch, ports, read } = context;
  const content = await ports.terminal.readClipboard();

  if (content.kind === "empty") {
    dispatch({
      kind: "paste-resolved",
      generation: effect.generation,
      insert: {
        kind: "refused",
        reason: "Clipboard has no supported text or image. Use your terminal's paste shortcut.",
      },
    });

    return;
  }

  await resolvePaste(
    {
      kind: "resolve-paste",
      generation: effect.generation,
      text: content.kind === "text" ? content.text : "",
      bytes: content.kind === "image" ? content.bytes : null,
      cwd: read().facts.workspace.cwd,
    },
    context,
  );
}

export async function readDialogClipboard(
  effect: Of<"read-dialog-clipboard">,
  context: LocalHandlerContext,
): Promise<void> {
  const content = await context.ports.terminal.readClipboard();
  context.dispatch({
    kind: "dialog-pasted",
    dialog: effect.dialog,
    promptVersion: effect.promptVersion,
    text: content.kind === "text" ? content.text : null,
  });
}

export async function copy(effect: Of<"copy">, context: LocalHandlerContext): Promise<void> {
  context.ports.terminal.copy(effect.text);
}

export async function openEditor(
  effect: Of<"open-editor">,
  context: LocalHandlerContext,
): Promise<void> {
  const { dispatch, ports } = context;

  try {
    const text = await ports.terminal.suspended(() =>
      ports.files.editor(effect.text, effect.command),
    );

    dispatch({ kind: "editor-closed", text });
  } catch (error) {
    dispatch({ kind: "editor-closed", text: null });
    throw error;
  } finally {
    dispatch({ kind: "op-finished", op: "editor", notice: null });
  }
}

export async function openExternal(
  effect: Of<"open-external">,
  context: LocalHandlerContext,
): Promise<void> {
  context.ports.terminal.open(effect.target);
}

export async function writeSettings(
  effect: Of<"write-settings">,
  context: LocalHandlerContext,
): Promise<void> {
  const settings = await context.ports.settings.write(
    context.read().facts.workspace.cwd,
    effect.patch,
  );

  context.dispatch({ kind: "settings", settings });
}

export async function selfUpdate(
  effect: Of<"self-update">,
  context: LocalHandlerContext,
): Promise<void> {
  const outcome = await selfUpdateBinary({
    ...(effect.version === null ? {} : { version: effect.version }),
    report: (event) => {
      if (event.kind === "downloading")
        context.dispatch({ kind: "inform", tone: "info", text: `Downloading ${event.asset}…` });
      else if (event.kind === "verified")
        context.dispatch({ kind: "inform", tone: "info", text: "Checksum verified." });
    },
  });

  context.dispatch({
    kind: "inform",
    tone:
      outcome.kind === "updated" || outcome.kind === "current"
        ? "info"
        : outcome.kind === "unsupported"
          ? "warning"
          : "error",
    text: describeUpdateOutcome(outcome),
  });
}

export async function notify(effect: Of<"notify">, context: LocalHandlerContext): Promise<void> {
  context.ports.terminal.notify(effect.title, effect.body, false);
}

export async function exit(effect: Of<"exit">, context: LocalHandlerContext): Promise<void> {
  context.scope.exit.resolve({ code: effect.code });
}
