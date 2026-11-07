import process from "node:process";
import notificationsPlugin from "@nyte-ai/plugin/client/notifications";
import tuiRenderersPlugin from "@nyte-ai/plugin/client/transcript-tui";
import questionsPlugin from "@nyte-ai/plugin/client/questions-tui";
import type { Plugin } from "@nyte-ai/plugin/client";
import { asId, SdkError } from "@nyte-ai/schema";
import type {
  ConfigurationPatch,
  Connection,
  Cursor,
  ModelCatalogView,
  ModelRef,
  Session,
  SessionInfo,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { CliError } from "./cli/errors.ts";
import { availableModels, findModel, modelId } from "./lib/catalog.ts";
import type { ResumeTarget, RunFlags } from "./flags.ts";

export function tuiPlugins(): readonly Plugin[] {
  return [notificationsPlugin, tuiRenderersPlugin, questionsPlugin];
}

/**
 * The model and effort the flags ask for, checked against the catalog. They configure this run's
 * chat only; the saved default model stays. An unknown or unusable model fails before any change.
 */
export function flagConfiguration(
  catalog: ModelCatalogView,
  flags: Pick<RunFlags, "provider" | "model" | "effort">,
): ConfigurationPatch | undefined {
  const requested = flags.model ?? process.env["NYTE_MODEL"];
  const thinking = flags.effort === undefined ? {} : { thinking: flags.effort };

  if (requested === undefined && flags.provider !== undefined)
    throw new CliError("invalid_arguments", "Can't use --provider without --model.", {
      next: [
        {
          label: "Name the model too",
          argv: ["nyte", "-p", "--provider", flags.provider, "--model", "<MODEL>", "<PROMPT>"],
        },
      ],
    });

  if (requested === undefined) return flags.effort === undefined ? undefined : thinking;

  return { ...thinking, model: resolveModel(catalog, requested, flags) };
}

function resolveModel(
  catalog: ModelCatalogView,
  requested: string,
  flags: Pick<RunFlags, "provider" | "model">,
): ModelRef {
  const slash = requested.indexOf("/");

  const wanted =
    flags.provider !== undefined
      ? { provider: flags.provider, id: requested }
      : slash > 0
        ? { provider: requested.slice(0, slash), id: requested.slice(slash + 1) }
        : undefined;

  const usable = availableModels(catalog);
  const every = catalog.providers.flatMap((provider) => provider.models);

  const found =
    wanted === undefined
      ? (usable.find((model) => model.ref.id === requested) ??
        every.find((model) => model.ref.id === requested))
      : findModel(every, wanted);

  const name = wanted === undefined ? requested : modelId(wanted);
  const source = flags.model === undefined ? " from NYTE_MODEL" : "";

  if (found === undefined)
    throw new CliError("not_found", `Couldn't find model ${name}${source}.`, {
      next: [{ label: "See the models", argv: ["nyte", "api", "call", "models.list", "{}"] }],
    });

  if (!usable.includes(found))
    throw new CliError(
      "missing_input",
      `Can't use model ${name} without signing in to ${found.ref.provider}.`,
      { next: [{ label: "Sign in", argv: ["nyte", "login", found.ref.provider] }] },
    );

  return wanted ?? found.ref;
}

export async function* rootSessions(connection: {
  readonly sessions: Pick<Connection["sessions"], "list">;
}): AsyncIterable<SessionInfo> {
  let cursor: Cursor | null = null;

  do {
    const page = await connection.sessions.list(
      cursor === null ? { parents: { kind: "roots" } } : { parents: { kind: "roots" }, cursor },
    );

    yield* page.items;
    cursor = page.next;
  } while (cursor !== null);
}

export async function addFolder(
  connection: { readonly workspaces: Pick<Connection["workspaces"], "inspect" | "add"> },
  path: string,
): Promise<WorkspaceId> {
  const seen = await connection.workspaces.inspect({ kind: "local", path });
  const added = await connection.workspaces.add(seen.target, {
    expect: { identity: seen.identity },
  });

  if (added.kind === "stale") throw new Error(`${path} changed while it was opened. Try again.`);

  if (added.kind === "unavailable") throw new Error(`Couldn't open ${path}: ${added.reason}`);

  return added.workspace;
}

export async function trustFolder(
  connection: Connection,
  resume: ResumeTarget,
  cwd: string,
  trusted: boolean,
): Promise<void> {
  const session = await targetSession(connection, resume);

  const workspace =
    session === null ? await addFolder(connection, cwd) : (await session.info()).workspace;

  const outcome = await connection.workspace(workspace).update({ projectResources: trusted });

  if (outcome.kind === "missing") throw new Error("This folder is no longer registered.");
}

/** The session a print run continues, or `null` when it starts a new chat. */
export async function targetSession(
  connection: Connection,
  target: ResumeTarget,
): Promise<Session | null> {
  switch (target.kind) {
    case "new":
      return null;
    case "latest": {
      for await (const info of rootSessions(connection)) return connection.session(info.id);

      return null;
    }

    case "session": {
      const session = connection.session(asId(target.id));

      await session.info().catch((error: unknown) => {
        if (!(error instanceof SdkError) || error.code !== "unknown") throw error;

        throw new CliError("not_found", `Couldn't find session ${target.id}.`, {
          next: [
            { label: "List your chats", argv: ["nyte", "api", "call", "sessions.list", "{}"] },
          ],
        });
      });

      return session;
    }

    default: {
      const _exhaustive: never = target;

      return _exhaustive;
    }
  }
}
