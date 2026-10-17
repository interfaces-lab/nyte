import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import {
  acquireSessionResources,
  anthropicProvider,
  clampThinkingLevel,
  createAssistantMessageEventStream,
  getCurrentTools,
  getCurrentSystemPrompt,
  lazyStream,
  registerSessionResourceCleanup,
} from "@nyte-ai/ai";
import type {
  Api,
  AssistantMessageEventStream,
  Model,
  Provider,
  SimpleStreamOptions,
  ThinkingLevel,
  TranscriptContext,
} from "@nyte-ai/ai";
import { processEnvironment } from "@nyte-ai/core";
import type { SettingDefinition, ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import type { PartId, ToolClass } from "@nyte-ai/schema";
import type { Static } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Plugin } from "../core.ts";
import { question } from "../question/question.ts";
import { answerInput } from "../question/schema.ts";
import { ClaudeCodeSession } from "./session.ts";
import type { Approve, StartQuery } from "./session.ts";
import {
  flatPrompt,
  messageKey,
  mirrorArguments,
  sessionEntries,
  userBlocks,
} from "./transcript.ts";
import {
  BACKGROUND_TOOL,
  CLAUDE_CODE_PROVIDER,
  emptyMessage,
  MIRROR_TOOL,
  Translator,
} from "./translate.ts";

const API = "claude-agent-sdk";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly EffortLevel[];

const NOT_RUNNING = "Claude Code is no longer running this turn. Send a message to continue.";

/** Nyte tools Claude Code has its own built-in for, which the Nyte MCP server leaves out. */
const CLAUDE_CODE_HAS_ITS_OWN = new Set([
  "read",
  "write",
  "edit",
  "list",
  "bash",
  "web_search",
  "question",
]);

export const ultracodeSetting: SettingDefinition<boolean> = {
  id: "claude_code.ultracode",
  label: "Claude Code ultracode",
  schema: standard(Type.Boolean()),
  choices: [
    { value: false, label: "Off" },
    { value: true, label: "On", badge: "ultracode" },
  ],
  default: false,
  scope: "session",
};

interface Binding {
  readonly cwd: string;
  ultracode(): Promise<boolean>;
  readonly approve: Approve;
}

function effortFor(
  model: Model<Api>,
  reasoning: ThinkingLevel | undefined,
): EffortLevel | undefined {
  if (reasoning === undefined) return undefined;
  const level = clampThinkingLevel(model, reasoning);

  if (level === "off") return undefined;
  const mapped = model.thinkingLevelMap?.[level] ?? level;

  return EFFORTS.find((effort) => effort === mapped) ?? (level === "minimal" ? "low" : undefined);
}

async function claudeCodeConfigured(): Promise<boolean> {
  try {
    await access(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));

    return true;
  } catch {
    return false;
  }
}

function answerOnce(
  start: StartQuery,
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output = emptyMessage(model);
  const translator = new Translator(model, output, stream);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options?.signal?.addEventListener("abort", abort, { once: true });

  void (async () => {
    try {
      stream.push({ type: "start", partial: output });
      await processEnvironment();

      for await (const message of start({
        prompt: flatPrompt(context.messages),
        options: {
          model: model.id,
          abortController: controller,
          systemPrompt: getCurrentSystemPrompt(context.messages),
          tools: [],
          settingSources: [],
          strictMcpConfig: true,
          maxTurns: 1,
          persistSession: false,
          includePartialMessages: true,
          thinking: { type: "disabled" },
          env: { ...process.env, ...options?.env },
        },
      })) {
        if (message.type === "stream_event" && message.parent_tool_use_id === null)
          translator.apply(message.event);
        else if (message.type === "result" && message.subtype !== "success")
          throw new Error(message.errors.join("\n") || `Claude Code failed: ${message.subtype}`);
      }

      if (output.stopReason === "pending" || output.stopReason === "aborted")
        throw new Error("Claude Code ended without a response.");

      if (output.stopReason === "error")
        throw new Error(output.errorMessage ?? "Claude Code failed.");
      stream.push({ type: "done", reason: output.stopReason, message: output });
    } catch (error) {
      output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
    } finally {
      options?.signal?.removeEventListener("abort", abort);
      stream.end();
    }
  })();

  return stream;
}

const nonEmpty = Type.String({ minLength: 1 });

function field(input: Static<typeof mirrorArguments>["input"], key: string): string | undefined {
  const value = input[key];

  return Value.Check(nonEmpty, value) ? value : undefined;
}

const claudeQuestions = Type.Array(
  Type.Object({
    question: Type.String(),
    header: Type.String(),
    options: Type.Array(Type.Object({ label: Type.String(), description: Type.String() })),
    multiSelect: Type.Optional(Type.Boolean()),
  }),
);

async function askUser(
  session: ClaudeCodeSession,
  id: string,
  input: Static<typeof mirrorArguments>["input"],
  invocation: ToolInvocation,
): Promise<{ readonly answers: Record<string, string> | null; readonly part: PartId | null }> {
  if (!Value.Check(claudeQuestions, input.questions)) return { answers: null, part: null };

  const questions = input.questions.map((item) => ({
    question: item.question,
    header: item.header.slice(0, 30),
    options: item.options.map(({ label, description }) => ({ label, description })),
    multiple: item.multiSelect === true,
  }));

  const part = await invocation.session.parts.create(question, {
    state: { questions, answers: null },
    placement: { kind: "modal" },
  });

  const outcome = await invocation.wait({ kind: "part", part: part.id });

  const checked =
    outcome.kind === "part" && outcome.answer?.action === "answer"
      ? await answerInput["~standard"].validate(outcome.answer.input)
      : undefined;

  if (checked === undefined || checked.issues !== undefined)
    return { answers: null, part: part.id };

  const answers = questions.flatMap((item, index) => {
    const chosen = checked.value.answers[index]?.join(", ") ?? "";

    return chosen === "" ? [] : [[item.question, chosen] as const];
  });

  return { answers: answers.length === 0 ? null : Object.fromEntries(answers), part: part.id };
}

function classifyClaudeTool(
  name: string,
  input: Static<typeof mirrorArguments>["input"],
): ToolClass {
  const path = field(input, "file_path") ?? field(input, "notebook_path");
  const command = field(input, "command");
  const description = field(input, "description");

  switch (name) {
    case "Read":
      return path === undefined ? { kind: "custom", label: name } : { kind: "read", path };
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return path === undefined ? { kind: "custom", label: name } : { kind: "edit", path };
    case "Bash":
      if (command === undefined) return { kind: "custom", label: name };

      return description === undefined
        ? { kind: "shell", command }
        : { kind: "shell", command, description };
    case "Agent":
    case "Task":
      return {
        kind: "delegate",
        child: null,
        role: "task",
        title: description ?? null,
      };
    case "Skill":
      return { kind: "custom", label: `Skill ${field(input, "skill") ?? ""}`.trim() };
    case "Workflow":
      return {
        kind: "custom",
        label: `Workflow ${field(input, "title") ?? field(input, "name") ?? ""}`.trim(),
      };
    case "AskUserQuestion": {
      const headers = Value.Check(claudeQuestions, input.questions)
        ? input.questions.map((item) => item.header).join(", ")
        : "";

      return { kind: "custom", label: `Asking ${headers}`.trim() };
    }
    case BACKGROUND_TOOL:
      return { kind: "custom", label: "Waiting for background work" };
    default: {
      const subject = field(input, "pattern") ?? field(input, "url") ?? field(input, "query");

      return { kind: "custom", label: subject === undefined ? name : `${name} ${subject}` };
    }
  }
}

function mirrorTool(
  sessions: ReadonlyMap<string, ClaudeCodeSession>,
): ToolDefinition<Static<typeof mirrorArguments>> {
  return {
    name: MIRROR_TOOL,
    description: "A tool Claude Code ran. Claude Code reports the result; Nyte records it.",
    parameters: standard(mirrorArguments),
    exposure: "hidden",
    approval: "runtime",
    replay: "safe",
    class: ({ name, input }) => classifyClaudeTool(name, input),
    async execute({ id, name, input }, invocation) {
      const session = sessions.get(invocation.session.id);

      if (session === undefined || session.closed) throw new Error(NOT_RUNNING);

      if (name === BACKGROUND_TOOL)
        return { content: [{ kind: "text", text: await session.background(invocation.signal) }] };
      session.recording(id);
      let parts: PartId[] = [];

      if (name === "AskUserQuestion") {
        const asked = await askUser(session, id, input, invocation);
        session.answer(id, asked.answers);
        parts = asked.part === null ? [] : [asked.part];
      }

      const output = await session.result(id, invocation.signal);

      if (output.isError) throw new Error(output.text);

      return { content: [{ kind: "text", text: output.text }], parts };
    },
  };
}

export function claudeCodeSdk(start: StartQuery = query) {
  const catalog = anthropicProvider();
  const sessions = new Map<string, ClaudeCodeSession>();
  const bindings = new Map<string, Binding>();

  registerSessionResourceCleanup((id) => {
    for (const [key, session] of sessions) {
      if (id !== undefined && key !== id) continue;
      sessions.delete(key);
      session.close();
    }
  });

  async function respond(
    model: Model<Api>,
    context: TranscriptContext,
    options: SimpleStreamOptions | undefined,
  ): Promise<AssistantMessageEventStream> {
    const id = options?.sessionId;
    const binding = id === undefined ? undefined : bindings.get(id);

    if (id === undefined || binding === undefined)
      throw new Error("Claude Code answers inside a Nyte session with the claude-code-sdk plugin.");
    const effort = effortFor(model, options?.reasoning);
    const ultracode = await binding.ultracode();
    const key = JSON.stringify([model.id, binding.cwd, options?.reasoning !== undefined]);
    const messages = context.messages.filter((message) => message.role !== "system");
    const keys = messages.map(messageKey);

    const tools = getCurrentTools(context.messages).filter(
      (tool) => !CLAUDE_CODE_HAS_ITS_OWN.has(tool.name),
    );

    let session = sessions.get(id);

    const continues =
      session !== undefined &&
      !session.closed &&
      !session.asking &&
      session.key === key &&
      session.known.length < keys.length &&
      session.known.every((known, index) => keys[index] === known);

    const prompt = messages.slice(messages.findLastIndex((message) => message.role !== "user") + 1);

    if (!continues) {
      session?.close();

      if (prompt.length === 0) throw new Error(NOT_RUNNING);
      await processEnvironment();
      const claudeSession = randomUUID();

      session = new ClaudeCodeSession({
        key,
        model: model.id,
        cwd: binding.cwd,
        thinking: options?.reasoning !== undefined,
        effort,
        ultracode,
        env: options?.env,
        session: claudeSession,
        history: sessionEntries(messages.slice(0, -prompt.length), {
          session: claudeSession,
          model: model.id,
          cwd: binding.cwd,
        }),
        tools,
        query: start,
        approve: binding.approve,
      });
      sessions.set(id, session);
    }

    if (session === undefined) throw new Error(NOT_RUNNING);
    session.expose(tools);
    session.deliver(messages);
    await session.configure(effort, ultracode);

    if (prompt.length > 0)
      session.send(
        prompt.flatMap((message) => (message.role === "user" ? userBlocks(message) : [])),
      );
    const live = session;
    const stream = live.respond(model, options?.signal);

    void stream.result().then((message) => {
      live.known =
        message.stopReason === "error" || message.stopReason === "aborted"
          ? []
          : [...keys, messageKey(message)];
    });

    return stream;
  }

  const stream = (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    getCurrentTools(context.messages).length === 0
      ? answerOnce(start, model, context, options)
      : lazyStream(model, () => respond(model, context, options));

  const provider: Provider = {
    id: CLAUDE_CODE_PROVIDER,
    name: "Claude Code",
    baseUrl: "process://claude-code",
    capabilities: { steer: true },
    auth: {
      apiKey: {
        name: "Claude Code login",
        resolve: async ({ signal }) => {
          signal.throwIfAborted();

          return (await claudeCodeConfigured())
            ? { auth: {}, source: "Claude Code login" }
            : undefined;
        },
      },
    },
    getModels: () =>
      catalog.getModels().map(({ compat: _compat, ...model }) => ({
        ...model,
        provider: CLAUDE_CODE_PROVIDER,
        api: API,
        baseUrl: "process://claude-code",
      })),
    refreshModels: async (context) => {
      await catalog.refreshModels?.(context);
    },
    stream: (model, context, options) =>
      stream(model, context, {
        signal: options?.signal,
        sessionId: options?.sessionId,
        env: options?.env,
      }),
    streamSimple: stream,
  };

  const plugin = {
    id: "claude-code-sdk",
    contribute: { tools: [mirrorTool(sessions)], settings: [ultracodeSetting] },
    activate(api) {
      const id = api.session.id;

      const binding: Binding = {
        cwd: api.env.cwd,
        ultracode: async () => (await api.contribute.settings.value(ultracodeSetting.id)) === true,
        approve: async (name, input, signal) => {
          const verdict = await api.approve(
            { name, class: classifyClaudeTool(name, input) },
            signal,
          );

          return verdict.kind === "allow"
            ? { behavior: "allow" }
            : { behavior: "deny", message: verdict.reason };
        },
      };

      const release = acquireSessionResources(id);
      bindings.set(id, binding);

      const unbind = () => {
        if (bindings.get(id) === binding) bindings.delete(id);
        release();
      };

      if (api.signal.aborted) unbind();
      else api.signal.addEventListener("abort", unbind, { once: true });
    },
  } satisfies Plugin;

  return { provider, plugin };
}
