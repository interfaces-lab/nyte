import type {
  ContentBlock,
  PermissionOption,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  ToolCallContent,
  ToolCallStatus,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { Api, AssistantMessageEventStream, Model, StopReason } from "@nyte-ai/ai";
import type { RuntimeCall, RuntimeVerdict } from "@nyte-ai/core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { emptyMessage, MIRROR_TOOL, mirrorClass, toolText, Translator } from "./translate.ts";
import type { MirrorArguments } from "./translate.ts";

/** Where Nyte is with one of the agent's calls: recording it (its mirror runs), or done with it without running it. */
type Recording = "recording" | "skipped";

/** Decides a call the agent asks permission for, under the session's policy. */
export type AcpApprove = (call: RuntimeCall, signal: AbortSignal) => Promise<RuntimeVerdict>;

type ThreadEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "tool"; readonly id: string }
  | { readonly kind: "stop"; readonly response: PromptResponse }
  | { readonly kind: "aborted" };

interface ToolState {
  title: string;
  kind: string;
  status: ToolCallStatus;
  input: Record<string, unknown>;
  paths: string[];
  content: ToolCallContent[];
  rawOutput: unknown;
}

/** What one of the agent's tool calls reported once it finished, or as far as it got when the turn ended. */
export interface AcpToolOutput {
  readonly text: string;
  readonly failed: boolean;
}

/** How a thread reaches its agent: one prompt turn, the cancel notification for it, and how a permission it asks for is decided. */
export interface AcpChannel {
  prompt(blocks: readonly ContentBlock[]): Promise<PromptResponse>;
  cancel(): void;
  readonly approve: AcpApprove;
}

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
      ? ["allow_once", "allow_always"]
      : choice === "reject"
        ? ["reject_once", "reject_always"]
        : [];

  const option = kinds.flatMap((kind) => options.filter((entry) => entry.kind === kind))[0];

  return option === undefined
    ? { outcome: { outcome: "cancelled" } }
    : { outcome: { outcome: "selected", optionId: option.optionId } };
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

/**
 * One ACP session on an agent: the prompt turns Nyte sends it, the updates
 * it streams back as assistant messages, and its tool calls, which Nyte
 * records as mirror calls whose ids start with `prefix`. A permission the
 * agent asks for waits until Nyte records that call, then goes to the
 * channel's `approve` under the call's ACP kind; a call Nyte skips is
 * refused.
 */
export class AcpThread {
  readonly prefix: string;
  readonly #channel: AcpChannel;
  readonly #events = new Inbox<ThreadEvent>();
  readonly #tools = new Map<string, ToolState>();
  readonly #permissions = new Map<string, AbortController>();
  readonly #recordings = new Map<string, PromiseWithResolvers<Recording>>();
  readonly #changes = new Set<() => void>();
  readonly #queue: (readonly ContentBlock[])[] = [];
  #running = false;
  #failure: Error | undefined;

  constructor(prefix: string, channel: AcpChannel) {
    this.prefix = prefix;
    this.#channel = channel;
  }

  get closed(): boolean {
    return this.#failure !== undefined;
  }

  /** Sends a prompt turn, or queues it behind the turn the agent is running, since ACP takes no message mid-turn. */
  send(blocks: readonly ContentBlock[]): void {
    if (this.#running) this.#queue.push(blocks);
    else this.#start(blocks);
  }

  update(update: SessionUpdate): void {
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
      default:
        break;
    }

    this.#changed();
  }

  async permission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const id = request.toolCall.toolCallId;
    this.#see(request.toolCall);

    if (this.#failure !== undefined) return answer("cancelled", request.options);
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
        return answer(recorded === "skipped" ? "reject" : "cancelled", request.options);
      const args = this.#arguments(id);
      const name = args.kind === "other" ? args.title : args.kind;
      const verdict = await this.#channel.approve(
        { name, class: mirrorClass(args) },
        asking.signal,
      );

      if (asking.signal.aborted) return answer("cancelled", request.options);

      return answer(verdict.kind === "allow" ? "allow" : "reject", request.options);
    } finally {
      this.#permissions.delete(id);
      this.#changed();
    }
  }

  /** Lets the agent's permission ask for `id`, now or later, go on to its approval: Nyte is recording the call. */
  recording(id: string): void {
    this.#recording(id).resolve("recording");
  }

  /** Refuses `id` when the agent asks, now or later: Nyte settled it without running it. A call this thread never saw is left alone. */
  skip(id: string): void {
    if (this.#tools.has(id)) this.#recording(id).resolve("skipped");
  }

  /** Streams the turn as one assistant message, ending at the agent's next new tool call or at the turn's end; with `tools` false, its tool calls are refused and skipped. */
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

            if (event.response.usage !== undefined && event.response.usage !== null)
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

  /** Waits for the agent to finish tool call `id`: until it completes or fails, the turn ends, or the agent waits on another call's permission. */
  async result(id: string, signal: AbortSignal): Promise<AcpToolOutput> {
    const settled = () => {
      const status = this.#tools.get(id)?.status;

      return (
        status === "completed" ||
        status === "failed" ||
        !this.#running ||
        [...this.#permissions.keys()].some((other) => other !== id)
      );
    };

    while (!settled() && this.#failure === undefined) {
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

    return { text: toolText(tool.content, tool.rawOutput), failed: tool.status === "failed" };
  }

  /** Stops the running turn: tells the agent, and answers its waiting permissions as cancelled. */
  cancel(): void {
    this.#queue.length = 0;

    for (const asking of this.#permissions.values()) asking.abort();

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
    const known = this.#tools.get(update.toolCallId);

    const tool: ToolState = known ?? {
      title: "Tool",
      kind: "other",
      status: "pending",
      input: {},
      paths: [],
      content: [],
      rawOutput: undefined,
    };

    tool.title = update.title ?? tool.title;
    tool.kind = update.kind ?? tool.kind;
    tool.status = update.status ?? tool.status;
    tool.input = Value.Check(input, update.rawInput) ? update.rawInput : tool.input;
    tool.paths = update.locations?.map((location) => location.path) ?? tool.paths;
    tool.content = update.content ?? tool.content;
    tool.rawOutput = update.rawOutput ?? tool.rawOutput;

    if (known !== undefined) return;
    this.#tools.set(update.toolCallId, tool);
    this.#events.push({ kind: "tool", id: update.toolCallId });
  }

  #arguments(id: string): MirrorArguments {
    const tool = this.#tools.get(id);

    return {
      thread: this.prefix,
      id,
      title: tool?.title ?? "Tool",
      kind: tool?.kind ?? "other",
      input: tool?.input ?? {},
      paths: tool?.paths ?? [],
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
