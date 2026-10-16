import { asId, asSeq } from "@nyte-ai/schema";
import type { QuestionAnswers, QuestionInfo } from "@nyte-ai/plugin/question/schema";
import type {
  Configuration,
  Delivery,
  Execution,
  Json,
  Message,
  MessageId,
  MessageSource,
  PartStatus,
  PartView,
  RunEnd,
  RunId,
  RunView,
  Schedule,
  SessionInfo,
  SessionView,
  ToolClass,
  ToolPartState,
  TurnInfo,
  Usage,
  UserContent,
} from "@nyte-ai/sdk";
import type { FollowedSession } from "../../src/model/state.ts";

export type ScheduleSpec =
  | { readonly kind: "joined"; readonly run: string }
  | Exclude<Schedule, { readonly kind: "joined" }>;

export type SourceSpec =
  | { readonly kind: "user" }
  | { readonly kind: "shell" }
  | { readonly kind: "action"; readonly label: string }
  | { readonly kind: "child"; readonly session: string; readonly end?: RunEnd["kind"] }
  | { readonly kind: "job"; readonly job: string };

type ReportSpec =
  | { readonly child: string; readonly end?: RunEnd["kind"] }
  | { readonly job: string };

export interface InputOptions {
  readonly id?: string;
  readonly source?: SourceSpec;
  readonly delivery?: Delivery;
  readonly content?: UserContent;
}

export interface ViewBuilder {
  turn(
    id: string,
    build: (turn: TurnBuilder) => TurnBuilder,
    options?: { readonly run?: string },
  ): ViewBuilder;
  pending(
    text: string,
    status: { readonly schedule: ScheduleSpec; readonly covered?: boolean },
    options?: InputOptions,
  ): ViewBuilder;
  unsent(
    text: string,
    options?: InputOptions & {
      readonly retrying?: { readonly at: number; readonly reason: string };
    },
  ): ViewBuilder;
  report(source: ReportSpec, text: string, options?: { readonly id?: string }): ViewBuilder;
  question(
    questions: readonly QuestionInfo[],
    extra?: {
      readonly id?: string;
      readonly answers?: QuestionAnswers;
      readonly live?: boolean;
      readonly run?: string;
    },
  ): ViewBuilder;
  live(
    run?: string,
    options?: { readonly stopping?: boolean; readonly phase?: "responding" | "executing" },
  ): ViewBuilder;
  waiting(part: string, run?: string): ViewBuilder;
  retrying(reason: string, until: number, run?: string): ViewBuilder;
  idle(lastRun?: {
    readonly run: string;
    readonly end: "completed" | "stopped" | "failed";
    readonly endedAt?: number;
  }): ViewBuilder;
}

export interface TurnBuilder {
  user(text: string, options?: InputOptions): TurnBuilder;
  action(label: string, prompt: string, options?: { readonly id?: string }): TurnBuilder;
  report(source: ReportSpec, text: string, options?: { readonly id?: string }): TurnBuilder;
  text(markdown: string, options?: { readonly id?: string; readonly live?: boolean }): TurnBuilder;
  thinking(
    markdown: string,
    options?: { readonly id?: string; readonly live?: boolean },
  ): TurnBuilder;
  tool(
    name: string,
    state?: {
      readonly id?: string;
      readonly running?: boolean;
      readonly output?: string;
      readonly failed?: string;
      readonly args?: Json;
      readonly class?: ToolClass;
    },
  ): TurnBuilder;
  part(
    kind: string,
    state: Json,
    options?: {
      readonly id?: string;
      readonly role?: "step" | "answer" | "note";
      readonly live?: boolean;
    },
  ): TurnBuilder;
  ended(
    kind: "completed" | "failed" | "stopped",
    options?: { readonly endedAt?: number; readonly failure?: string },
  ): TurnBuilder;
  waiting(part: string): TurnBuilder;
  activity(label: string): TurnBuilder;
  at(startedAt: number): TurnBuilder;
}

export const CONFIGURATION: Configuration = {
  kind: "exact",
  model: { provider: "test", id: "model" },
  thinking: "medium",
  agent: null,
  settings: {},
  settingsVersion: "v1",
};

export const USAGE: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const SINGLE = { index: 0, count: 1, ids: [] };

const EMPTY_SUMMARY: TurnInfo["summary"] = {
  byClass: {
    read: { count: 0, paths: [] },
    list: { count: 0, paths: [] },
    edit: { count: 0, paths: [] },
    shell: { count: 0, paths: [] },
    delegate: { count: 0, paths: [] },
    custom: { count: 0, paths: [] },
  },
  failed: 0,
  stopped: 0,
  added: 0,
  removed: 0,
};

export function buildView(build: (view: ViewBuilder) => ViewBuilder): SessionView {
  const messages: Message[] = [];
  const parts: PartView[] = [];
  const turns: TurnInfo[] = [];
  let execution: Execution = { kind: "idle", lastRun: null };
  let clock = 1_000;
  let counter = 0;

  const tick = (): number => (clock += 1_000);
  const nextId = (id: string | undefined): MessageId => asId(id ?? `m${(counter += 1)}`);
  const lastRun = (): string => turns.findLast((turn) => turn.run !== null)?.run ?? "run-1";

  const runView = (run: string): RunView => ({
    id: asId(run),
    head: asId("main"),
    startedAt: turns.find((turn) => turn.run === run)?.startedAt ?? clock,
    attempt: 0,
    configuration: CONFIGURATION,
    origin: { kind: "continuation", from: "wake" },
  });

  const input = (
    text: string,
    options: InputOptions | undefined,
    status: Extract<Message, { readonly kind: "user" }>["status"],
  ): Message => {
    const id = nextId(options?.id);

    return {
      id,
      turn: asId(`pending:${id}`),
      at: tick(),
      kind: "user",
      content: options?.content ?? text,
      source: buildSource(options?.source ?? { kind: "user" }),
      delivery: options?.delivery ?? "steer",
      status,
      siblings: SINGLE,
    };
  };

  const view: ViewBuilder = {
    turn(id, buildTurn, options) {
      const run: RunId = asId(options?.run ?? `run-${id}`);
      const turn = turnBuilder(id, run, { messages, nextId, tick });
      buildTurn(turn.builder);
      turns.push(turn.info());

      return view;
    },
    pending(text, status, options) {
      const message = input(text, options, {
        kind: "pending",
        schedule: buildSchedule(status.schedule),
        covered: status.covered ?? true,
      });

      messages.push(message);
      turns.push({
        id: message.turn,
        run: null,
        prompt: message.id,
        state: { kind: "working", activity: null },
        startedAt: message.at,
        endedAt: null,
        steps: 0,
        thinkingOnly: false,
        summary: EMPTY_SUMMARY,
      });

      return view;
    },
    unsent(text, options) {
      messages.push(
        input(text, options, { kind: "unsent", attempts: 1, retrying: options?.retrying ?? null }),
      );

      return view;
    },
    report(source, text, options) {
      return view.pending(
        text,
        { schedule: { kind: "attached" } },
        {
          id: options?.id,
          delivery: "attach",
          source:
            "child" in source
              ? { kind: "child", session: source.child, end: source.end }
              : { kind: "job", job: source.job },
        },
      );
    },
    question(questions, extra) {
      const live = extra?.live ?? true;

      const run: RunId | null =
        extra?.run === undefined
          ? (turns.findLast((turn) => turn.run !== null)?.run ?? null)
          : asId(extra.run);

      const status: PartStatus = live
        ? { kind: "live", run }
        : { kind: "failed", run, failure: { class: "runner", message: "stopped" } };

      parts.push({
        id: asId(extra?.id ?? `q${parts.length + 1}`),
        partKind: "ask/question",
        placement: { kind: "modal" },
        state: { questions: [...questions], answers: extra?.answers ?? null },
        version: 1,
        status,
        owner: "question",
      });

      return view;
    },
    live(run, options) {
      execution = {
        kind: "live",
        run: runView(run ?? lastRun()),
        phase: options?.phase ?? "responding",
        stopping: options?.stopping ?? false,
      };

      return view;
    },
    waiting(part, run) {
      execution = {
        kind: "waiting",
        run: runView(run ?? lastRun()),
        on: { kind: "part", part: asId(part) },
      };

      return view;
    },
    retrying(reason, until, run) {
      execution = { kind: "retrying", run: runView(run ?? lastRun()), until, reason };

      return view;
    },
    idle(last) {
      execution = {
        kind: "idle",
        lastRun:
          last === undefined
            ? null
            : {
                id: asId(last.run),
                end: buildEnd(last.end, undefined),
                endedAt: last.endedAt ?? clock,
              },
      };

      return view;
    },
  };

  build(view);

  return {
    revision: asId("rev-1"),
    seq: asSeq(messages.length),
    activation: { kind: "active" },
    messages,
    parts,
    turns,
    usage: { ...USAGE, input: 0, output: 0, total: 0 },
    execution,
    background: [],
    configuration: { selected: CONFIGURATION, effective: CONFIGURATION },
    context: { tokens: 1_000, window: 100_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

export function followed(view: SessionView, id = "s1"): FollowedSession {
  const info: SessionInfo = {
    id: asId(id),
    name: null,
    parent: null,
    call: null,
    workspace: asId("workspace"),
    pinned: false,
    archived: false,
    activation: view.activation,
    heads: [],
    createdAt: 1_000,
    lastActivityAt: 1_000,
  };

  return {
    id: info.id,
    info,
    view,
    watch: { kind: "live" },
    selection: { model: CONFIGURATION.model, effort: CONFIGURATION.thinking, fast: false },
  };
}

interface BuiltTurn {
  readonly builder: TurnBuilder;
  info(): TurnInfo;
}

function turnBuilder(
  id: string,
  run: RunId,
  shared: {
    readonly messages: Message[];
    readonly nextId: (id: string | undefined) => MessageId;
    readonly tick: () => number;
  },
): BuiltTurn {
  const turn = asId<"turn">(id);
  let turnState: TurnInfo["state"] = { kind: "working", activity: null };
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let prompt: MessageId | null = null;
  let steps = 0;
  let thinkingOnly = true;

  const at = (): number => {
    const now = shared.tick();
    startedAt ??= now;

    return now;
  };

  const landed = (): Extract<Message, { readonly kind: "user" }>["status"] => ({
    kind: "landed",
    commit: asId(`commit-${shared.messages.length + 1}`),
    run,
    replaced: null,
  });

  const user = (
    content: UserContent,
    source: MessageSource,
    options: { readonly id?: string; readonly delivery?: Delivery },
  ): void => {
    const message: Message = {
      id: shared.nextId(options.id),
      turn,
      at: at(),
      kind: "user",
      content,
      source,
      delivery: options.delivery ?? "steer",
      status: landed(),
      siblings: SINGLE,
    };

    prompt ??= message.id;
    shared.messages.push(message);
  };

  const part = (
    partKind: string,
    partState: Json | ToolPartState,
    options: {
      readonly id?: string;
      readonly role: "step" | "answer" | "note";
      readonly live: boolean;
      readonly failed?: string;
    },
  ): void => {
    const message = shared.nextId(options.id);
    const now = at();

    const status: PartStatus =
      options.failed !== undefined
        ? { kind: "failed", run, failure: { class: "runner", message: options.failed } }
        : options.live
          ? { kind: "live", run }
          : { kind: "settled", commit: asId(`commit-${message}`), endedAt: now };

    if (options.role === "step") {
      steps += 1;

      if (partKind !== "thinking") thinkingOnly = false;
    }

    shared.messages.push({
      id: message,
      turn,
      at: now,
      kind: "part",
      part: asId(message),
      partKind,
      role: options.role,
      state: partState,
      version: 1,
      status,
    });
  };

  const builder: TurnBuilder = {
    user(text, options) {
      user(options?.content ?? text, buildSource(options?.source ?? { kind: "user" }), {
        id: options?.id,
        delivery: options?.delivery,
      });

      return builder;
    },
    action(label, text, options) {
      user(text, { kind: "action", label }, { id: options?.id });

      return builder;
    },
    report(source, text, options) {
      user(
        text,
        "child" in source
          ? { kind: "child", session: asId(source.child), end: source.end ?? "completed" }
          : { kind: "job", job: asId(source.job) },
        { id: options?.id, delivery: "attach" },
      );

      return builder;
    },
    text(markdown, options) {
      part(
        "text",
        { markdown, signature: null },
        { id: options?.id, role: "answer", live: options?.live ?? false },
      );

      return builder;
    },
    thinking(markdown, options) {
      part(
        "thinking",
        { markdown, merged: 1, signature: null },
        { id: options?.id, role: "step", live: options?.live ?? false },
      );

      return builder;
    },
    tool(name, spec) {
      const call = spec?.id ?? `call-${shared.messages.length + 1}`;
      const toolClass: ToolClass = spec?.class ?? { kind: "custom", label: name };
      const base = { call: asId<"call">(call), name, args: spec?.args ?? {}, class: toolClass };

      const toolState: ToolPartState =
        spec?.running === true
          ? { ...base, phase: "running", progress: null }
          : spec?.failed !== undefined
            ? {
                ...base,
                phase: "settled",
                outcome: { kind: "failed", message: spec.failed },
                changes: null,
              }
            : {
                ...base,
                phase: "settled",
                outcome: {
                  kind: "ok",
                  content: [{ kind: "text", text: spec?.output ?? "" }],
                  output: null,
                  parts: [],
                },
                changes: null,
              };

      part("tool", toolState, { id: call, role: "step", live: spec?.running === true });

      return builder;
    },
    part(kind, state, options) {
      part(kind, state, {
        id: options?.id,
        role: options?.role ?? "answer",
        live: options?.live ?? false,
      });

      return builder;
    },
    ended(kind, options) {
      endedAt = options?.endedAt ?? shared.tick();
      turnState = { kind: "ended", end: buildEnd(kind, options?.failure) };

      return builder;
    },
    waiting(partId) {
      turnState = { kind: "waiting", on: { kind: "part", part: asId(partId) } };

      return builder;
    },
    activity(label) {
      turnState = { kind: "working", activity: label };

      return builder;
    },
    at(time) {
      startedAt = time;

      return builder;
    },
  };

  return {
    builder,
    info: () => ({
      id: turn,
      run,
      prompt,
      state: turnState,
      startedAt: startedAt ?? shared.tick(),
      endedAt,
      steps,
      thinkingOnly: steps > 0 && thinkingOnly,
      summary: EMPTY_SUMMARY,
    }),
  };
}

function buildEnd(kind: "completed" | "failed" | "stopped", failure: string | undefined): RunEnd {
  if (kind === "completed") return { kind, usage: USAGE };

  if (kind === "stopped") return { kind };

  return { kind, failure: { class: "runner", message: failure ?? "failed" } };
}

function buildSchedule(spec: ScheduleSpec): Schedule {
  return spec.kind === "joined" ? { kind: "joined", run: asId(spec.run) } : spec;
}

function buildSource(spec: SourceSpec): MessageSource {
  if (spec.kind === "child")
    return { kind: "child", session: asId(spec.session), end: spec.end ?? "completed" };

  if (spec.kind === "job") return { kind: "job", job: asId(spec.job) };

  return spec;
}
