/**
 * From flags to the session a launch opens: which chat, and the model and
 * thinking level the flags ask the head to use.
 */
import process from "node:process";
import notificationsPlugin from "@nyte-ai/plugin/notifications";
import tuiRenderersPlugin from "@nyte-ai/plugin/renderers/tui";
import type { Plugin } from "@nyte-ai/plugin/client";
import type { ConfigurationPatch, Connection, Cursor, Session, SessionInfo } from "@nyte-ai/sdk";
import { availableModels } from "./lib/catalog.ts";
import type { ResumeTarget, RunFlags } from "./flags.ts";

/** The terminal's client plugins: run notifications and the part renderers it draws with. */
export function tuiPlugins(): readonly Plugin[] {
  return [notificationsPlugin, tuiRenderersPlugin];
}

/**
 * Returns the head configuration `--provider`, `--model` (or `NYTE_MODEL`)
 * and `--effort` (or `NYTE_EFFORT`) ask for, or undefined when none is given.
 * A bare model id is looked up across the signed-in providers.
 */
export async function flagConfiguration(
  connection: Connection,
  flags: Pick<RunFlags, "provider" | "model" | "effort">,
): Promise<ConfigurationPatch | undefined> {
  const requested = flags.model ?? process.env["NYTE_MODEL"];
  const effort = flags.effort;

  if (requested === undefined && effort === undefined) return undefined;
  const configuration: ConfigurationPatch = effort === undefined ? {} : { thinking: effort };

  if (requested === undefined) return configuration;
  const slash = requested.indexOf("/");
  const provider = flags.provider ?? (slash === -1 ? undefined : requested.slice(0, slash));
  const id = slash === -1 || flags.provider !== undefined ? requested : requested.slice(slash + 1);

  if (provider !== undefined) return { ...configuration, model: { provider, id } };

  const found = availableModels(await connection.models.list()).find(
    (model) => model.ref.id === id,
  );

  if (found === undefined) throw new Error(`Unavailable model: ${id}`);

  return { ...configuration, model: found.ref };
}

/** Returns every root session, newest activity first, across the directory's pages. */
async function rootSessions(connection: Connection): Promise<readonly SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  let cursor: Cursor | null = null;

  do {
    const page = await connection.sessions.list(
      cursor === null ? { parents: { kind: "roots" } } : { parents: { kind: "roots" }, cursor },
    );

    sessions.push(...page.items);
    cursor = page.next;
  } while (cursor !== null);

  return sessions.toSorted((left, right) => right.lastActivityAt - left.lastActivityAt);
}

/**
 * The session a launch targets: a new one, the newest root session anything
 * was written to (a launch that never sent creates nothing worth resuming),
 * or the one an id names.
 */
export async function targetSession(
  connection: Connection,
  target: ResumeTarget,
  configuration: ConfigurationPatch | undefined,
): Promise<Session> {
  const create = (): Promise<Session> =>
    connection.sessions.create(configuration === undefined ? {} : { configuration });

  switch (target.kind) {
    case "new":
      return create();
    case "latest": {
      const used = (await rootSessions(connection)).find((info) =>
        info.heads.some((head) => head.tip.kind !== "start"),
      );

      return used === undefined ? create() : connection.session(used.id);
    }

    case "session": {
      const sessions: SessionInfo[] = [];
      let cursor: Cursor | null = null;

      do {
        const page = await connection.sessions.list(
          cursor === null ? { parents: { kind: "all" } } : { parents: { kind: "all" }, cursor },
        );

        sessions.push(...page.items);
        cursor = page.next;
      } while (cursor !== null && !sessions.some((info) => info.id === target.id));

      const found = sessions.find((info) => info.id === target.id);

      if (found === undefined) throw new Error(`Session not found: ${target.id}`);

      return connection.session(found.id);
    }

    default: {
      const _exhaustive: never = target;

      return _exhaustive;
    }
  }
}
