import { asId } from "@nyte-ai/schema";
import type { ModelCatalogView, SessionId, Thinking } from "@nyte-ai/sdk";
import { availableModels, findModel } from "../lib/catalog.ts";
import type { BlankChat, Selection } from "../model/state.ts";
import { describeUpdateOutcome, selfUpdate } from "../update.ts";
import { checkForUpdate } from "../version.ts";
import { configure } from "./commands.ts";
import type { HandlerContext } from "./scope.ts";
import {
  defaultSelection,
  fallbackSelection,
  follow,
  openBlank,
  PLACEHOLDER_SELECTION,
  sameSelection,
  settleFolder,
  watchHost,
} from "./session.ts";

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

export function launchChat(options: BootOptions, recorded: Selection | null): BlankChat | null {
  if (options.target.kind !== "new") return null;
  const id = asId<"session">(crypto.randomUUID());
  const folder = { kind: "launch-folder" } as const;

  if (options.model !== null || recorded === null)
    return { kind: "blank", id, folder, selection: PLACEHOLDER_SELECTION, unresolved: true };

  return {
    kind: "blank",
    id,
    folder,
    selection: { ...recorded, effort: options.effort ?? recorded.effort },
  };
}

export async function boot(options: BootOptions, context: HandlerContext): Promise<void> {
  const { dispatch, ports, scope } = context;
  const catalog = await ports.host.listModels();
  const { settings } = context.read().facts;
  dispatch({ kind: "catalog", generation: (scope.catalogGeneration += 1), catalog });

  if (context.signal.aborted) return;
  const flagged = flagSelection(options, catalog);
  const resolved = defaultSelection(catalog);
  const selection = flagged ?? resolved;
  const launched = context.read().facts.chat;

  if (resolved !== null && (launched === null || !sameSelection(launched.selection, resolved)))
    void ports.firstFrame.write(resolved).catch((cause: unknown) => {
      ports.log.write("effect", cause);
    });

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
  const target = await resolveTarget(options, context);

  if (context.signal.aborted) return;
  const { chat } = context.read().facts;

  if (target === null && chat?.kind === "blank") {
    const sending = context.read().local.submissions.some((sent) => sent.session === chat.id);

    if ((chat.unresolved === true || !sending) && !sameSelection(chat.selection, selection))
      dispatch({ kind: "selection", session: chat.id, selection });
    await settleFolder(chat, context);
  } else if (target === null)
    await openBlank(
      {
        kind: "blank",
        id: asId(crypto.randomUUID()),
        folder: { kind: "launch-folder" },
        selection,
      },
      context,
    );
  else await follow(target, false, context);

  if (target !== null && flagged !== null) {
    await configure(
      {
        kind: "configure",
        session: target,
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

async function resolveTarget(
  options: BootOptions,
  context: HandlerContext,
): Promise<SessionId | null> {
  switch (options.target.kind) {
    case "new":
      return null;
    case "latest": {
      for await (const info of context.ports.host.rootSessions()) return info.id;

      return null;
    }

    case "session":
      return options.target.id;
    default: {
      const _exhaustive: never = options.target;

      return _exhaustive;
    }
  }
}

function flagSelection(
  options: Pick<BootOptions, "model" | "effort">,
  catalog: ModelCatalogView,
): Selection | null {
  if (options.model === null && options.effort === null) return null;

  if (options.model === null) return fallbackSelection(catalog, options.effort ?? "medium");
  const [provider, ...rest] = options.model.split("/");

  if (rest.length > 0) {
    const model = { provider, id: rest.join("/") };
    const listed = findModel(availableModels(catalog), model);

    return { model, effort: options.effort ?? listed?.defaultThinking ?? "medium", fast: false };
  }

  const found = availableModels(catalog).find((model) => model.ref.id === options.model);

  if (found === undefined) throw new Error(`Unavailable model: ${options.model}`);

  return {
    model: found.ref,
    effort: options.effort ?? found.defaultThinking,
    fast: false,
  };
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
