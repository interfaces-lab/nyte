/**
 * Startup as facts: paint first, then settings, host, models, target
 * session. Each step is a `phase` fact, so the loading line, the "Still
 * starting. Your draft is saved here." refusal and Ctrl+C all come from the
 * table, not from a temporary key listener.
 */
import type { ModelCatalogView, SessionId, Thinking } from "@nyte-ai/sdk";
import { availableModels } from "../lib/catalog.ts";
import type { Selection } from "../model/state.ts";
import { describeUpdateOutcome, selfUpdate } from "../update.ts";
import { checkForUpdate } from "../version.ts";
import { configure } from "./commands.ts";
import type { HandlerContext } from "./runner.ts";
import { fallbackSelection, follow, watchHost } from "./session.ts";

export interface BootOptions {
  readonly home: string;
  readonly cwd: string;
  readonly target:
    | { readonly kind: "new" }
    | { readonly kind: "latest" }
    | { readonly kind: "session"; readonly id: SessionId };
  /** `--model`: `provider/id`, or a bare id looked up across signed-in providers. */
  readonly model: string | null;
  readonly effort: Thinking | null;
}

export async function boot(options: BootOptions, context: HandlerContext): Promise<void> {
  const { dispatch, ports, scope } = context;
  dispatch({ kind: "phase", phase: { kind: "starting", step: "workspace" } });
  await ports.terminal.painted();

  if (context.signal.aborted) return;
  dispatch({ kind: "phase", phase: { kind: "starting", step: "settings" } });
  const settings = await ports.settings.read(options.cwd);
  dispatch({ kind: "settings", settings });

  if (context.signal.aborted) return;
  dispatch({ kind: "phase", phase: { kind: "starting", step: "providers" } });
  const catalog = await ports.host.listModels();
  dispatch({ kind: "catalog", generation: (scope.catalogGeneration += 1), catalog });

  if (context.signal.aborted) return;
  const flagged = flagSelection(options, catalog);
  const selection = flagged ?? fallbackSelection(catalog, options.effort ?? "medium");

  if (selection === null) {
    scope.exit.resolve({ code: 1 });

    throw new Error(
      "No models are available. Check your connection, then run `nyte update --models`.",
    );
  }

  const watching: Promise<void> = watchHost(context)
    .catch((error: unknown) => {
      ports.log.write("watch", error);
    })
    .finally(() => scope.watches.delete(watching));

  scope.watches.add(watching);
  const target = await resolveTarget(options, selection, flagged !== null, context);

  if (context.signal.aborted) return;
  dispatch({ kind: "phase", phase: { kind: "ready" } });
  await follow(target.id, false, context);

  if (target.resumed && flagged !== null) {
    await configure(
      {
        kind: "configure",
        session: target.id,
        selection: {
          ...(options.model === null ? {} : { model: flagged.model, fast: flagged.fast }),
          ...(options.effort === null ? {} : { effort: flagged.effort }),
        },
      },
      context,
    );
  }

  if (availableModels(catalog).length === 0)
    dispatch({
      kind: "inform",
      tone: "warning",
      text: "Not signed in. /login connects a provider.",
    });

  await checkUpdate(settings.autoUpdate, context);
}

async function resolveTarget(
  options: BootOptions,
  selection: Selection,
  flagged: boolean,
  context: HandlerContext,
): Promise<{ readonly id: SessionId; readonly resumed: boolean }> {
  const { host } = context.ports;

  const create = async (): Promise<SessionId> =>
    host.create({ workspace: null, selection: flagged ? selection : null });

  switch (options.target.kind) {
    case "new":
      return { id: await create(), resumed: false };
    case "latest": {
      const used = (await host.rootSessions()).find((info) =>
        info.heads.some((head) => head.tip.kind !== "start"),
      );

      return used === undefined
        ? { id: await create(), resumed: false }
        : { id: used.id, resumed: true };
    }

    case "session":
      return { id: options.target.id, resumed: true };
    default: {
      const _exhaustive: never = options.target;

      return _exhaustive;
    }
  }
}

/** The selection `--model` and `--effort` ask for, or null when neither is given; an unknown bare id throws. */
export function flagSelection(
  options: Pick<BootOptions, "model" | "effort">,
  catalog: ModelCatalogView,
): Selection | null {
  if (options.model === null && options.effort === null) return null;
  const effort = options.effort ?? "medium";

  if (options.model === null) return fallbackSelection(catalog, effort);
  const slash = options.model.indexOf("/");

  if (slash !== -1) {
    const model = { provider: options.model.slice(0, slash), id: options.model.slice(slash + 1) };

    return { model, effort, fast: false };
  }

  const found = availableModels(catalog).find((model) => model.ref.id === options.model);

  if (found === undefined) throw new Error(`Unavailable model: ${options.model}`);

  return { model: found.ref, effort, fast: false };
}

async function checkUpdate(autoUpdate: boolean, context: HandlerContext): Promise<void> {
  const release = await checkForUpdate();

  if (release === undefined || context.signal.aborted) return;

  if (!autoUpdate) {
    context.dispatch({
      kind: "inform",
      tone: "info",
      text: `Update available: ${release.version} · /update to install`,
    });

    return;
  }

  const outcome = await selfUpdate();

  if (context.signal.aborted) return;

  context.dispatch({
    kind: "inform",
    tone: outcome.kind === "updated" ? "info" : "warning",
    text:
      outcome.kind === "updated"
        ? describeUpdateOutcome(outcome)
        : `Update available: ${release.version} · ${describeUpdateOutcome(outcome)}`,
  });
}
