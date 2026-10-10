import type { Models } from "@nyte-ai/ai";
import { estimateMessageTokens, estimateTextTokens } from "@nyte-ai/ai/utils/estimate";
import type {
  BlobId,
  CommitId,
  Configuration,
  HeadName,
  Json,
  ModelContext,
  ModelRef,
  PromptOverride,
  RunId,
  RunView,
  SessionId,
  ToolInfo,
  ToolPartState,
  Transcript,
  UserContent,
} from "@nyte-ai/schema";
import type {
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  ProviderCheckpointMaterial,
  TextContent,
  ThinkingContent,
  Tool,
  ToolResultMessage,
  UserMessage,
} from "@nyte-ai/schema/model";
import type { Resources } from "./environment.ts";
import { check } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import { branchSummary, compaction, text, thinking, tool } from "./parts.ts";
import type { PromptSection } from "./plugin.ts";
import { LOCAL } from "./principals.ts";
import type { CommitRecord, PartRecord } from "./records.ts";
import { START, isJsonObject, pathOf, requireSession, tipOf, withFold } from "./session-state.ts";
import type { ToolSource } from "./tool-runner.ts";

/** Returns one commit `buildContext` projects: its record, the part it names (null for a user commit) and its place in the fold's part creation order (-1 without a part), and the model of the run that wrote it. */
interface Step {
  readonly commit: CommitId;
  readonly record: CommitRecord;
  readonly part: PartRecord | null;
  readonly created: number;
  readonly model: ModelRef | null;
}

/** Returns the assistant message being assembled from a run of text, thinking and tool parts: its text and thinking blocks in commit order, its calls each with the settled result that follows the message and its place in creation order (response order, as the turn runs them), and the response its calls came from (the `${requests}` of their ids, §38w; null before its first call). */
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

/** Returns a settled tool part's state. */
type Settled = Extract<ToolPartState, { readonly phase: "settled" }>;

/** One merged thought from the next in a thinking part's markdown: a blank line. */
const THOUGHTS = "\n\n";

const SUMMARISED =
  "The earlier conversation was summarised to fit the context window. The summary:";

const ABANDONED =
  "The conversation moved back to an earlier point, abandoning a path. What that path did:";

const projections = new WeakMap<object, CommitId>();

/** Assembles what one request on a head sends, before `transform_context`. `system` is the prompt: a `replace` from the session record (`sessions.create({ prompt })`), else from the configuration's agent (`Agent.prompt`), is the whole prompt byte for byte; else a `Resources.prompt.system` (SYSTEM.md, project over user, as scanned) is the whole prompt with `Resources.prompt.append` after it; else the session's `prompt` registry sections plus a session `layer` (section id `session`) and an agent `layer` (section id `agent`), each at its order (default 100), sorted by order then id and rendered as `<NNNN-id>` blocks (`<0010-project-context>`, text, closing tag; order zero-padded to four digits), then `Resources.prompt.append` (APPEND_SYSTEM.md) when there is one. `messages` are the head's committed path from the fold, oldest first, plus `run`'s settled parts not yet on it; pending inputs, live parts and failed parts are left out. A user message becomes a `UserMessage`: text as text; a `file` the model takes (`ModelInfo.input` of `configuration.model` has `image` and the mime is an image) as image content read from the blob store, any other file as a text reference naming it, its size and mime; a `reference` read through the session environment's files at this request (`kernel.env`), text inline under its path, anything else or an unreadable path as a text reference. A run of text, thinking and tool parts from one response becomes one `AssistantMessage` (`api`, `provider` and `model` the provider identity of the run's model, a fast sibling recorded as its base, zero usage, `stopReason` `toolUse` when it holds calls, else `stop`), a text or thinking part after a tool part, or a tool part whose call id names another response (§38w), starting the next one: text as text with its `signature` (§38f) as the content's `textSignature`; thinking split back into one block per merged thought by its `signature`'s lengths, each with its own `thinkingSignature` and `redacted`, or one unsigned block when the signature is null; a tool part as its `toolCall` (id the provider's call id, the call id without its `${run}:${requests}:` namespace, §38w; its name and args; a call nested under another, `<call>:<key>`, is the parent's business and left out), after the message's text and thinking and in response order, which is the order their parts were created since the turn runs a response's calls in order (§38k), not the order they settled, so a parked first call stays first; each tool part then yields a `ToolResultMessage` after its assistant message, in the same order, from its settled outcome (`ok` content as text and images, filtered by `ModelInfo.input` like user files; `failed`, `interrupted`, `rejected` and `stopped` as text saying so, `isError` set). A compaction part's commit removes the commits it `replaces` and puts its summary, as a user message saying the earlier conversation was summarised, where the first of them stood (a material-only compaction puts nothing; `providerContext` carries its `{ provider, api, model, data }` material, §38e). A branch summary part is a user message saying what the abandoned path did. Any other part is a user message with its definition's `fallback` text, re-projected from its current state; a part whose kind this host does not know is left out. */
export async function buildContext(
  kernel: Kernel,
  models: Models,
  session: SessionId,
  head: HeadName,
  run: RunView | null,
  configuration: Configuration,
): Promise<ModelContext> {
  const found = await requireSession(kernel, session);
  const registries = kernel.pluginsFor(session).registries;

  const agent =
    configuration.agent === null
      ? undefined
      : registries.agents.list().find((entry) => entry.id === configuration.agent);

  const resources = await kernel.resources(session).catch(() => null);
  const model = models.getModel(configuration.model.provider, configuration.model.id);

  return {
    system: systemOf(
      found.record.prompt,
      agent?.prompt ?? null,
      resources,
      registries.prompt.list(),
    ),
    messages: await conversation(kernel, models, {
      session,
      head,
      run: run?.id ?? null,
      images: model?.input.includes("image") === true,
    }),
  };
}

/** Returns the request body `transform_transcript` receives after `transform_context`: `messages` the context's system prompt as one leading `SystemMessage` (none when empty), then its messages; `tools` the given tools the model may call (`exposure` `model`; a deferred tool the run activated is listed as `model` already), in the order given. */
export function transcriptOf(
  kernel: Kernel,
  session: SessionId,
  context: ModelContext,
  tools: readonly ToolInfo[],
): Transcript {
  const system: readonly Message[] =
    context.system === "" ? [] : [{ role: "system", content: context.system, timestamp: 0 }];

  return {
    messages: [...system, ...context.messages],
    tools: tools.filter((info) => info.exposure === "model"),
  };
}

/** Returns an estimate of a request body's tokens: `estimateMessageTokens` from `@nyte-ai/ai/utils/estimate` over each message, the leading system message included (§38m; characters / 4, images at a fixed size), plus `estimateTextTokens` over each tool's name, description and JSON Schema. What the compaction threshold and `ContextView.tokens` compare before a provider reports. */
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

/** Returns the commit `buildContext` projected a message from, by identity (each message it builds is remembered in a per-process weak map): a user commit's message, a part commit's assistant or tool result message, a compaction commit's summary. Null for a message a transform made or replaced. What compaction maps its split back to commits with. An assistant message built from several part commits projects from the first of them. */
export function projectedCommit(message: Transcript["messages"][number]): CommitId | null {
  return projections.get(message) ?? null;
}

/** Lowers a transcript to ai's request `Context`: its leading system message carries the tools as `toolsAdded` (`Context.tools` would add a second leading message), each `ToolInfo` as a `Tool` with its JSON Schema `parameters` and, when the tool's definition (`source.get(name)`) has a `grammar`, `constrainedSampling` of kind `grammar` with the `openai_lark` or `openai_regex` variant; the rest of the messages follow as they are; `checkpoint` is set when given: the caller passes the head's latest compaction `material` as `{ type: "provider", provider, api, model, data }` when its provider, api and model equal the request model's provider identity (§38e), else null. */
export function providerContext(
  transcript: Transcript,
  source: ToolSource,
  checkpoint: ProviderCheckpointMaterial | null,
): Context {
  const tools = transcript.tools.map((info): Tool => {
    const grammar = source.get(info.name)?.definition.grammar;

    const declared: Tool = {
      name: info.name,
      description: info.description,
      parameters: info.parameters,
    };

    if (grammar === undefined) return declared;

    return {
      ...declared,
      constrainedSampling: {
        type: "grammar",
        variants:
          grammar.kind === "lark"
            ? { openai_lark: grammar.source }
            : { openai_regex: grammar.pattern },
      },
    };
  });

  const [first, ...rest] = transcript.messages;

  const messages: Message[] =
    tools.length === 0
      ? [...transcript.messages]
      : first?.role === "system"
        ? [{ ...first, toolsAdded: [...(first.toolsAdded ?? []), ...tools] }, ...rest]
        : [
            { role: "system", content: "", toolsAdded: tools, timestamp: 0 },
            ...transcript.messages,
          ];

  return checkpoint === null ? { messages } : { messages, checkpoint };
}

/** Builds the request body one pass sends on a head, in the baseline's hook order (§38s): `buildContext`, `transform_context`, the tools of the run (`kernel.tools(session, run)`, narrowed to the configuration's agent's `tools` when it names some), `transcriptOf`, then `transform_transcript`. Returns it with the tool source the request lowers through. What the turn, compaction and the manual compactor build a request from. */
export async function requestBody(
  kernel: Kernel,
  models: Models,
  session: SessionId,
  head: HeadName,
  run: RunView | null,
  configuration: Configuration,
): Promise<{ readonly transcript: Transcript; readonly source: ToolSource }> {
  const runtime = kernel.pluginsFor(session);
  const where = { session, head, run: run?.id ?? null, principal: LOCAL };

  const context = await runtime.hooks.transform(
    "transform_context",
    await buildContext(kernel, models, session, head, run, configuration),
    where,
  );

  const source = kernel.tools(session, run?.id ?? null);

  const named =
    configuration.agent === null
      ? undefined
      : runtime.registries.agents.list().find((agent) => agent.id === configuration.agent)?.tools;

  const tools =
    named === undefined ? source.list() : source.list().filter((info) => named.includes(info.name));

  return {
    transcript: await runtime.hooks.transform(
      "transform_transcript",
      transcriptOf(kernel, session, context, tools),
      where,
    ),
    source,
  };
}

/** Returns the system prompt: a session or agent `replace` whole, else a scanned SYSTEM.md, else the sections rendered in order; then APPEND_SYSTEM.md. */
function systemOf(
  own: PromptOverride | null,
  agent: PromptOverride | null,
  resources: Resources | null,
  sections: readonly PromptSection[],
): string {
  if (own?.kind === "replace") return own.text;

  if (agent?.kind === "replace") return agent.text;

  const body =
    resources?.prompt.system ??
    [...sections, ...layerOf("session", own), ...layerOf("agent", agent)]
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

  return [body, resources?.prompt.append ?? null]
    .filter((part): part is string => part !== null && part !== "")
    .join("\n\n");
}

/** Returns a `layer` override as the section it adds under `id`, or none. */
function layerOf(id: string, override: PromptOverride | null): readonly PromptSection[] {
  return override?.kind === "layer" ? [{ id, text: override.text, order: override.order }] : [];
}

/** Returns a head's committed path as model messages, compactions applied. */
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
    const path = pathOf(state.commits, tipOf(state.heads.get(input.head)?.info.tip ?? START));
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
      const identity = identityOf(models, current.model);

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
      const summary = await summaryOf(compacted);

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
          content: await userContent(kernel, input.session, body.content, input.images),
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
      const response = call === null ? null : responseOf(call.call, step.record.run);

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
    const note = await noteOf(kernel, part);

    if (note !== null)
      push({ role: "user", content: note, timestamp: step.record.at }, step.commit);
  }

  await flush();

  return messages;
}

/** Returns the assistant content a text, thinking or settled tool part contributes, and the settled call for a tool part. */
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
      : { content: thoughtsOf(checked.value.markdown, checked.value.signature), call: null };
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

/** Returns a thinking part's markdown split back into its merged thoughts by the lengths its signature recorded, each with its provider signature; one unsigned block without a signature. */
function thoughtsOf(markdown: string, signature: Json | null): ThinkingContent[] {
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

/** Returns the user message a compaction commit leaves: its summary, or null for a material-only compaction. */
async function summaryOf(step: Step): Promise<string | null> {
  if (step.part === null) return null;
  const checked = await check(compaction.state, step.part.state);

  if (checked.kind === "invalid" || checked.value.summary === null) return null;

  return `${SUMMARISED}\n\n${checked.value.summary}`;
}

/** Returns the user message any other part leaves: what an abandoned path did for a branch summary, else its definition's fallback; null for a kind this host does not know. */
async function noteOf(kernel: Kernel, part: PartRecord): Promise<string | null> {
  if (part.partKind === branchSummary.kind) {
    const checked = await check(branchSummary.state, part.state);

    return checked.kind === "invalid" ? null : `${ABANDONED}\n\n${checked.value.markdown}`;
  }

  const definition = kernel.partDefinitions.get(part.partKind)?.definition;

  return definition === undefined ? null : definition.fallback(part.state, { id: part.id });
}

/** Returns a settled call's outcome as the tool result the model reads. */
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

/** Returns user content as the model reads it. */
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

/** Returns a file as image content when the model takes images and it is one, else as a text reference naming it, its size and mime. */
async function fileContent(
  kernel: Kernel,
  file: { readonly blob: BlobId; readonly mime: string; readonly name?: string },
  images: boolean,
): Promise<TextContent | ImageContent> {
  const name = file.name ?? file.blob;
  const reader = await kernel.store.objects.blob(file.blob);

  if (reader === null)
    return { type: "text", text: `[File ${name}, ${file.mime}: no longer stored]` };

  try {
    if (images && file.mime.startsWith("image/")) {
      const chunks: Uint8Array[] = [];

      for await (const chunk of reader.chunks()) chunks.push(chunk);
      const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
      let offset = 0;

      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return { type: "image", data: bytes.toBase64(), mimeType: file.mime };
    }

    return {
      type: "text",
      text: `[File ${name}, ${reader.size === null ? "unknown size" : `${reader.size} bytes`}, ${file.mime}]`,
    };
  } finally {
    await reader.close();
  }
}

/** Returns a referenced path read through the session's environment now: its text inline under its path, or a text reference when it is not text or cannot be read. */
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

/** Returns the response a call came from: the `${requests}` of its `${run}:${requests}:` namespace (§38w), or null for an id without one. */
function responseOf(call: string, run: RunId | null): string | null {
  if (run === null || !call.startsWith(`${run}:`)) return null;

  return /^(\d+):/.exec(call.slice(run.length + 1))?.[1] ?? null;
}

/** Returns the id the provider gave a call: its call id without the `${run}:${requests}:` namespace the turn adds (§38w), so a replay sends the provider its own id. */
function providerCallId(call: string, run: RunId | null): string {
  if (run === null || !call.startsWith(`${run}:`)) return call;
  const rest = call.slice(run.length + 1);
  const counted = /^\d+:/.exec(rest);

  return counted === null ? rest : rest.slice(counted[0].length);
}

/** Returns the provider identity history records a run's model under: a fast sibling as its base. */
function identityOf(
  models: Models,
  ref: ModelRef | null,
): { readonly api: string; readonly provider: string; readonly model: string } {
  const model = ref === null ? undefined : models.getModel(ref.provider, ref.id);

  if (model !== undefined)
    return { api: model.api, provider: model.provider, model: model.variant?.base ?? model.id };

  return { api: "unknown", provider: ref?.provider ?? "unknown", model: ref?.id ?? "unknown" };
}
