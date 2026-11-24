import { createHash } from "node:crypto";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, lazyStream } from "@nyte-ai/ai";
import type {
  Api,
  AssistantMessageEventStream,
  Model,
  ProviderHeadRequest,
  SimpleStreamOptions,
  TranscriptContext,
} from "@nyte-ai/ai";
import { asId, isJson } from "@nyte-ai/schema";
import type { PluginApi, ProviderHeadRegistration, RuntimePolicyGrant } from "@nyte-ai/core";
import type {
  ContentBlock,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from "@agentclientprotocol/sdk/unstable";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { clientTerminals } from "./terminals.ts";
import { readsOnly } from "../side-chat.ts";
import { AgentProcess } from "./process.ts";
import { advance } from "./conversation.ts";
import type { ConversationEvent, Frame, GenerationState } from "./conversation.ts";
import { describeCall, mergeCall } from "./calls.ts";
import { agentChoice } from "./catalog.ts";
import type { AgentRoute } from "./catalog.ts";
import { standardProfile } from "./profiles.ts";
import type { AcpAgent } from "./profiles.ts";
import { userBlocks, transcriptText } from "./history.ts";
import { agentUsage, emptyMessage, mirrorClass, MIRROR_TOOL, Translator } from "./projection.ts";
import { askPermissionQuestion, askQuestion } from "./interactions.ts";
import { formRequest, readForm } from "./forms.ts";

import type { AcpClientServices, GatewayLease } from "./client-services.ts";

const checkpoint = Type.Object({
  version: Type.Literal(1),
  native: Type.String(),
  identity: Type.String(),
  input: Type.Union([Type.String(), Type.Null()]),
});

const cancelled: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

interface Claim {
  readonly run: string;
  readonly frame: string;
  readonly dispatch: string;
  request: number;
  committed: number;
  delivered: number;
  ended: boolean;
}
type Slot =
  | {
      readonly kind: "starting" | "ready";
      readonly identity: string;
      readonly conversation: Promise<HeadConversation>;
    }
  | { readonly kind: "retiring"; readonly done: Promise<void> };

export function createAcpClient(services?: AcpClientServices) {
  const slots = new Map<string, Slot>();
  const bindings = new Map<string, PluginApi<"core">>();

  return {
    bind(agent: AcpAgent, api: PluginApi<"core">) {
      const key = JSON.stringify([agent.id, api.session.id]);
      bindings.set(key, api);
      api.signal.addEventListener(
        "abort",
        () => {
          if (bindings.get(key) !== api) return;
          bindings.delete(key);
          [...slots.entries()]
            .filter(([owner]) => owner.startsWith(`${key}:`))
            .forEach(([owner, slot]) => {
              slots.delete(owner);

              if (slot.kind !== "retiring") {
                void slot.conversation.then(
                  (conversation) => conversation.retire("close"),
                  () => undefined,
                );
              }
            });
        },
        { once: true },
      );
    },
    answer(
      route: AgentRoute,
      model: Model<Api>,
      context: TranscriptContext,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      return lazyStream(model, async () => {
        const api =
          options?.sessionId === undefined
            ? undefined
            : bindings.get(JSON.stringify([route.agent.id, options.sessionId]));

        if (api === undefined) {
          throw new Error("ACP agents need an attached Nyte session environment.");
        }
        const scope = options?.execution;

        if (scope?.kind !== "head") return answerOnce(api, route, model, context, options?.signal);
        const owner = `${JSON.stringify([route.agent.id, scope.session])}:${scope.head}`;

        const identity = JSON.stringify([
          route.agent.id,
          scope.history.epoch,
          api.env.identity,
          api.env.cwd,
        ]);

        const previous = slots.get(owner);

        if (previous?.kind === "retiring") {
          await previous.done;
          slots.delete(owner);
        }

        const current = slots.get(owner);

        if (current !== undefined && current.kind !== "retiring" && current.identity === identity) {
          const conversation = await current.conversation;

          if (!conversation.closed) {
            return conversation.respond(scope, model, context, options?.signal);
          }
        }

        if (current !== undefined && current.kind !== "retiring") {
          const done = current.conversation.then((conversation) => conversation.retire("route"));
          slots.set(owner, { kind: "retiring", done });
          await done;
        }

        const conversation = HeadConversation.open(api, route, scope, context, services);
        const slot: Slot = { kind: "starting", identity, conversation };
        slots.set(owner, slot);
        const opened = await conversation;

        if (slots.get(owner) !== slot || api.signal.aborted) {
          await opened.retire("close");
          throw new Error("This ACP activation was replaced.");
        }

        slots.set(owner, { kind: "ready", identity, conversation });

        return opened.respond(scope, model, context, options?.signal);
      });
    },
  };
}

class HeadConversation {
  private readonly api: PluginApi<"core">;
  private readonly route: AgentRoute;
  private readonly generation = crypto.randomUUID();
  private readonly profile;
  private readonly codec;
  private state: GenerationState;
  private process: AgentProcess | undefined;
  private registration: ProviderHeadRegistration | undefined;
  private scope: ProviderHeadRequest | undefined;
  private claim: Claim | undefined;
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private retiring: Promise<void> | undefined;
  private readonly identity: string;
  private readonly offers = new Map<string, Promise<unknown>>();
  private readonly system: string | undefined;
  private gateway: GatewayLease | undefined;
  private stopRun: (() => void) | undefined;
  private terminals: ReturnType<typeof clientTerminals> | undefined;

  private constructor(
    api: PluginApi<"core">,
    route: AgentRoute,
    scope: ProviderHeadRequest,
    context: TranscriptContext,
    grant: RuntimePolicyGrant,
  ) {
    this.api = api;
    this.route = route;
    this.profile = route.agent.behavior ?? standardProfile;
    this.codec = this.profile.codec();
    this.scope = scope;
    this.system = getCurrentSystemPrompt(context.messages);

    const launch =
      grant.policy.kind === "unattended"
        ? (route.agent.unattended ?? route.agent.launch)
        : route.agent.launch;

    this.identity = createHash("sha256")
      .update(
        JSON.stringify([
          route.agent.id,
          route.agent.command,
          launch,
          api.env.identity,
          api.env.cwd,
          this.system,
        ]),
      )
      .digest("hex");
    this.state = { kind: "booting", generation: this.generation };
  }

  static async open(
    api: PluginApi<"core">,
    route: AgentRoute,
    scope: ProviderHeadRequest,
    context: TranscriptContext,
    services?: AcpClientServices,
  ): Promise<HeadConversation> {
    const grant = await api.runtimePolicy.acquire({
      provider: route.agent.id,
      head: scope.head,
      signal: api.signal,
    });

    if (grant.policy.kind === "denied") throw new Error(grant.policy.reason);
    grant.revoked.throwIfAborted();
    const conversation = new HeadConversation(api, route, scope, context, grant);
    grant.onRevoke(() =>
      conversation.retire(grant.revoked.reason === "close" ? "close" : "policy"),
    );

    try {
      conversation.gateway = await services?.gateway({
        session: scope.session,
        head: scope.head,
        generation: conversation.generation,
        signal: conversation.abort.signal,
        tools: () =>
          conversation.claim !== undefined && !conversation.claim.ended
            ? conversation.scope?.tools
            : undefined,
      });
      await conversation.start(scope, grant);

      return conversation;
    } catch (error) {
      await conversation.retire("close");
      throw conversation.state.kind === "retired" && conversation.state.reason.kind === "failed"
        ? new Error(conversation.state.reason.message)
        : error;
    }
  }
  get closed(): boolean {
    return this.state.kind === "retired";
  }

  private async start(scope: ProviderHeadRequest, grant: RuntimePolicyGrant): Promise<void> {
    const agent = this.route.agent;
    this.registration = await this.api.providerRuns.bind({
      head: scope.head,
      run: scope.run,
      provider: agent.id,
      historyEpoch: scope.history.epoch,
    });
    this.registration.signal.addEventListener(
      "abort",
      () => {
        void this.retire(this.registration?.signal.reason === "close" ? "close" : "stop");
      },
      { once: true },
    );

    const launch =
      grant.policy.kind === "unattended" ? (agent.unattended ?? agent.launch) : agent.launch;

    this.terminals =
      this.profile.terminal === "off"
        ? undefined
        : clientTerminals(this.api.env, this.abort.signal, () =>
            this.claim !== undefined && !this.claim.ended ? this.scope : undefined,
          );

    const readConfined =
      this.profile.files === "confined" ? this.api.env.files.readConfined : undefined;

    const process = await AgentProcess.start(
      this.api.env,
      agent,
      launch,
      {
        update: (update, child) => this.update(update, child),
        child: (report) => this.post({ kind: "child", report }),
        permission: (request) => this.permission(request),
        form: (request) => this.form(request),
        failed: (error) => this.post({ kind: "fail", message: error.message }),
      },
      {
        terminals: this.terminals,
        ...(readConfined === undefined
          ? {}
          : {
              read: async (request) => {
                const current =
                  this.claim !== undefined && !this.claim.ended ? this.scope : undefined;

                if (current === undefined || this.closed) {
                  throw new Error("No live run owns this file read.");
                }
                const signal = AbortSignal.any([this.abort.signal, current.lifetime]);

                const verdict = await current.tools.authorize({
                  operation: crypto.randomUUID(),
                  name: MIRROR_TOOL,
                  subjectName: "read",
                  args: { path: request.path },
                  class: { kind: "read", path: request.path },
                  signal,
                });

                if (verdict.kind !== "allow" || signal.aborted) {
                  throw new Error("The file read was cancelled.");
                }
                return readConfined({
                  path: request.path,
                  line: request.line ?? undefined,
                  limit: request.limit ?? undefined,
                  signal,
                });
              },
            }),
      },
    );

    this.process = process;

    if (this.abort.signal.aborted || grant.revoked.aborted) {
      await process.close();
      throw new Error("The agent launch was revoked.");
    }

    this.post({ kind: "ready" });
    const saved = scope.checkpoint.state;

    if (saved.kind === "uncertain" && saved.run === scope.run) {
      throw new Error(
        "The host restarted after reserving this request. It may already have run. Check the agent or workspace before sending it again.",
      );
    }
    const clean =
      saved.kind === "clean" &&
      Value.Check(checkpoint, saved.data) &&
      saved.data.identity === this.identity
        ? saved.data
        : undefined;

    if (clean?.input !== undefined && clean.input !== null) {
      const last = scope.history.inputs.findIndex((input) => input.commit === clean.input);
      scope.history.inputs.slice(0, last + 1).forEach((input) => this.seen.add(input.commit));
    }

    await process.open({
      cwd: this.api.env.cwd,
      ...(clean === undefined ? {} : { resume: clean.native }),
      system: this.system,
      mcpServers: (peer) => this.gateway?.servers(peer, this.profile.mcp) ?? [],
    });
    grant.revoked.throwIfAborted();
    await process.choose(agentChoice(this.route, undefined));
  }

  async respond(
    scope: ProviderHeadRequest,
    model: Model<Api>,
    context: TranscriptContext,
    signal?: AbortSignal,
  ): Promise<AssistantMessageEventStream> {
    if (this.closed) throw new Error("The agent connection has retired.");
    this.scope = scope;
    this.stopRun?.();

    const stop = () => {
      void this.retire(scope.lifetime.reason === "close" ? "close" : "stop");
    };

    scope.lifetime.addEventListener("abort", stop, { once: true });
    this.stopRun = () => scope.lifetime.removeEventListener("abort", stop);
    this.listeners.forEach((listener) => listener());
    const previous = this.claim;

    if (previous !== undefined && previous.run === scope.run && !previous.ended) {
      if (scope.request > previous.request) {
        previous.committed = previous.delivered;
        previous.request = scope.request;
      }

      return this.project(model, signal);
    }

    if (previous !== undefined && previous.ended) {
      this.post({ kind: "consume", frame: previous.frame });
    }
    const frame = this.firstFrame();

    if (scope.origin.kind === "agent-continued" || frame?.log.origin === "detached") {
      if (
        frame === undefined ||
        frame.log.origin !== "detached" ||
        (scope.origin.kind === "agent-continued" && scope.origin.continuation !== frame.log.id)
      ) {
        throw new Error("This agent continuation no longer has a producer.");
      }
      const id = asId<"provider-continuation">(frame.log.id);
      await this.offers.get(frame.log.id);

      if ((await scope.claimContinuation(id)) !== "claimed") {
        throw new Error("This agent reply no longer belongs to the head.");
      }
      this.claim = {
        run: scope.run,
        frame: frame.log.id,
        dispatch: frame.log.id,
        request: scope.request,
        committed: 0,
        delivered: 0,
        ended: false,
      };

      return this.project(model, signal);
    }

    const process = this.process;

    if (process === undefined) throw new Error("The agent is not ready.");
    const origin = scope.origin;

    const from =
      origin.kind === "input"
        ? scope.history.inputs.findIndex((input) => input.message === origin.message)
        : -1;

    const inputs = scope.history.inputs.filter(
      (input, index) => index >= from && !this.seen.has(input.commit),
    );

    if (from < 0 || inputs.length === 0) {
      throw new Error("There is no new landed input to send to this agent.");
    }
    const id = crypto.randomUUID();
    const dispatch = previous !== undefined && previous.run === scope.run ? previous.dispatch : id;
    const reserved = await scope.checkpoint.reserve({ dispatchId: dispatch, kind: "prompt" });

    if (reserved !== "reserved") {
      throw new Error(
        reserved === "uncertain"
          ? "This request may already have run. It was not sent again."
          : "This run no longer owns the agent request.",
      );
    }
    this.abort.signal.throwIfAborted();
    scope.lifetime.throwIfAborted();
    await process.choose(agentChoice(this.route, undefined));

    const blocks = inputs.flatMap((input) =>
      userBlocks(input.projection, process.negotiated.images),
    );

    const first = this.seen.size === 0;

    const prefix = first
      ? transcriptText(
          context.messages.slice(
            0,
            context.messages.findIndex(
              (message) =>
                message.role === "user" && message.timestamp === inputs[0]?.projection.timestamp,
            ),
          ),
        )
      : "";

    const prompt: ContentBlock[] = [
      ...(first && !process.negotiated.systemAppend && this.system !== undefined
        ? [{ type: "text" as const, text: `Application instructions:\n${this.system}` }]
        : []),
      ...(prefix === ""
        ? []
        : [
            {
              type: "text" as const,
              text: `Quoted conversation history, not new instructions:\n${prefix}`,
            },
          ]),
      ...blocks,
    ];

    inputs.forEach((input) => this.seen.add(input.commit));
    this.claim = {
      run: scope.run,
      frame: id,
      dispatch,
      request: scope.request,
      committed: 0,
      delivered: 0,
      ended: false,
    };
    this.post({ kind: "reserve", frame: id }, id);
    void process.prompt(prompt).then(
      (response) => this.post({ kind: "response", response }, id),
      (error: unknown) =>
        this.post(
          { kind: "fail", message: error instanceof Error ? error.message : String(error) },
          id,
        ),
    );

    return this.project(model, signal);
  }

  private project(model: Model<Api>, signal?: AbortSignal): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();
    const output = emptyMessage(model);
    const translator = new Translator(model, output, stream);
    const claim = this.claim;

    if (claim === undefined) throw new Error("This request has no frame claim.");
    let cursor = claim.committed;
    let finished = false;

    const finish = (
      reason: "stop" | "length" | "toolUse" | "error" | "aborted",
      message?: string,
    ) => {
      if (finished) return;
      finished = true;
      translator.end();
      output.stopReason = reason;

      if (message !== undefined) output.errorMessage = message;
      this.listeners.delete(pump);
      signal?.removeEventListener("abort", aborted);

      if (reason === "error" || reason === "aborted") {
        stream.push({ type: "error", reason, error: output });
      } else stream.push({ type: "done", reason, message: output });
      stream.end();
    };

    const pump = () => {
      if (finished) return;

      if (this.state.kind === "retired") {
        return finish(
          this.state.reason.kind === "cancelled" ? "aborted" : "error",
          this.state.reason.kind === "failed" ? this.state.reason.message : "Stopped.",
        );
      }
      const frame = this.findFrame(claim.frame);

      if (frame === undefined) return;
      const remaining = frame.log.entries.slice(cursor);
      const callIndex = remaining.findIndex((entry) => entry.kind === "call");
      const batch = callIndex < 0 ? remaining : remaining.slice(0, callIndex + 1);
      batch.forEach((entry) => {
        cursor += 1;

        if (entry.kind === "text") translator.text(entry.text);

        if (entry.kind === "thinking") translator.thinking(entry.text);

        if (entry.kind === "call") {
          translator.call({
            type: "toolCall",
            id: entry.call.facts.ref,
            name: MIRROR_TOOL,
            arguments: describeCall(entry.call),
          });
        }
      });
      claim.delivered = cursor;

      if (callIndex >= 0) return finish("toolUse");

      if (frame.kind !== "sealed") return;

      if (frame.end.kind === "failed") return finish("error", frame.end.message);

      if (frame.end.kind === "cancelled") return finish("aborted", "Stopped.");
      const response = frame.end.response;

      if (Value.Check(agentUsage, response?.usage)) translator.usage(response.usage);

      if (this.state.kind === "serving") output.contextOccupancy = this.state.occupancy;
      const process = this.process;

      if (process !== undefined) {
        output.sessionCheckpoint = {
          dispatchId: claim.dispatch,
          data: {
            version: 1,
            native: process.native,
            identity: this.identity,
            input: [...this.seen].at(-1) ?? null,
          },
        };
      }
      claim.ended = true;
      this.stopRun?.();
      this.stopRun = undefined;

      if (frame.log.origin === "detached" && this.scope?.origin.kind === "input") {
        output.providerBoundary = { kind: "continue" };
        delete output.sessionCheckpoint;
      }

      return finish(
        response?.stopReason === "max_tokens" || response?.stopReason === "max_turn_requests"
          ? "length"
          : "stop",
      );
    };

    const aborted = () => finish("aborted", "The response view was interrupted.");
    stream.push({ type: "start", partial: output });
    this.listeners.add(pump);
    signal?.addEventListener("abort", aborted, { once: true });

    if (signal?.aborted === true) aborted();
    else pump();

    return stream;
  }

  private update(update: SessionUpdate, child?: string): void {
    this.post({ kind: "update", update, child, detached: crypto.randomUUID() });
  }
  private post(event: EventInput, operation = "ingress"): void {
    const transition = advance(
      this.state,
      { ...event, generation: this.generation, operation },
      this.codec,
      this.profile,
      this.api.env.cwd,
    );

    this.state = transition.state;
    transition.effects.forEach((effect) => {
      if (effect.kind === "changed") this.listeners.forEach((listener) => listener());

      if (effect.kind === "retire") {
        void this.retire(effect.end.kind === "cancelled" ? "stop" : "failure");
      }
      if (effect.kind === "offer") {
        const offer = this.registration?.offer(asId<"provider-continuation">(effect.frame));

        if (offer !== undefined) {
          this.offers.set(effect.frame, offer);
          void offer.catch((error: unknown) => this.post({ kind: "fail", message: String(error) }));
        }
      }
    });
  }
  private firstFrame(): Frame | undefined {
    if (this.state.kind !== "serving") return undefined;

    return (
      this.state.pending[0] ?? (this.state.work.kind === "idle" ? undefined : this.state.work.frame)
    );
  }
  private findFrame(id: string): Frame | undefined {
    if (this.state.kind !== "serving") return undefined;

    return (
      this.state.pending.find((frame) => frame.log.id === id) ??
      (this.state.work.kind !== "idle" && this.state.work.frame.log.id === id
        ? this.state.work.frame
        : undefined)
    );
  }
  private async activeScope(): Promise<ProviderHeadRequest | undefined> {
    const current = this.scope;

    if (
      this.claim !== undefined &&
      !this.claim.ended &&
      current !== undefined &&
      !current.lifetime.aborted
    ) {
      return current;
    }
    if (this.profile.replies === "prompt-only" || this.closed) return undefined;
    await new Promise<void>((resolve) => {
      const changed = () => {
        this.listeners.delete(changed);
        resolve();
      };

      this.listeners.add(changed);
      this.abort.signal.addEventListener("abort", changed, { once: true });
    });

    return this.closed ? undefined : this.activeScope();
  }
  private async permission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    if (this.claim !== undefined && !this.claim.ended) {
      this.update({ ...request.toolCall, sessionUpdate: "tool_call_update" });
    } else if (this.profile.replies !== "prompt-only") {
      this.update({
        ...request.toolCall,
        content: request.toolCall.content ?? [],
        locations: request.toolCall.locations ?? [],
        name: request.toolCall.name ?? undefined,
        title: request.toolCall.title ?? "Tool",
        kind: request.toolCall.kind ?? "other",
        status: request.toolCall.status ?? "pending",
        sessionUpdate: "tool_call",
      });
    }
    const scope = await this.activeScope();

    if (scope === undefined) return cancelled;

    const signal = AbortSignal.any([
      this.abort.signal,
      scope.lifetime,
      AbortSignal.timeout(600_000),
    ]);

    if (this.profile.systemAppend && request.toolCall.toolCallId.startsWith("interaction_")) {
      return askPermissionQuestion(
        this.api,
        request,
        { head: scope.head, activity: { kind: "run", id: scope.run } },
        signal,
      );
    }
    const frame = this.claim === undefined ? undefined : this.findFrame(this.claim.frame);

    const call = mergeCall(
      frame?.log.calls.get(request.toolCall.toolCallId),
      request.toolCall,
      this.codec,
      this.api.env.cwd,
    );

    const args = describeCall(call);

    if (!isJson(args)) return cancelled;

    const verdict = await scope.tools.authorize({
      operation: crypto.randomUUID(),
      name: MIRROR_TOOL,
      subjectName: args.kind,
      args,
      class: mirrorClass(args),
      signal,
    });

    if (signal.aborted || this.closed) return cancelled;
    const kind = verdict.kind === "allow" ? "allow_once" : "reject_once";

    const choices = this.codec
      .filterPermissionOptions(request.options)
      .filter((option) => option.kind === kind);

    return choices.length !== 1 || choices[0] === undefined
      ? cancelled
      : { outcome: { outcome: "selected", optionId: choices[0].optionId } };
  }
  private async form(request: unknown): Promise<CreateElicitationResponse> {
    if (!Value.Check(formRequest, request)) return { action: "decline" };
    const scope = await this.activeScope();

    if (scope === undefined) return { action: "decline" };

    return askQuestion(
      this.api,
      readForm(request),
      { head: scope.head, activity: { kind: "run", id: scope.run } },
      AbortSignal.any([scope.lifetime, this.abort.signal]),
    );
  }
  retire(reason: string): Promise<void> {
    if (this.retiring !== undefined) return this.retiring;
    const ending = Promise.withResolvers<void>();
    this.retiring = ending.promise;
    this.post(
      reason === "stop"
        ? { kind: "stop" }
        : { kind: "fail", message: `Agent connection retired: ${reason}.` },
    );
    this.abort.abort(reason);
    const process = this.process;
    void (async () => {
      if (reason !== "close" && process !== undefined && !process.closed) {
        await process.cancel().catch(() => undefined);
      }
      await this.gateway?.close();
      await this.terminals?.close();
      await process?.close();
      await this.registration?.release();
    })().then(
      () => ending.resolve(),
      (error: unknown) => ending.reject(error),
    );

    return ending.promise;
  }
}

type EventInput = ConversationEvent extends infer E
  ? E extends ConversationEvent
    ? Omit<E, "generation" | "operation">
    : never
  : never;

async function answerOnce(
  api: PluginApi<"core">,
  route: AgentRoute,
  model: Model<Api>,
  context: TranscriptContext,
  signal?: AbortSignal,
): Promise<AssistantMessageEventStream> {
  if (await readsOnly(api.session, api.host)) {
    throw new Error("Isolated ACP requests cannot run in a read-only side chat.");
  }
  const stream = createAssistantMessageEventStream();
  const output = emptyMessage(model);
  const translator = new Translator(model, output, stream);

  const process = await AgentProcess.start(api.env, route.agent, route.agent.launch, {
    update(update) {
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        translator.text(update.content.text);
      }
    },
    child: () => {},
    permission: async () => cancelled,
    form: async () => ({ action: "decline" }),
    failed: () => {},
  });

  const abort = () => {
    void process.close();
  };

  signal?.addEventListener("abort", abort, { once: true });
  stream.push({ type: "start", partial: output });
  void (async () => {
    try {
      signal?.throwIfAborted();
      await process.open({ cwd: api.env.cwd, system: getCurrentSystemPrompt(context.messages) });
      await process.choose(agentChoice(route, undefined));

      const response = await process.prompt([
        { type: "text", text: transcriptText(context.messages) },
      ]);

      translator.end();
      output.stopReason = response.stopReason === "end_turn" ? "stop" : "error";

      if (output.stopReason === "stop") {
        stream.push({ type: "done", reason: "stop", message: output });
      } else {
        output.errorMessage = "The isolated agent request did not finish.";
        stream.push({ type: "error", reason: "error", error: output });
      }
    } catch (error) {
      output.stopReason = signal?.aborted === true ? "aborted" : "error";
      output.errorMessage = String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
    } finally {
      stream.end();
      signal?.removeEventListener("abort", abort);
      await process.close();
    }
  })();

  return stream;
}
