import process from "node:process";
import { asId } from "@nyte-ai/schema";
import notificationsPlugin from "@nyte-ai/plugin/client/notifications";
import tuiRenderersPlugin from "@nyte-ai/plugin/client/transcript-tui";
import questionsPlugin from "@nyte-ai/plugin/client/questions-tui";
import type { Plugin } from "@nyte-ai/plugin/client";
import type {
  ConfigurationPatch,
  Connection,
  Cursor,
  Session,
  SessionInfo,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { availableModels } from "./lib/catalog.ts";
import type { ResumeTarget, RunFlags } from "./flags.ts";

export function tuiPlugins(): readonly Plugin[] {
  return [notificationsPlugin, tuiRenderersPlugin, questionsPlugin];
}

export async function flagConfiguration(
  connection: Connection,
  flags: Pick<RunFlags, "provider" | "model" | "effort">,
): Promise<ConfigurationPatch | undefined> {
  const requested = flags.model ?? process.env["NYTE_MODEL"];
  const effort = flags.effort;

  if (requested === undefined && effort === undefined) return undefined;
  const configuration: ConfigurationPatch = effort === undefined ? {} : { thinking: effort };

  if (requested === undefined) return configuration;
  const [named, ...rest] = requested.split("/");
  const provider = flags.provider ?? (rest.length === 0 ? undefined : named);
  const id = rest.length === 0 || flags.provider !== undefined ? requested : rest.join("/");

  if (provider !== undefined) return { ...configuration, model: { provider, id } };

  const found = availableModels(await connection.models.list()).find(
    (model) => model.ref.id === id,
  );

  if (found === undefined) throw new Error(`Unavailable model: ${id}`);

  return { ...configuration, model: found.ref };
}

export async function* rootSessions(connection: Connection): AsyncIterable<SessionInfo> {
  let cursor: Cursor | null = null;

  do {
    const page = await connection.sessions.list(
      cursor === null ? { parents: { kind: "roots" } } : { parents: { kind: "roots" }, cursor },
    );

    yield* page.items;
    cursor = page.next;
  } while (cursor !== null);
}

export async function addFolder(connection: Connection, path: string): Promise<WorkspaceId> {
  const seen = await connection.workspaces.inspect({ kind: "local", path });
  const added = await connection.workspaces.add(seen.target, {
    expect: { identity: seen.identity },
  });

  if (added.kind === "stale") throw new Error(`${path} changed while it was opened. Try again.`);

  if (added.kind === "unavailable") throw new Error(`Couldn't open ${path}: ${added.reason}`);

  return added.workspace;
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
      await session.info();

      return session;
    }

    default: {
      const _exhaustive: never = target;

      return _exhaustive;
    }
  }
}
