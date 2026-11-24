import { realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";
import { clampThinkingLevel } from "@nyte-ai/ai";
import type {
  Api,
  Model,
  ModelsStoreEntry,
  RefreshModelsContext,
  ThinkingLevel,
  ThinkingLevelMap,
} from "@nyte-ai/ai";
import { processEnvironment } from "@nyte-ai/core";
import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema/model";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { executable, findOnPath } from "../find-on-path.ts";
import { AgentProcess, choices, findOption } from "./process.ts";
import type { AgentChoice } from "./process.ts";
import { ACP_API } from "./projection.ts";

const PROBE_TIMEOUT_MS = 5000;

const PROBE_TTL_MS = 86_400_000;

import type { AcpAgent } from "./profiles.ts";

export type { AcpAgent, AcpLaunch } from "./profiles.ts";

export interface AgentRoute {
  readonly model: Model<Api>;
  readonly agent: AcpAgent;
  readonly value: string | undefined;
}

export interface AgentCatalog {
  readonly routes: readonly AgentRoute[];
  readonly persist?: ModelsStoreEntry;
}

const agentModel = Type.Object({
  value: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  levels: Type.Array(Type.String()),
});

const storedModels = Type.Object({ launch: Type.String(), models: Type.Array(agentModel) });

type AgentModel = Static<typeof agentModel>;

export async function agentCatalog(
  agent: AcpAgent,
  context: RefreshModelsContext,
): Promise<AgentCatalog> {
  await processEnvironment();
  const command = await locate(agent.command);

  if (command === undefined) return { routes: [] };
  const launched = { ...agent, command };
  const binary = await stat(await realpath(command));

  const launch = JSON.stringify([
    command,
    agent.launch.args,
    agent.launch.mode ?? null,
    binary.mtimeMs,
    binary.size,
  ]);

  const kept = restore(context.stored, launch);

  const fresh =
    kept !== undefined &&
    context.force !== true &&
    Date.now() - (context.stored?.checkedAt ?? 0) < PROBE_TTL_MS;

  if (!context.allowNetwork || fresh) return { routes: agentRoutes(launched, kept ?? []) };
  const probed = await probe(launched, context.signal).catch(() => undefined);

  if (probed === undefined) return { routes: agentRoutes(launched, kept ?? []) };

  return {
    routes: agentRoutes(launched, probed),
    persist: { models: [{ launch, models: probed }], checkedAt: Date.now() },
  };
}

export function agentChoice(route: AgentRoute, reasoning: ThinkingLevel | undefined): AgentChoice {
  const level = clampThinkingLevel(route.model, reasoning ?? "off");

  return { model: route.value, thought: route.model.thinkingLevelMap?.[level] ?? undefined };
}

async function locate(command: string): Promise<string | undefined> {
  if (!isAbsolute(command)) return findOnPath(command, process.env.PATH ?? "");

  return (await executable(command)) ? command : undefined;
}

function restore(
  stored: ModelsStoreEntry | undefined,
  launch: string,
): readonly AgentModel[] | undefined {
  const entry = stored?.models.find(
    (candidate) => Value.Check(storedModels, candidate) && candidate.launch === launch,
  );

  if (!Value.Check(storedModels, entry)) return undefined;
  const values = new Set(entry.models.map((model) => model.value));

  return values.size === entry.models.length ? entry.models : undefined;
}

function agentRoutes(agent: AcpAgent, models: readonly AgentModel[]): readonly AgentRoute[] {
  return [
    { model: nyteModel(agent, agent.id, agent.name, []), agent, value: undefined },
    ...models
      .filter((model) => model.value !== agent.id)
      .map((model) => ({
        model: nyteModel(agent, model.value, model.name, model.levels),
        agent,
        value: model.value,
      })),
  ];
}

async function probe(agent: AcpAgent, signal: AbortSignal): Promise<readonly AgentModel[]> {
  const stop = AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
  stop.throwIfAborted();
  const running = AgentProcess.spawn(agent, tmpdir());

  const abort = () => void running.close();

  stop.addEventListener("abort", abort, { once: true });

  try {
    await running.open({ cwd: tmpdir() });

    const initial = running.configOptions();
    const option = findOption(initial, "model");

    if (option === undefined) return [];

    const offered = choices(option).filter(
      (choice, index, all) => all.findIndex((other) => other.value === choice.value) === index,
    );

    const models: AgentModel[] = [];

    for (const choice of offered) {
      const options =
        choice.value === option.currentValue
          ? initial
          : await running.configure(option.id, choice.value);

      const levels = choices(findOption(options, "thought_level")).map((level) => level.value);
      models.push({ value: choice.value, name: choice.name, levels });
    }

    return models;
  } finally {
    stop.removeEventListener("abort", abort);
    await running.close();
  }
}

function nyteModel(
  agent: AcpAgent,
  id: string,
  name: string,
  levels: readonly string[],
): Model<Api> {
  const thinkingLevelMap = levelMap(levels);

  return {
    id,
    name,
    api: ACP_API,
    provider: agent.id,
    baseUrl: `process://acp/${agent.id}`,
    reasoning: thinkingLevelMap !== undefined,
    thinkingLevelMap,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 64_000,
  };
}

function levelMap(levels: readonly string[]): ThinkingLevelMap | undefined {
  const named = MODEL_THINKING_LEVELS.filter((level) => level !== "off" && levels.includes(level));

  if (named.length === 0) return undefined;
  const off = levels.find((level) => level === "off" || level === "none") ?? null;

  return Object.fromEntries(
    MODEL_THINKING_LEVELS.map((level) => [
      level,
      level === "off" ? off : named.includes(level) ? level : null,
    ]),
  );
}
