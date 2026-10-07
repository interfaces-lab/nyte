/**
 * One registry host as `nyte-serve` composes it, without the web app: a host
 * profile under `NYTE_HOME`, the runtime over it, and the headless listener
 * that admits the app's origin. The provider echoes, so no network is used.
 * The test owns this process through `control.ts`.
 */
import { createInterface } from "node:readline";
import process from "node:process";
import { inspect, parseArgs } from "node:util";
import {
  createAssistantMessageEventStream,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@nyte-ai/ai";
import type { MutableModels, Provider } from "@nyte-ai/ai";
import { SqliteStore } from "@nyte-ai/core/store";
import { openHostRuntime, openProfile } from "@nyte-ai/host/runtime";
import type { HostRuntime } from "@nyte-ai/host/runtime";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema";
import { Value } from "typebox/value";
// Relative: a package dependency on serve, which depends on this app, is a turbo task cycle.
import { startHeadless } from "../../../serve/src/headless.ts";
import { StateRequest } from "./control.ts";
import type { HostState, Ready, StateReply } from "./control.ts";

const model: Model<Api> = {
  id: "echo",
  name: "Echo",
  api: "openai-responses",
  provider: "echo",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

/** Answers `Echo: <last user text>`. */
const echo: Provider["stream"] = (selected, context) => {
  const message = context.messages.findLast((candidate) => candidate.role === "user");

  const said =
    message?.role !== "user"
      ? ""
      : Array.isArray(message.content)
        ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
        : message.content;

  const text = `Echo: ${said}`;

  const answer: AssistantMessage = {
    role: "assistant",
    api: selected.api,
    provider: selected.provider,
    model: selected.id,
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };

  const events = createAssistantMessageEventStream();

  events.push({ type: "start", partial: { ...answer, content: [] } });
  events.push({ type: "text_delta", contentIndex: 0, delta: text, partial: answer });
  events.push({ type: "done", reason: "stop", message: answer });

  return events;
};

function echoModels(): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });

  models.setProvider({
    id: model.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model],
    stream: echo,
    streamSimple: echo,
  });

  return models;
}

async function stateOf(runtime: HostRuntime, id: number): Promise<HostState> {
  const roots: HostState["roots"][number][] = [];
  let cursor: string | undefined;

  do {
    const page = await runtime.sdk.sessions.list({ parent: null, includeArchived: true, cursor });
    roots.push(
      ...page.items.map((info) => ({ sessionId: info.sessionId, cwd: info.workspace.cwd })),
    );
    cursor = page.next;
  } while (cursor !== undefined);

  const folders = (await runtime.workspaces.list()).map((row) => ({
    id: row.id,
    path: row.path,
    identity: row.identity,
    trust: row.trust.kind,
  }));

  return { id, kind: "state", roots, folders };
}

async function answer(runtime: HostRuntime, line: string): Promise<StateReply> {
  let request: unknown;

  try {
    request = JSON.parse(line);
  } catch {
    return { id: 0, kind: "error", message: `Not JSON: ${line}` };
  }

  if (!Value.Check(StateRequest, request))
    return { id: 0, kind: "error", message: `Not a state request: ${line}` };

  try {
    return await stateOf(runtime, request.id);
  } catch (cause) {
    return { id: request.id, kind: "error", message: inspect(cause) };
  }
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: { origin: { type: "string" }, port: { type: "string", default: "0" } },
});

if (values.origin === undefined) throw new Error("--origin names the web app's origin");

const port = Number(values.port);

const profile = await openProfile("default");

const runtime = await openHostRuntime({
  profile,
  store: new SqliteStore(profile.storePath),
  models: echoModels(),
  model,
  onDiagnostic: (message) => process.stderr.write(`${message}\n`),
});

const serving = await startHeadless({
  runtime,
  version: "e2e",
  hostname: "127.0.0.1",
  port,
  browserOrigins: [values.origin],
  onError: (cause) => process.stderr.write(`listener: ${inspect(cause)}\n`),
}).catch(async (cause: unknown) => {
  await runtime.close();
  throw cause;
});

let stopping = false;

const stop = (): void => {
  if (stopping) return;
  stopping = true;
  void serving
    .close()
    .then(() => runtime.close())
    .then(
      () => process.exit(0),
      (cause: unknown) => {
        process.stderr.write(`closing: ${inspect(cause)}\n`);
        process.exit(1);
      },
    );
};

const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  void answer(runtime, line).then((reply) => process.stdout.write(`${JSON.stringify(reply)}\n`));
});

// The owning test closes stdin to stop the host; a test runner that dies closes it too.
lines.once("close", stop);

process.once("SIGTERM", stop);

process.once("SIGINT", stop);

const ready: Ready = {
  kind: "ready",
  address: serving.address,
  token: profile.token,
  hostId: profile.hostId,
};

process.stdout.write(`${JSON.stringify(ready)}\n`);
