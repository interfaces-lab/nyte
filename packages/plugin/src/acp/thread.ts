import type {
  ContentBlock,
  CreateElicitationResponse,
  PermissionOption,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  ToolCallContent,
  ToolCallStatus,
  SubagentUpdate,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk/unstable";
import { posix } from "node:path";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { Api, AssistantMessageEventStream, Model, StopReason } from "@nyte-ai/ai";
import type { RuntimeCall, RuntimeVerdict } from "@nyte-ai/core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  agentUsage,
  emptyMessage,
  MIRROR_TOOL,
  mirrorClass,
  toolText,
  Translator,
} from "./translate.ts";
import type { MirrorArguments } from "./translate.ts";
import type { Dialect, SubagentReport } from "./dialects.ts";
import { readForm } from "./forms.ts";
import type { AgentForm, FormRequest } from "./forms.ts";

type Recording = "recording" | "skipped";

export type AcpApprove = (call: RuntimeCall, signal: AbortSignal) => Promise<RuntimeVerdict>;

type ThreadEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "tool"; readonly id: string }
  | { readonly kind: "stop"; readonly response: PromptResponse }
  | { readonly kind: "aborted" };

interface Subagent {
  status: SubagentReport["status"];
  result: string | undefined;
  message: string;
  activity: string | undefined;
}

interface ToolState {
  title: string;
  kind: string;
  status: ToolCallStatus;
  input: Record<string, unknown>;
  paths: string[];
  content: ToolCallContent[];
  rawOutput: unknown;
  subagent: Subagent | undefined;
}

export interface AcpToolOutput {
  readonly text: string;
  readonly failed: boolean;
}

export interface AcpChannel {
  readonly cwd: string;
  readonly dialect: Dialect;
  prompt(blocks: readonly ContentBlock[]): Promise<PromptResponse>;
  cancel(): void;
  readonly approve: AcpApprove;
  /** Asks Nyte for a run to show a reply the agent started with no prompt open. */
  wake(): void;
}

const UNPROMPTED_END: ThreadEvent = { kind: "stop", response: { stopReason: "end_turn" } };

class Inbox<T> {
  readonly #items: T[] = [];
  #waiter: (() => void) | undefined;
  #ended = false;

  push(item: T): void {
    this.#items.push(item);
    this.#wake();
  }

  end(): void {
    this.#ended = true;
    this.#wake();
  }

  async next(): Promise<T | undefined> {
    while (this.#items.length === 0 && !this.#ended)
      await new Promise<void>((resolve) => (this.#waiter = resolve));

    return this.#items.shift();
  }

  #wake(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}

const input = Type.Record(Type.String(), Type.Unknown());

function answer(
  choice: "allow" | "reject" | "cancelled",
  options: readonly PermissionOption[],
): RequestPermissionResponse {
  const kinds =
    choice === "allow"
      ? ["allow_once"]
      : choice === "reject"
        ? ["reject_once", "reject_always"]
        : [];

  const option = kinds.flatMap((kind) => options.filter((entry) => entry.kind === kind))[0];

  return option === undefined
    ? { outcome: { outcome: "cancelled" } }
    : { outcome: { outcome: "selected", optionId: option.optionId } };
}

function emptyTool(): ToolState {
  return {
    title: "Tool",
    kind: "other",
    status: "pending",
    input: {},
    paths: [],
    content: [],
    rawOutput: undefined,
    subagent: undefined,
  };
}

function readSubagentUpdate(update: SubagentUpdate): SubagentReport {
  const report = { child: update.sessionId, title: update.title ?? undefined };
  const state = update.state;

  if (state?.state !== "idle" || !("stopReason" in state)) return { ...report, status: "running" };
  const failed = state.stopReason === "error" || state.stopReason === "refusal";

  return { ...report, status: failed ? "failed" : "completed" };
}

function guardedFirst(cwd: string, paths: readonly string[]): string[] {
  const root = posix.resolve(cwd);

  const inside = (path: string): boolean => {
    const target = posix.resolve(root, path);

    return target === root || target.startsWith(`${root}/`);
  };

  return [...paths.filter((path) => !inside(path)), ...paths.filter(inside)];
}

function stopReason(
  response: PromptResponse,
): Extract<StopReason, "stop" | "length" | "error" | "aborted"> {
  switch (response.stopReason) {
    case "max_tokens":
    case "max_turn_requests":
      return "length";
    case "refusal":
      return "error";
    case "cancelled":
      return "aborted";
    default:
      return "stop";
  }
}

export class AcpThread {
  readonly prefix: string;
  /** The agent's id for this conversation, which `session/resume` takes back. */
  readonly session: string;
  readonly #channel: AcpChannel;
  readonly #events = new Inbox<ThreadEvent>();
  readonly #tools = new Map<string, ToolState>();
  readonly #subagentTools = new Map<string, string>();
  readonly #subagentCalls = new Map<string, ToolState>();
  readonly #permissions = new Map<string, AbortController>();
  readonly #subagentApprovals = new Set<AbortController>();
  readonly #pendingForms = new Map<
    string,
    { readonly form: AgentForm; readonly reply: PromiseWithResolvers<CreateElicitationResponse> }
  >();
  readonly #recordings = new Map<string, PromiseWithResolvers<Recording>>();
  readonly #changes = new Set<() => void>();
  readonly #queue: (readonly ContentBlock[])[] = [];
  #running = false;
  private waking = false;
  private context: number | undefined;
  #failure: Error | undefined;

  constructor(prefix: string, session: string, channel: AcpChannel) {
    this.prefix = prefix;
    this.session = session;
    this.#channel = channel;
  }

  get closed(): boolean {
    return this.#failure !== undefined;
  }

  /** Called by the run a wake started: it reads the unprompted reply, or ends at once when a prompt took the reply over. */
  drainWake(): void {
    if (!this.waking) this.#events.push(UNPROMPTED_END);
  }

  send(blocks: readonly ContentBlock[]): void {
    if (this.#running) this.#queue.push(blocks);
    else this.#start(blocks);
  }

  update(update: SessionUpdate, subagent?: string): void {
    if (update.sessionUpdate === "subagent_update")
      this.#recordSubagent(readSubagentUpdate(update));
    else if (subagent !== undefined) this.#applySubagentUpdate(subagent, update);
    else this.#applyOwnUpdate(update);

    this.#changed();
  }

  async askForm(request: FormRequest): Promise<CreateElicitationResponse> {
    if (this.#failure !== undefined) return { action: "cancel" };
    const id = `ask-${this.#tools.size}`;
    const form = readForm(request);
    const reply = Promise.withResolvers<CreateElicitationResponse>();
    this.#pendingForms.set(id, { form, reply });
    const title = form.questions.map((item) => item.header).join(", ");
    this.#tools.set(id, { ...emptyTool(), title, kind: "question" });
    this.#events.push({ kind: "tool", id });
    this.#changed();

    try {
      return await reply.promise;
    } finally {
      this.#pendingForms.delete(id);
    }
  }

  findForm(id: string): AgentForm | undefined {
    return this.#pendingForms.get(id)?.form;
  }

  answerForm(id: string, response: CreateElicitationResponse): void {
    const tool = this.#tools.get(id);

    if (tool !== undefined) tool.status = response.action === "accept" ? "completed" : "failed";
    this.#pendingForms.get(id)?.reply.resolve(response);
    this.#changed();
  }

  reportSubagent(report: SubagentReport): void {
    this.#recordSubagent(report);
    this.#changed();
  }

  #applyOwnUpdate(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text")
          this.#events.push({ kind: "text", text: update.content.text });
        break;
      case "agent_thought_chunk":
        if (update.content.type === "text")
          this.#events.push({ kind: "thinking", text: update.content.text });
        break;
      case "tool_call":
      case "tool_call_update":
        this.#see(update);
        break;
      case "usage_update":
        this.context = update.used;

        if (this.waking && !this.#running) {
          this.waking = false;
          this.#events.push(UNPROMPTED_END);
        }

        return;
      default:
        return;
    }

    if (update.sessionUpdate !== "tool_call_update") this.noticeUnprompted();
  }

  private noticeUnprompted(): void {
    if (!this.#channel.dialect.repliesUnprompted || this.#running || this.waking) return;
    this.waking = true;
    this.#channel.wake();
  }

  async permission(
    request: RequestPermissionRequest,
    subagent?: string,
  ): Promise<RequestPermissionResponse> {
    const id = request.toolCall.toolCallId;
    const options = this.#channel.dialect.filterPermissionOptions(request.options);

    if (subagent !== undefined || this.#subagentCalls.has(id))
      return this.#approveSubagentCall(request, options);
    this.#see(request.toolCall);
    this.noticeUnprompted();

    if (this.#failure !== undefined) return answer("cancelled", options);
    const asking = new AbortController();
    this.#permissions.set(id, asking);
    this.#changed();

    try {
      const recorded = await Promise.race([
        this.#recording(id).promise,
        new Promise<"cancelled">((resolve) =>
          asking.signal.addEventListener("abort", () => resolve("cancelled"), { once: true }),
        ),
      ]);

      if (recorded !== "recording")
        return answer(recorded === "skipped" ? "reject" : "cancelled", options);
      const args = this.#arguments(id);
      const name = args.kind === "other" ? args.title : args.kind;
      const verdict = await this.#channel.approve(
        { name, class: mirrorClass(args) },
        asking.signal,
      );

      if (asking.signal.aborted) return answer("cancelled", options);

      return answer(verdict.kind === "allow" ? "allow" : "reject", options);
    } finally {
      this.#permissions.delete(id);
      this.#changed();
    }
  }

  async #approveSubagentCall(
    request: RequestPermissionRequest,
    options: readonly PermissionOption[],
  ): Promise<RequestPermissionResponse> {
    if (this.#failure !== undefined) return answer("cancelled", options);
    const tool = this.#applyToolUpdate(
      this.#subagentCalls.get(request.toolCall.toolCallId) ?? emptyTool(),
      request.toolCall,
    );
    this.#subagentCalls.set(request.toolCall.toolCallId, tool);
    const asking = new AbortController();
    this.#subagentApprovals.add(asking);

    try {
      const args = this.#arguments(request.toolCall.toolCallId, tool);
      const verdict = await this.#channel.approve(
        { name: args.kind === "other" ? args.title : args.kind, class: mirrorClass(args) },
        asking.signal,
      );

      if (asking.signal.aborted) return answer("cancelled", options);

      return answer(verdict.kind === "allow" ? "allow" : "reject", options);
    } finally {
      this.#subagentApprovals.delete(asking);
    }
  }

  recording(id: string): void {
    this.#recording(id).resolve("recording");
  }

  skip(id: string): void {
    if (this.#pendingForms.has(id)) this.answerForm(id, { action: "decline" });

    if (this.#tools.has(id)) this.#recording(id).resolve("skipped");
  }

  respond(
    model: Model<Api>,
    signal: AbortSignal | undefined,
    tools = true,
  ): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();
    const output = emptyMessage(model);
    const translator = new Translator(model, output, stream);

    const abort = () => {
      this.cancel();
      this.#events.push({ kind: "aborted" });
    };

    signal?.addEventListener("abort", abort, { once: true });

    void (async () => {
      try {
        stream.push({ type: "start", partial: output });
        let reason: "toolUse" | "stop" | "length" | undefined;

        while (reason === undefined) {
          const event = await this.#events.next();

          if (event === undefined) throw this.#failure ?? new Error("The agent stopped.");

          if (event.kind === "aborted") throw new Error("Request was aborted");

          if (event.kind === "text") translator.text(event.text);
          else if (event.kind === "thinking") translator.thinking(event.text);
          else if (event.kind === "tool" && !tools) this.skip(event.id);
          else if (event.kind === "tool") {
            translator.call(this.#mirror(event.id));
            reason = "toolUse";
          } else {
            translator.end();

            if (this.context !== undefined) translator.context(this.context);
            else if (Value.Check(agentUsage, event.response.usage))
              translator.usage(event.response.usage);
            output.rawStopReason = event.response.stopReason;
            const mapped = stopReason(event.response);

            if (mapped === "aborted") throw new Error("Request was aborted");

            if (mapped === "error") throw new Error("The agent refused to complete the request.");
            reason = mapped;
          }
        }

        output.stopReason = reason;
        stream.push({ type: "done", reason, message: output });
      } catch (error) {
        output.stopReason = signal?.aborted === true ? "aborted" : "error";
        output.errorMessage = error instanceof Error ? error.message : String(error);
        stream.push({ type: "error", reason: output.stopReason, error: output });
      } finally {
        signal?.removeEventListener("abort", abort);
        stream.end();
      }
    })();

    return stream;
  }

  async result(
    id: string,
    signal: AbortSignal,
    onProgress: (text: string) => void = () => undefined,
  ): Promise<AcpToolOutput> {
    const settled = () => {
      const tool = this.#tools.get(id);
      const finished =
        tool?.subagent === undefined
          ? tool?.status === "completed" || tool?.status === "failed"
          : tool.subagent.status !== "running";

      return (
        finished || !this.#running || [...this.#permissions.keys()].some((other) => other !== id)
      );
    };

    let lastProgress: string | undefined;

    while (!settled() && this.#failure === undefined) {
      const activity = this.#tools.get(id)?.subagent?.activity;

      if (activity !== undefined && activity !== lastProgress) {
        lastProgress = activity;
        onProgress(activity);
      }

      if (signal.aborted) {
        this.cancel();
        signal.throwIfAborted();
      }

      await new Promise<void>((resolve) => {
        const done = () => {
          this.#changes.delete(done);
          signal.removeEventListener("abort", done);
          resolve();
        };

        this.#changes.add(done);
        signal.addEventListener("abort", done, { once: true });
      });
    }

    const tool = this.#tools.get(id);

    if (tool === undefined) throw this.#failure ?? new Error("The agent did not report this call.");
    const subagent = tool.subagent;

    if (subagent !== undefined) {
      return {
        text:
          subagent.result ?? (subagent.message.trim() || toolText(tool.content, tool.rawOutput)),
        failed: subagent.status === "failed",
      };
    }

    return { text: toolText(tool.content, tool.rawOutput), failed: tool.status === "failed" };
  }

  cancel(): void {
    this.#queue.length = 0;
    this.waking = false;

    for (const asking of [...this.#permissions.values(), ...this.#subagentApprovals]) {
      asking.abort();
    }

    for (const pending of this.#pendingForms.values()) {
      pending.reply.resolve({ action: "cancel" });
    }

    if (this.#running) this.#channel.cancel();
  }

  close(reason: Error = new Error("The agent's session closed.")): void {
    if (this.#failure !== undefined) return;
    this.cancel();
    this.#failure = reason;
    this.#events.end();
    this.#changed();
  }

  #start(blocks: readonly ContentBlock[]): void {
    this.#running = true;
    this.waking = false;

    this.#channel.prompt(blocks).then(
      (response) => {
        const next = response.stopReason === "cancelled" ? undefined : this.#queue.shift();

        if (next !== undefined) {
          this.#start(next);

          return;
        }

        this.#running = false;
        this.#events.push({ kind: "stop", response });
        this.#changed();
      },
      (error: unknown) => {
        this.#running = false;
        this.close(error instanceof Error ? error : new Error(String(error)));
      },
    );
  }

  #see(update: ToolCallUpdate): void {
    const id = update.toolCallId;
    const report = this.#channel.dialect.readSubagent(update);
    const owner = report === undefined ? undefined : this.#subagentTools.get(report.child);

    if (report !== undefined && owner !== undefined && owner !== id) {
      this.#subagentCalls.set(
        id,
        this.#applyToolUpdate(this.#subagentCalls.get(id) ?? emptyTool(), update),
      );
      this.#recordSubagent(report);

      return;
    }

    const known = this.#tools.get(id);
    const tool = this.#applyToolUpdate(known ?? emptyTool(), update);

    if (known === undefined) this.#tools.set(id, tool);

    if (report !== undefined) this.#recordSubagent(report, id);

    if (known === undefined) this.#events.push({ kind: "tool", id });
  }

  #applyToolUpdate(tool: ToolState, update: ToolCallUpdate): ToolState {
    tool.title = this.#channel.dialect.readTitle(update) ?? update.title ?? tool.title;
    tool.kind = tool.subagent === undefined ? (update.kind ?? tool.kind) : "subagent";
    tool.status = update.status ?? tool.status;
    tool.input = Value.Check(input, update.rawInput) ? update.rawInput : tool.input;
    tool.paths = update.locations?.map((location) => location.path) ?? tool.paths;
    tool.content = update.content ?? tool.content;
    tool.rawOutput = update.rawOutput ?? tool.rawOutput;

    return tool;
  }

  #recordSubagent(report: SubagentReport, carrier?: string): Subagent {
    const id = this.#subagentTools.get(report.child) ?? carrier ?? `subagent-${report.child}`;
    this.#subagentTools.set(report.child, id);
    const known = this.#tools.get(id);
    const tool = known ?? { ...emptyTool(), title: "Subagent" };
    const subagent = tool.subagent ?? {
      status: report.status,
      result: undefined,
      message: "",
      activity: undefined,
    };

    subagent.status = report.status;
    subagent.result = report.result ?? subagent.result;
    tool.subagent = subagent;
    tool.kind = "subagent";
    tool.title = report.title ?? (tool.title === "Tool" ? "Subagent" : tool.title);

    if (known === undefined) {
      this.#tools.set(id, tool);
      this.#events.push({ kind: "tool", id });
    }

    return subagent;
  }

  #applySubagentUpdate(child: string, update: SessionUpdate): void {
    const known = this.#subagentTools.get(child);
    const subagent =
      (known === undefined ? undefined : this.#tools.get(known)?.subagent) ??
      this.#recordSubagent({ child, status: "running" });

    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      subagent.message += update.content.text;

      return;
    }

    if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return;
    const tool = this.#applyToolUpdate(
      this.#subagentCalls.get(update.toolCallId) ?? emptyTool(),
      update,
    );
    this.#subagentCalls.set(update.toolCallId, tool);
    subagent.activity = tool.title;
  }

  #arguments(id: string, tool = this.#tools.get(id)): MirrorArguments {
    return {
      thread: this.prefix,
      id,
      title: tool?.title ?? "Tool",
      kind: tool?.kind ?? "other",
      input: tool?.input ?? {},
      paths: guardedFirst(this.#channel.cwd, tool?.paths ?? []),
    };
  }

  #mirror(id: string) {
    return {
      type: "toolCall",
      id: `${this.prefix}${id}`,
      name: MIRROR_TOOL,
      arguments: this.#arguments(id),
    } as const;
  }

  #recording(id: string): PromiseWithResolvers<Recording> {
    const known = this.#recordings.get(id);

    if (known !== undefined) return known;
    const created = Promise.withResolvers<Recording>();
    this.#recordings.set(id, created);

    return created;
  }

  #changed(): void {
    for (const change of this.#changes) change();
  }
}
