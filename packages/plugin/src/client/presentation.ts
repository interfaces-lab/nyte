import { isPart, text, thinking, tool } from "@nyte-ai/core";
import type { PartState } from "@nyte-ai/core";
import type {
  Execution,
  Failure,
  HeadInfo,
  Message,
  MessageSource,
  SessionInfo,
  ToolClass,
  ToolPartState,
  UserContent,
} from "@nyte-ai/schema";

/**
 * A message the user sent, or one a child, job or action delivered for them.
 *
 * @category presentation
 */
export type UserMessage = Extract<Message, { readonly kind: "user" }>;

/**
 * A message that carries a part: text, thinking, a tool call or a plugin's part.
 *
 * @category presentation
 */
export type PartMessage = Extract<Message, { readonly kind: "part" }>;

/**
 * A part message holding a tool call.
 *
 * @category presentation
 */
export type ToolMessage = PartMessage & { readonly state: ToolPartState };

/**
 * A part message holding assistant text.
 *
 * @category presentation
 */
export type TextMessage = PartMessage & { readonly state: PartState<typeof text> };

/**
 * A part message holding the model's thinking.
 *
 * @category presentation
 */
export type ThinkingMessage = PartMessage & { readonly state: PartState<typeof thinking> };

/**
 * A user message a child session or background job delivered as its report.
 *
 * @category presentation
 */
export type ReportMessage = UserMessage & {
  readonly source: Extract<MessageSource, { readonly kind: "child" | "job" }>;
};

/**
 * Narrows to a tool call's part.
 *
 * @category presentation
 */
export function showsTool(message: Message): message is ToolMessage {
  return isPart(message, tool);
}

/**
 * Narrows to an assistant text part.
 *
 * @category presentation
 */
export function showsText(message: Message): message is TextMessage {
  return isPart(message, text);
}

/**
 * Narrows to a thinking part.
 *
 * @category presentation
 */
export function showsThinking(message: Message): message is ThinkingMessage {
  return isPart(message, thinking);
}

/**
 * Narrows to the report a child or job delivered; a person or an action sent the rest.
 *
 * @category presentation
 */
export function showsReport(message: UserMessage): message is ReportMessage {
  return message.source.kind === "child" || message.source.kind === "job";
}

/**
 * What a user message shows: an action's label in place of the prompt it sent.
 *
 * @category presentation
 */
export function shownContent(message: UserMessage): UserContent {
  return message.source.kind === "action" ? message.source.label : message.content;
}

/**
 * The tense a tool line speaks in: running, done, or none when the call did
 * not finish and no verb would be true.
 *
 * @category presentation
 */
export type ToolTense = "running" | "past" | "none";

/**
 * The colour family of a tool line's state.
 *
 * @category presentation
 */
export type ToolTone = "running" | "attention" | "success" | "failure" | "stopped";

/**
 * The word a tool line adds after its subject when the outcome needs saying.
 *
 * @category presentation
 */
export type ToolWord = "Needs input" | "Failed" | "Blocked" | "Stopped" | "Interrupted";

/**
 * How every client shows a tool call's state; clients change only case and glyphs.
 *
 * @category presentation
 */
export interface ToolStatus {
  readonly tense: ToolTense;
  readonly tone: ToolTone;
  readonly word: ToolWord | undefined;
}

const RUNNING: ToolStatus = { tense: "running", tone: "running", word: undefined };

/**
 * A settled call reads its outcome. An open call whose run failed was cut off,
 * not failed by the tool: the user's stop reads "Stopped", anything else
 * "Interrupted", and the turn's failure notice says why.
 *
 * @category presentation
 */
export function toolStatus(message: Pick<ToolMessage, "state" | "status">): ToolStatus {
  const { state, status } = message;

  if (state.phase !== "settled") {
    if (status.kind === "failed")
      return status.failure.class === "aborted"
        ? { tense: "none", tone: "stopped", word: "Stopped" }
        : { tense: "none", tone: "stopped", word: "Interrupted" };

    if (status.kind === "waiting" && status.on.kind === "part")
      return { tense: "running", tone: "attention", word: "Needs input" };

    return RUNNING;
  }

  switch (state.outcome.kind) {
    case "ok":
      return { tense: "past", tone: "success", word: undefined };
    case "failed":
      return { tense: "none", tone: "failure", word: "Failed" };
    case "rejected":
      return { tense: "none", tone: "failure", word: "Blocked" };
    case "stopped":
      return { tense: "none", tone: "stopped", word: "Stopped" };
    case "interrupted":
      return { tense: "none", tone: "stopped", word: "Interrupted" };
    default: {
      const _exhaustive: never = state.outcome;

      return _exhaustive;
    }
  }
}

/**
 * A settled call's text: its text content, failure message or rejection reason.
 *
 * @category presentation
 */
export function toolOutput(state: ToolPartState): string {
  if (state.phase !== "settled") return "";

  switch (state.outcome.kind) {
    case "ok":
      return state.outcome.content
        .flatMap((content) =>
          content.kind === "text" && content.text !== "" ? [content.text] : [],
        )
        .join("\n");
    case "failed":
      return state.outcome.message;
    case "rejected":
      return state.outcome.reason;
    case "stopped":
    case "interrupted":
      return "";
    default: {
      const _exhaustive: never = state.outcome;

      return _exhaustive;
    }
  }
}

/**
 * The mark a session list draws for a head's execution.
 *
 * @category presentation
 */
export type SessionMark = "waiting" | "retry" | "working" | "failed" | "idle";

/**
 * The mark for an execution; a session without one is idle.
 *
 * @category presentation
 */
export function executionMark(execution: Execution | undefined): SessionMark {
  switch (execution?.kind) {
    case undefined:
      return "idle";
    case "idle":
      return execution.lastRun?.end.kind === "failed" ? "failed" : "idle";
    case "live":
      return "working";
    case "waiting":
      return execution.on.kind === "part" ? "waiting" : "working";
    case "retrying":
      return "retry";
    default: {
      const _exhaustive: never = execution;

      return _exhaustive;
    }
  }
}

/**
 * The head a session row speaks for: `main`, else the first.
 *
 * @category presentation
 */
export function mainHead(session: Pick<SessionInfo, "heads">): HeadInfo | undefined {
  return session.heads.find((head) => head.name === "main") ?? session.heads[0];
}

/**
 * The mark for a session's main head.
 *
 * @category presentation
 */
export function sessionMark(session: Pick<SessionInfo, "heads">): SessionMark {
  return executionMark(mainHead(session)?.execution);
}

/**
 * The `@` mention or `/` command the caret is in, with the word's bounds.
 *
 * @category presentation
 */
export interface CompletionTrigger {
  readonly kind: "@" | "/";
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

/**
 * Finds the completion trigger around the caret, or undefined outside one.
 *
 * @category presentation
 */
export function completionTrigger(
  value: string,
  cursor = value.length,
): CompletionTrigger | undefined {
  const caret = Math.max(0, Math.min(cursor, value.length));
  let start = caret;

  while (start > 0 && (value[start - 1] ?? "").trim() !== "") start -= 1;
  const kind = value[start];

  if (start === caret || (kind !== "@" && kind !== "/")) return undefined;
  let end = caret;

  while (end < value.length && (value[end] ?? "").trim() !== "") end += 1;

  return { kind, start, end, query: value.slice(start + 1, caret) };
}

/**
 * The verb for each tense that asserts one.
 *
 * @category presentation
 */
export type ToolVerbs = Readonly<Record<Exclude<ToolTense, "none">, string>>;

type DelegateClass = Extract<ToolClass, { readonly kind: "delegate" }>;

type DelegateRole = DelegateClass["role"];

const RAN: ToolVerbs = { running: "Running", past: "Ran" };

const CLASS_VERBS = {
  read: { running: "Reading", past: "Read" },
  list: { running: "Listing", past: "Listed" },
  edit: { running: "Editing", past: "Edited" },
  shell: RAN,
} as const satisfies Readonly<Record<"read" | "list" | "edit" | "shell", ToolVerbs>>;

const DELEGATE_VERBS = {
  task: { running: "Delegating", past: "Delegated" },
  create: { running: "Creating", past: "Created" },
  send: { running: "Messaging", past: "Messaged" },
  await: { running: "Waiting on", past: "Waited on" },
  read: { running: "Reading transcript", past: "Read transcript" },
  stop: { running: "Stopping", past: "Stopped" },
} as const satisfies Readonly<Record<DelegateRole, ToolVerbs>>;

const DELEGATE_NOUNS = {
  task: "agent",
  create: "agent",
  send: "message",
  await: "wait",
  read: "transcript",
  stop: "stop",
} as const satisfies Readonly<Record<DelegateRole, string>>;

/**
 * How a custom tool reads: its verbs, and the name and server an MCP tool
 * carries, or a fixed detail for a built-in.
 *
 * @category presentation
 */
export interface CustomTool {
  readonly verbs: ToolVerbs;
  readonly name?: string;
  readonly server?: string;
  readonly detail?: string;
}

const NAMED_TOOLS = new Map<string, CustomTool>([
  ["codemode", { verbs: { running: "Running script", past: "Ran script" } }],
  ["tool_search", { verbs: { running: "Exploring", past: "Explored" }, detail: "available tools" }],
  ["websearch", { verbs: { running: "Searching web", past: "Searched web" } }],
  ["web_search", { verbs: { running: "Searching web", past: "Searched web" } }],
  ["webfetch", { verbs: { running: "Fetching page", past: "Fetched page" } }],
  ["web_fetch", { verbs: { running: "Fetching page", past: "Fetched page" } }],
  ["rename_chat", { verbs: { running: "Renaming chat", past: "Renamed chat" } }],
  ["browser_open", { verbs: { running: "Opening page", past: "Opened page" } }],
  ["browser_click", { verbs: { running: "Clicking", past: "Clicked" } }],
  ["browser_type", { verbs: { running: "Typing", past: "Typed" } }],
  ["browser_press", { verbs: { running: "Pressing key", past: "Pressed key" } }],
  ["browser_scroll", { verbs: { running: "Scrolling", past: "Scrolled" } }],
  ["browser_wait", { verbs: { running: "Waiting", past: "Waited" } }],
  ["browser_snapshot", { verbs: { running: "Taking snapshot", past: "Took snapshot" } }],
  [
    "browser_console",
    { verbs: { running: "Checking console logs", past: "Checked console logs" } },
  ],
  ["browser_evaluate", { verbs: { running: "Executing JS", past: "Executed JS" } }],
]);

const MCP_LABEL = /^(?<server>[^:\s]+): (?<name>\S+)$/u;

const MCP_NAME = /^mcp__(?<server>.+?)__(?<name>.+)$/u;

/**
 * Reads a custom tool's label: a built-in's own words, an MCP tool's name and
 * server, a phrase used as its own verb, or a bare name that "Ran".
 *
 * @category presentation
 */
export function customTool(label: string): CustomTool {
  const named = NAMED_TOOLS.get(label);

  if (named !== undefined) return named;
  const mcp = (MCP_LABEL.exec(label) ?? MCP_NAME.exec(label))?.groups;

  if (mcp?.server !== undefined && mcp.name !== undefined)
    return { verbs: RAN, name: mcp.name, server: mcp.server };

  if (/\s/u.test(label)) return { verbs: { running: label, past: label } };

  return { verbs: RAN, name: label };
}

function customDetail(custom: CustomTool): string | undefined {
  if (custom.name === undefined) return custom.detail;

  return custom.server === undefined ? custom.name : `${custom.name} in ${custom.server}`;
}

/**
 * The verbs a tool call speaks with.
 *
 * @category presentation
 */
export function toolVerbs(toolClass: ToolClass): ToolVerbs {
  switch (toolClass.kind) {
    case "read":
    case "list":
    case "edit":
    case "shell":
      return CLASS_VERBS[toolClass.kind];
    case "delegate":
      return DELEGATE_VERBS[toolClass.role];
    case "custom":
      return customTool(toolClass.label).verbs;
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

/**
 * What a verbless line adds after its subject so the tool stays named: a path
 * alone does not say read from edit. A command or a custom tool needs nothing.
 *
 * @category presentation
 */
export function toolNoun(toolClass: ToolClass): string | undefined {
  switch (toolClass.kind) {
    case "read":
    case "list":
    case "edit":
      return toolClass.kind;
    case "delegate":
      return DELEGATE_NOUNS[toolClass.role];
    case "shell":
    case "custom":
      return undefined;
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

/**
 * The agent a delegate call names, "subagent" when the call gave no title.
 *
 * @category presentation
 */
export function delegateSubject(toolClass: DelegateClass): string {
  return toolClass.title ?? "subagent";
}

/**
 * What a call acts on, in full: a path, a command, an agent's title, or a
 * custom tool's name.
 *
 * @category presentation
 */
export function toolSubject(toolClass: ToolClass): string | undefined {
  switch (toolClass.kind) {
    case "read":
    case "list":
    case "edit":
      return toolClass.path;
    case "shell":
      return toolClass.command;
    case "delegate":
      return delegateSubject(toolClass);
    case "custom":
      return customDetail(customTool(toolClass.label));
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

/**
 * One line naming a call: the tense's verb before the subject, or the subject
 * and its noun when no verb is true. A custom tool without a name reads as its label.
 *
 * @category presentation
 */
export function toolTitle(
  toolClass: ToolClass,
  tense: ToolTense,
  subject = toolSubject(toolClass),
): string {
  if (tense !== "none") {
    const verb = toolVerbs(toolClass)[tense];

    return subject === undefined ? verb : `${verb} ${subject}`;
  }

  if (toolClass.kind === "custom" && customTool(toolClass.label).name === undefined)
    return toolClass.label;

  return [subject, toolNoun(toolClass)].filter((word) => word !== undefined).join(" ");
}

/**
 * A path relative to the working directory when it lies inside it.
 *
 * @category presentation
 */
export function tidyPath(path: string, cwd: string | undefined): string {
  if (cwd !== undefined && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);

  return path;
}

function basename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

/**
 * The last segment of a path; the working directory reads as its own name.
 *
 * @category presentation
 */
export function placeName(path: string, cwd: string | undefined): string {
  const tidy = tidyPath(path, cwd);

  if (tidy === "." || tidy === "./" || tidy === cwd) return basename(cwd ?? tidy) || tidy;

  return basename(tidy.replace(/[\\/]+$/u, "")) || tidy;
}

/**
 * A command on one line, without a leading `cd` into the working directory.
 *
 * @category presentation
 */
export function condensedCommand(command: string, cwd: string | undefined): string {
  const compact = command.replaceAll(/\s+/gu, " ").trim();

  if (cwd === undefined) return compact;

  const prefix = [cwd, `"${cwd}"`, `'${cwd}'`]
    .flatMap((dir) => [`cd ${dir} && `, `cd ${dir}; `])
    .find((candidate) => compact.startsWith(candidate));

  return prefix === undefined ? compact : compact.slice(prefix.length);
}

/**
 * An elapsed time as a tool or turn shows it: 4.2s, 42s, 5m 3s, 1h 12m. A
 * negative span reads as zero.
 *
 * @category presentation
 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;

  if (seconds < 10) return `${seconds.toFixed(1)}s`;

  if (seconds < 60) return `${String(Math.floor(seconds))}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${String(minutes)}m ${String(Math.floor(seconds % 60))}s`;

  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

/**
 * A subject short enough for a narrow line, with the full one as `title`
 * when they differ.
 *
 * @category presentation
 */
export interface ToolDetail {
  readonly text: string;
  readonly title?: string;
}

/**
 * The compact subject of a call, relative to the working directory.
 *
 * @category presentation
 */
export function toolDetail(toolClass: ToolClass, cwd: string | undefined): ToolDetail | undefined {
  switch (toolClass.kind) {
    case "edit": {
      const title = tidyPath(toolClass.path, cwd);

      return { text: basename(title), title };
    }

    case "read":
    case "list":
      return { text: placeName(toolClass.path, cwd), title: tidyPath(toolClass.path, cwd) };
    case "shell":
      return { text: condensedCommand(toolClass.command, cwd) };
    case "delegate":
      return { text: delegateSubject(toolClass) };
    case "custom": {
      const detail = customDetail(customTool(toolClass.label));

      return detail === undefined ? undefined : { text: detail };
    }

    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

/**
 * The step that gets a failed run going again. Each client names it its own
 * way: a command, a key or a settings page.
 *
 * @category presentation
 */
export type Recovery = "compact" | "sign-in" | "switch-model";

/**
 * What a failed run says: one sentence, its tone, and the step that recovers
 * from it when the user has one to take.
 *
 * @category presentation
 */
export interface FailureNotice {
  readonly text: string;
  readonly tone: "neutral" | "danger";
  readonly recovery: Recovery | undefined;
}

const NOTICE_LIMIT = 180;

function oneLine(message: string): string | undefined {
  const compact = message.replaceAll(/\s+/gu, " ").trim();

  if (compact === "") return undefined;

  return compact.length <= NOTICE_LIMIT
    ? compact
    : `${compact.slice(0, NOTICE_LIMIT - 1).trimEnd()}…`;
}

function danger(notice: string, recovery?: Recovery): FailureNotice {
  return { text: notice, tone: "danger", recovery };
}

/**
 * The notice for a run's failure.
 *
 * @category presentation
 */
export function failureNotice(failure: Failure): FailureNotice {
  switch (failure.class) {
    case "aborted":
      return { text: "Run stopped.", tone: "neutral", recovery: undefined };
    case "rate_limit":
      return danger("Rate limit reached. Try again shortly.");
    case "context_window":
      return danger("This chat no longer fits the model's context window.", "compact");
    case "quota":
      return danger("Provider quota reached.", "switch-model");
    case "auth":
      return danger("The provider rejected the sign-in.", "sign-in");
    case "overloaded":
      return danger("The model is temporarily unavailable. Try again shortly.");
    case "network":
      return danger("Connection lost. Check your network and try again.");
    case "provider":
    case "runner":
      return danger(oneLine(failure.message) ?? "Request failed.");
    default: {
      const _exhaustive: never = failure.class;

      return _exhaustive;
    }
  }
}
