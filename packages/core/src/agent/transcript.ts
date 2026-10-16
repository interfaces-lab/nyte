import type {
  BlobId,
  CommitId,
  Configuration,
  HeadName,
  Json,
  MessageSource,
  ModelRef,
  PromptOverride,
  RunId,
  RunView,
  SessionId,
  ToolPartState,
  Transcript,
  UserContent,
} from "@nyte-ai/schema";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolResultMessage,
  UserMessage,
} from "@nyte-ai/schema/model";
import type { Models } from "@nyte-ai/ai";
import { estimateMessageTokens, estimateTextTokens } from "@nyte-ai/ai/utils/estimate";
import { LOCAL } from "../contract/host.ts";
import type { Kernel, PluginRuntime, ToolSource } from "../contract/kernel.ts";
import { branchSummary, compaction, text, thinking, tool } from "../contract/parts.ts";
import type { PromptSection } from "../contract/plugin.ts";
import type { CommitRecord, PartRecord } from "../contract/records.ts";
import type { Resources } from "../contract/workspace.ts";
import { withFold } from "../fold/reads.ts";
import { readPositionCommit, requireSession, START, walkCommitPath } from "../store/session.ts";
import { check, isJsonObject } from "../util/json-schema.ts";

interface Step {
  readonly commit: CommitId;
  readonly record: CommitRecord;
  readonly part: PartRecord | null;
  readonly created: number;
  readonly model: ModelRef | null;
}

interface Group {
  readonly commit: CommitId;
  readonly run: RunId | null;
  readonly model: ModelRef | null;
  readonly at: number;
  response: string | null;
  readonly content: AssistantMessage["content"];
  readonly calls: {
    readonly created: number;
    readonly content: AssistantMessage["content"];
    readonly commit: CommitId;
    readonly at: number;
    readonly id: string;
    readonly state: Settled;
  }[];
}

type Settled = Extract<ToolPartState, { readonly phase: "settled" }>;

const THOUGHTS = "\n\n";

const SUMMARISED =
  "The earlier conversation was summarised to fit the context window. The summary:";

const ABANDONED =
  "The conversation moved back to an earlier point, abandoning a path. What that path did:";

const projections = new WeakMap<object, CommitId>();

const IMAGE_CACHE_CHARS = 64 * 1024 * 1024;

const imageCache = new WeakMap<Kernel, Map<BlobId, string>>();

export function projectedCommit(message: Message): CommitId | null {
  return projections.get(message) ?? null;
}

export async function requestBody(
  kernel: Kernel,
  models: Models,
  runtime: PluginRuntime,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunView | null;
    readonly configuration: Configuration;
  },
): Promise<{ readonly transcript: Transcript; readonly source: ToolSource }> {
  const { session, head, configuration } = input;
  const run = input.run?.id ?? null;
  const where = { session, head, run, principal: LOCAL };

  const agent =
    configuration.agent === null
      ? undefined
      : runtime.registries.agents.list().find((entry) => entry.id === configuration.agent);

  const messages = await buildContext(kernel, models, runtime, {
    ...input,
    run,
    agent: agent?.prompt ?? null,
  });

  const source = kernel.tools(runtime);
  const named = agent?.tools;

  const tools = source
    .list()
    .filter(
      (info) => info.exposure === "model" && (named === undefined || named.includes(info.name)),
    );

  return {
    transcript: await runtime.hooks.transform("transform_transcript", { messages, tools }, where),
    source,
  };
}

export function tokenEstimate(transcript: Transcript): number {
  const messages = transcript.messages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0,
  );

  return transcript.tools.reduce(
    (sum, info) =>
      sum +
      estimateTextTokens(info.name) +
      estimateTextTokens(info.description) +
      estimateTextTokens(JSON.stringify(info.parameters)),
    messages,
  );
}

async function buildContext(
  kernel: Kernel,
  models: Models,
  runtime: PluginRuntime,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly configuration: Configuration;
    readonly agent: PromptOverride | null;
  },
): Promise<readonly Message[]> {
  const { session, configuration } = input;
  const found = await requireSession(kernel, session);
  const resources = await kernel.resources(session);
  const model = models.getModel(configuration.model.provider, configuration.model.id);

  const system = buildSystemPrompt(
    found.record.prompt,
    input.agent,
    resources,
    runtime.registries.prompt.list(),
  );

  const messages = await conversation(kernel, models, {
    session,
    head: input.head,
    run: input.run,
    images: model?.input.includes("image") === true,
  });

  return system === ""
    ? messages
    : [{ role: "system", content: system, timestamp: 0 }, ...messages];
}

function buildSystemPrompt(
  own: PromptOverride | null,
  agent: PromptOverride | null,
  resources: Resources,
  sections: readonly PromptSection[],
): string {
  if (own?.kind === "replace") return own.text;

  if (agent?.kind === "replace") return agent.text;

  const body =
    resources.prompt.system ??
    [...sections, ...collectPromptLayer("session", own), ...collectPromptLayer("agent", agent)]
      .map((section) => ({ id: section.id, text: section.text, order: section.order ?? 100 }))
      .sort(
        (left, right) =>
          left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .map((section) => {
        const tag = `${String(section.order).padStart(4, "0")}-${section.id}`;

        return `<${tag}>\n${section.text}\n</${tag}>`;
      })
      .join("\n\n");

  return [body, resources.prompt.append]
    .filter((part): part is string => part !== null && part !== "")
    .join("\n\n");
}

function collectPromptLayer(id: string, override: PromptOverride | null): readonly PromptSection[] {
  return override?.kind === "layer" ? [{ id, text: override.text, order: override.order }] : [];
}

async function conversation(
  kernel: Kernel,
  models: Models,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly images: boolean;
  },
): Promise<Message[]> {
  const steps = await withFold(kernel, input.session, (state): readonly Step[] => {
    const path = walkCommitPath(
      state.commits,
      readPositionCommit(state.heads.get(input.head)?.info.tip ?? START),
    );
    const on = new Set(path);

    const created = new Map([...state.parts.keys()].map((id, index) => [id, index]));

    const later = [...state.parts.values()].flatMap((part) =>
      input.run !== null &&
      part.run === input.run &&
      part.status.kind === "settled" &&
      !on.has(part.status.commit)
        ? [part.status.commit]
        : [],
    );

    return [...path, ...later].flatMap((commit): readonly Step[] => {
      const record = state.commits.get(commit);

      if (record === undefined) return [];
      const body = record.body;

      return [
        {
          commit,
          record,
          part: body.kind === "user" ? null : (state.parts.get(body.part) ?? null),
          created: body.kind === "user" ? -1 : (created.get(body.part) ?? -1),
          model:
            record.run === null
              ? null
              : (state.runs.get(record.run)?.view.configuration.model ?? null),
        },
      ];
    });
  });

  const removed = new Set<CommitId>();
  const anchors = new Map<CommitId, Step[]>();

  for (const step of [...steps].reverse()) {
    const body = step.record.body;

    if (body.kind !== "compaction" || removed.has(step.commit)) continue;

    for (const replaced of body.replaces) removed.add(replaced);

    const anchor =
      steps.find((other) => body.replaces.includes(other.commit))?.commit ?? step.commit;

    anchors.set(anchor, [step, ...(anchors.get(anchor) ?? [])]);
  }

  const messages: Message[] = [];
  let group: Group | null = null;

  const push = (message: Message, commit: CommitId): void => {
    projections.set(message, commit);
    messages.push(message);
  };

  const flush = async (): Promise<void> => {
    const current = group;
    group = null;

    if (current === null) return;
    const ordered = current.calls.toSorted((left, right) => left.created - right.created);
    const content = [...current.content, ...ordered.flatMap((call) => call.content)];

    if (content.length > 0) {
      const identity = resolveModelIdentity(models, current.model);

      push(
        {
          role: "assistant",
          content,
          api: identity.api,
          provider: identity.provider,
          model: identity.model,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: ordered.length > 0 ? "toolUse" : "stop",
          timestamp: current.at,
        },
        current.commit,
      );
    }

    for (const call of ordered)
      push(await toolResult(kernel, call.id, call.state, call.at, input.images), call.commit);
  };

  const calls = steps.flatMap((step) => (step.part?.partKind === "tool" ? [step.part.id] : []));

  for (const step of steps) {
    for (const compacted of anchors.get(step.commit) ?? []) {
      await flush();
      const summary = await readCompactionSummary(compacted);

      if (summary !== null)
        push({ role: "user", content: summary, timestamp: compacted.record.at }, compacted.commit);
    }

    const body = step.record.body;

    if (removed.has(step.commit) || body.kind === "compaction") continue;

    if (body.kind === "user") {
      await flush();
      push(
        {
          role: "user",
          content: await userContent(
            kernel,
            input.session,
            reportContent(body.source, body.content),
            input.images,
          ),
          timestamp: step.record.at,
        },
        step.commit,
      );
      continue;
    }

    const part = step.part;

    if (part === null) continue;

    if (
      part.partKind === "tool" &&
      calls.some((other) => other !== part.id && part.id.startsWith(`${other}:`))
    )
      continue;

    if (part.partKind === "text" || part.partKind === "thinking" || part.partKind === "tool") {
      const blocks = await assistantBlocks(part, step.record.run);
      const call = blocks.call;
      const response = call === null ? null : parseResponseIndex(call.call, step.record.run);

      if (
        group !== null &&
        (group.run !== step.record.run ||
          (call === null && group.calls.length > 0) ||
          (call !== null && group.response !== null && response !== group.response))
      )
        await flush();

      if (blocks.content.length === 0) continue;

      group ??= {
        commit: step.commit,
        run: step.record.run,
        model: step.model,
        at: step.record.at,
        response: null,
        content: [],
        calls: [],
      };

      if (call === null) {
        group.content.push(...blocks.content);
        continue;
      }

      group.response = response;
      group.calls.push({
        created: step.created,
        content: blocks.content,
        commit: step.commit,
        at: step.record.at,
        id: providerCallId(call.call, step.record.run),
        state: call,
      });
      continue;
    }

    await flush();
    const note = await renderPartFallback(kernel, part);

    if (note !== null)
      push({ role: "user", content: note, timestamp: step.record.at }, step.commit);
  }

  await flush();

  return messages;
}

async function assistantBlocks(
  part: PartRecord,
  run: RunId | null,
): Promise<{
  readonly content: AssistantMessage["content"];
  readonly call: Settled | null;
}> {
  if (part.partKind === "text") {
    const checked = await check(text.state, part.state);

    if (checked.kind === "invalid" || checked.value.markdown === "")
      return { content: [], call: null };
    const signature = checked.value.signature;

    return {
      content: [
        {
          type: "text",
          text: checked.value.markdown,
          ...(typeof signature === "string" ? { textSignature: signature } : {}),
        },
      ],
      call: null,
    };
  }

  if (part.partKind === "thinking") {
    const checked = await check(thinking.state, part.state);

    return checked.kind === "invalid"
      ? { content: [], call: null }
      : {
          content: reconstructThinkingContent(checked.value.markdown, checked.value.signature),
          call: null,
        };
  }

  const checked = await check(tool.state, part.state);

  if (checked.kind === "invalid" || checked.value.phase !== "settled")
    return { content: [], call: null };
  const settled = checked.value;

  return {
    content: [
      {
        type: "toolCall",
        id: providerCallId(settled.call, run),
        name: settled.name,
        arguments: isJsonObject(settled.args) ? { ...settled.args } : {},
      },
    ],
    call: settled,
  };
}

function reconstructThinkingContent(markdown: string, signature: Json | null): ThinkingContent[] {
  if (
    !Array.isArray(signature) ||
    !signature.every(
      (thought) =>
        isJsonObject(thought) &&
        typeof thought.length === "number" &&
        (thought.signature === null || typeof thought.signature === "string"),
    )
  )
    return markdown === "" ? [] : [{ type: "thinking", thinking: markdown }];

  let offset = 0;

  return signature.flatMap((thought): ThinkingContent[] => {
    if (!isJsonObject(thought) || typeof thought.length !== "number") return [];
    const content = markdown.slice(offset, offset + thought.length);
    offset += thought.length + THOUGHTS.length;

    return [
      {
        type: "thinking",
        thinking: content,
        ...(typeof thought.signature === "string" ? { thinkingSignature: thought.signature } : {}),
        ...(thought.redacted === true ? { redacted: true } : {}),
      },
    ];
  });
}

async function readCompactionSummary(step: Step): Promise<string | null> {
  if (step.part === null) return null;
  const checked = await check(compaction.state, step.part.state);

  if (checked.kind === "invalid" || checked.value.summary === null) return null;

  return `${SUMMARISED}\n\n${checked.value.summary}`;
}

async function renderPartFallback(kernel: Kernel, part: PartRecord): Promise<string | null> {
  if (part.partKind === branchSummary.kind) {
    const checked = await check(branchSummary.state, part.state);

    return checked.kind === "invalid" ? null : `${ABANDONED}\n\n${checked.value.markdown}`;
  }

  const definition = kernel.partDefinitions.get(part.partKind)?.definition;

  return definition === undefined ? null : definition.fallback(part.state, { id: part.id });
}

async function toolResult(
  kernel: Kernel,
  id: string,
  state: Settled,
  at: number,
  images: boolean,
): Promise<ToolResultMessage> {
  const outcome = state.outcome;

  const result = (
    content: (TextContent | ImageContent)[],
    isError: boolean,
  ): ToolResultMessage => ({
    role: "toolResult",
    toolCallId: id,
    toolName: state.name,
    content,
    isError,
    timestamp: at,
  });

  const said = (words: string): ToolResultMessage => result([{ type: "text", text: words }], true);

  switch (outcome.kind) {
    case "ok": {
      const content = await Promise.all(
        outcome.content.map((item): Promise<TextContent | ImageContent> =>
          item.kind === "text"
            ? Promise.resolve({ type: "text", text: item.text })
            : fileContent(kernel, item, images),
        ),
      );

      return result(
        content.length > 0
          ? content
          : [
              {
                type: "text",
                text: outcome.output === null ? "(no output)" : JSON.stringify(outcome.output),
              },
            ],
        false,
      );
    }

    case "failed":
      return said(`The tool failed: ${outcome.message}`);
    case "interrupted":
      return said("The tool call was interrupted before it finished and may have partly run.");
    case "rejected":
      return said(`The tool call was rejected: ${outcome.reason}`);
    case "stopped":
      return said("The tool call was stopped before it finished.");
  }
}

function reportContent(source: MessageSource, content: UserContent): UserContent {
  if (source.kind !== "child") return content;
  const title = `Child ${source.session} ${source.end}:`;

  if (typeof content !== "string") return [{ kind: "text", text: title }, ...content];

  return content === "" ? title : `${title}\n\n${content}`;
}

async function userContent(
  kernel: Kernel,
  session: SessionId,
  content: UserContent,
  images: boolean,
): Promise<UserMessage["content"]> {
  if (typeof content === "string") return content;

  return Promise.all(
    content.map((item): Promise<TextContent | ImageContent> => {
      switch (item.kind) {
        case "text":
          return Promise.resolve({ type: "text", text: item.text });
        case "file":
          return fileContent(kernel, item, images);
        case "reference":
          return referenceContent(kernel, session, item.path);
      }
    }),
  );
}

async function fileContent(
  kernel: Kernel,
  file: { readonly blob: BlobId; readonly mime: string; readonly name?: string },
  images: boolean,
): Promise<TextContent | ImageContent> {
  const name = file.name ?? file.blob;
  const image = images && file.mime.startsWith("image/");
  const cache = imageCache.get(kernel) ?? new Map<BlobId, string>();
  imageCache.set(kernel, cache);
  const cached = image ? cache.get(file.blob) : undefined;

  if (cached !== undefined) {
    cache.delete(file.blob);
    cache.set(file.blob, cached);

    return { type: "image", data: cached, mimeType: file.mime };
  }

  const reader = await kernel.store.objects.blob(file.blob);

  if (reader === null)
    return { type: "text", text: `[File ${name}, ${file.mime}: no longer stored]` };

  try {
    if (image) {
      const chunks: Uint8Array[] = [];

      for await (const chunk of reader.chunks()) chunks.push(chunk);
      const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
      let offset = 0;

      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const data = bytes.toBase64();
      cache.set(file.blob, data);
      let size = [...cache.values()].reduce((total, kept) => total + kept.length, 0);

      for (const [blob, kept] of cache) {
        if (size <= IMAGE_CACHE_CHARS) break;
        cache.delete(blob);
        size -= kept.length;
      }

      return { type: "image", data, mimeType: file.mime };
    }

    return {
      type: "text",
      text: `[File ${name}, ${reader.size === null ? "unknown size" : `${reader.size} bytes`}, ${file.mime}]`,
    };
  } finally {
    await reader.close();
  }
}

async function referenceContent(
  kernel: Kernel,
  session: SessionId,
  path: string,
): Promise<TextContent> {
  const document = await kernel
    .env(session)
    .then((env) => env.files.read(path))
    .catch(() => null);

  return document?.kind === "text"
    ? { type: "text", text: `<file path="${path}">\n${document.contents}\n</file>` }
    : { type: "text", text: `[Reference: ${path}]` };
}

function parseResponseIndex(call: string, run: RunId | null): string | null {
  if (run === null || !call.startsWith(`${run}:`)) return null;

  return /^(\d+):/.exec(call.slice(run.length + 1))?.[1] ?? null;
}

function providerCallId(call: string, run: RunId | null): string {
  if (run === null || !call.startsWith(`${run}:`)) return call;
  const rest = call.slice(run.length + 1);
  const counted = /^\d+:/.exec(rest);

  return counted === null ? rest : rest.slice(counted[0].length);
}

function resolveModelIdentity(models: Models, ref: ModelRef | null) {
  const model = ref === null ? undefined : models.getModel(ref.provider, ref.id);

  if (model !== undefined)
    return { api: model.api, provider: model.provider, model: model.variant?.base ?? model.id };

  return { api: "unknown", provider: ref?.provider ?? "unknown", model: ref?.id ?? "unknown" };
}
