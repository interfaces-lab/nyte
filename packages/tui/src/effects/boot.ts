import type { ModelCatalogView, SessionId, Thinking } from "@nyte-ai/sdk";
import { availableModels } from "../lib/catalog.ts";
import type { Selection } from "../model/state.ts";
import { describeUpdateOutcome, selfUpdate } from "../update.ts";
import { checkForUpdate } from "../version.ts";
import { configure } from "./commands.ts";
import type { HandlerContext } from "./runner.ts";
import { createSession, fallbackSelection, follow, watchHost } from "./session.ts";

export interface BootOptions {
  readonly home: string;
  readonly cwd: string;
  readonly target:
    | { readonly kind: "new" }
    | { readonly kind: "latest" }
    | { readonly kind: "session"; readonly id: SessionId };
  readonly model: string | null;
  readonly effort: Thinking | null;
}

/**
 * Starts the app: reads settings at once, then lists models as soon as `opened` says the
 * host is reachable, resolves the session and follows it. A failed `opened` fails boot.
 */
export async function boot(
  options: BootOptions,
  opened: Promise<void>,
  context: HandlerContext,
): Promise<void> {
  const { dispatch, ports, scope } = context;

  const reading = ports.settings.read(options.cwd).then((settings) => {
    if (!context.signal.aborted) dispatch({ kind: "settings", settings });

    return settings;
  });

  reading.catch(() => undefined);

  if (!(await reachable(opened, context.signal))) return;
  const [settings, catalog] = await Promise.all([reading, ports.host.listModels()]);
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
    .catch((cause: unknown) => {
      ports.log.write("watch", cause);
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
          model: options.model === null ? undefined : flagged.model,
          fast: options.model === null ? undefined : flagged.fast,
          effort: options.effort === null ? undefined : flagged.effort,
        },
      },
      context,
    );
  }

  if (
    availableModels(catalog).length === 0 &&
    catalog.providers.every((provider) => provider.credential !== "unknown")
  )
    dispatch({
      kind: "inform",
      tone: "warning",
      text: "Not signed in. /login connects a provider.",
    });

  await checkUpdate(settings.autoUpdate, context);
}

function reachable(opened: Promise<void>, signal: AbortSignal): Promise<boolean> {
  const aborted = new Promise<boolean>((resolve) =>
    signal.addEventListener("abort", () => resolve(false), { once: true }),
  );

  return signal.aborted ? Promise.resolve(false) : Promise.race([opened.then(() => true), aborted]);
}

async function resolveTarget(
  options: BootOptions,
  selection: Selection,
  flagged: boolean,
  context: HandlerContext,
): Promise<{ readonly id: SessionId; readonly resumed: boolean }> {
  const { host } = context.ports;

  const create = async (): Promise<SessionId> =>
    createSession(
      { workspace: null, selection: flagged ? selection : null, effort: options.effort },
      context,
    );

  switch (options.target.kind) {
    case "new":
      return { id: await create(), resumed: false };
    case "latest": {
      for await (const info of host.rootSessions())
        if (info.heads.some((head) => head.tip.kind !== "start"))
          return { id: info.id, resumed: true };

      return { id: await create(), resumed: false };
    }

    case "session":
      return { id: options.target.id, resumed: true };
    default: {
      const _exhaustive: never = options.target;

      return _exhaustive;
    }
  }
}

export function flagSelection(
  options: Pick<BootOptions, "model" | "effort">,
  catalog: ModelCatalogView,
): Selection | null {
  if (options.model === null && options.effort === null) return null;
  const effort = options.effort ?? "medium";

  if (options.model === null) return fallbackSelection(catalog, effort);
  const [provider, ...rest] = options.model.split("/");

  if (rest.length > 0) {
    const model = { provider, id: rest.join("/") };

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
