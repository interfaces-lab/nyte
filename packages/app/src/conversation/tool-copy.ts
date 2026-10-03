import type { Failure, ToolClass } from "@nyte-ai/protocol";

export type ToolPhase = "running" | "done" | "failed" | "interrupted";

export function tidyPath(path: string, cwd: string | undefined): string {
  if (cwd !== undefined && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);

  return path;
}

function basename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

export function placeName(path: string, cwd: string | undefined): string {
  const tidy = tidyPath(path, cwd);

  if (tidy === "." || tidy === "./" || tidy === cwd) return basename(cwd ?? tidy) || tidy;

  return basename(tidy.replace(/[\\/]+$/u, "")) || tidy;
}

export interface ToolVerbs {
  readonly running: string;
  readonly done: string;
  readonly error: string;
}

export interface CustomTool {
  readonly verbs: ToolVerbs;
  readonly name?: string;
  readonly server?: string;
  readonly detail?: string;
}

const RAN: ToolVerbs = { running: "Running", done: "Ran", error: "Run" };

const NAMED_TOOLS = new Map<string, CustomTool>([
  ["codemode", { verbs: { running: "Running script", done: "Ran script", error: "Run script" } }],
  [
    "tool_search",
    {
      verbs: { running: "Exploring", done: "Explored", error: "Explore" },
      detail: "available tools",
    },
  ],
  ["websearch", { verbs: { running: "Searching web", done: "Searched web", error: "Search web" } }],
  [
    "web_search",
    { verbs: { running: "Searching web", done: "Searched web", error: "Search web" } },
  ],
  ["webfetch", { verbs: { running: "Fetching page", done: "Fetched page", error: "Fetch page" } }],
  ["web_fetch", { verbs: { running: "Fetching page", done: "Fetched page", error: "Fetch page" } }],
  [
    "rename_chat",
    { verbs: { running: "Renaming chat", done: "Renamed chat", error: "Rename chat" } },
  ],
  ["browser_open", { verbs: { running: "Opening page", done: "Opened page", error: "Open page" } }],
  ["browser_click", { verbs: { running: "Clicking", done: "Clicked", error: "Click" } }],
  ["browser_type", { verbs: { running: "Typing", done: "Typed", error: "Type" } }],
  [
    "browser_press",
    { verbs: { running: "Pressing key", done: "Pressed key", error: "Press key" } },
  ],
  ["browser_scroll", { verbs: { running: "Scrolling", done: "Scrolled", error: "Scroll" } }],
  ["browser_wait", { verbs: { running: "Waiting", done: "Waited", error: "Wait" } }],
  [
    "browser_snapshot",
    {
      verbs: { running: "Taking snapshot", done: "Took snapshot", error: "Take snapshot" },
    },
  ],
  [
    "browser_console",
    {
      verbs: {
        running: "Checking console logs",
        done: "Checked console logs",
        error: "Check console logs",
      },
    },
  ],
  [
    "browser_evaluate",
    { verbs: { running: "Executing JS", done: "Executed JS", error: "Execute JS" } },
  ],
]);

const MCP_LABEL = /^(?<server>[^:\s]+): (?<name>\S+)$/u;

const MCP_NAME = /^mcp__(?<server>.+?)__(?<name>.+)$/u;

export function customTool(label: string): CustomTool {
  const named = NAMED_TOOLS.get(label);

  if (named !== undefined) return named;

  const mcp = (MCP_LABEL.exec(label) ?? MCP_NAME.exec(label))?.groups;

  if (mcp?.server !== undefined && mcp.name !== undefined) {
    return { verbs: RAN, name: mcp.name, server: mcp.server };
  }

  if (/\s/u.test(label)) return { verbs: { running: label, done: label, error: label } };

  return { verbs: RAN, name: label };
}

export function customDetail(tool: CustomTool): string | undefined {
  if (tool.name === undefined) return tool.detail;

  return tool.server === undefined ? tool.name : `${tool.name} in ${tool.server}`;
}

export function condensedCommand(command: string, cwd: string | undefined): string {
  const compact = command.replaceAll(/\s+/gu, " ").trim();

  if (cwd === undefined) return compact;

  const prefix = [cwd, `"${cwd}"`, `'${cwd}'`]
    .flatMap((dir) => [`cd ${dir} && `, `cd ${dir}; `])
    .find((candidate) => compact.startsWith(candidate));

  return prefix === undefined ? compact : compact.slice(prefix.length);
}

interface ToolDetail {
  readonly text: string;
  readonly title?: string;
}

export function toolDetail(
  toolClass: Exclude<ToolClass, { readonly kind: "delegate" }>,
  cwd: string | undefined,
): ToolDetail | undefined {
  switch (toolClass.kind) {
    case "file_edit":
    case "file_write":
    case "file_patch": {
      const title = tidyPath(toolClass.path, cwd);

      return { text: basename(title), title };
    }

    case "file_read":
    case "list":
      return { text: placeName(toolClass.path, cwd), title: tidyPath(toolClass.path, cwd) };
    case "shell":
      return { text: condensedCommand(toolClass.command, cwd) };
    case "custom": {
      const text = customDetail(customTool(toolClass.label));

      return text === undefined ? undefined : { text };
    }

    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

function phased(
  phase: ToolPhase,
  words: {
    readonly running: string;
    readonly done: string;
    readonly noun: string;
    readonly interrupted?: string;
  },
): string {
  switch (phase) {
    case "running":
      return words.running;
    case "done":
      return words.done;
    case "failed":
      return `${words.noun} failed`;
    case "interrupted":
      return words.interrupted ?? `${words.noun} stopped`;
    default: {
      const _exhaustive: never = phase;

      return _exhaustive;
    }
  }
}

export function toolVerb(
  toolClass: Exclude<ToolClass, { readonly kind: "delegate" }>,
  phase: ToolPhase,
): string {
  switch (toolClass.kind) {
    case "file_read":
      return phased(phase, { running: "Reading", done: "Read", noun: "Read" });
    case "list":
      return phased(phase, { running: "Listing", done: "Listed", noun: "List" });
    case "shell":
      return phased(phase, { running: "Running", done: "Ran", noun: "Command" });
    case "file_edit":
      return phased(phase, { running: "Editing", done: "Edited", noun: "Edit" });
    case "file_write":
      return phased(phase, { running: "Writing", done: "Wrote", noun: "Write" });
    case "file_patch":
      return toolClass.op === "edit"
        ? phased(phase, { running: "Editing", done: "Edited", noun: "Edit" })
        : phased(phase, { running: "Writing", done: "Wrote", noun: "Write" });
    case "custom": {
      const { verbs } = customTool(toolClass.label);

      return phased(phase, { running: verbs.running, done: verbs.done, noun: verbs.error });
    }

    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

const NOTICE_LIMIT = 180;

function oneLine(message: string): string | undefined {
  const compact = message.replaceAll(/\s+/gu, " ").trim();

  if (compact === "") return undefined;

  return compact.length <= NOTICE_LIMIT
    ? compact
    : `${compact.slice(0, NOTICE_LIMIT - 3).trimEnd()}…`;
}

type FailureNotice = {
  readonly text: string;
  readonly tone: "neutral" | "danger";
};

export function failureNotice(failure: Failure): FailureNotice {
  switch (failure.class) {
    case "aborted":
      return { text: "Run stopped.", tone: "neutral" };
    case "rate_limit":
      return { text: "Rate limit reached. Try again shortly.", tone: "danger" };
    case "context_window":
      return { text: "This chat exceeded the model's context window.", tone: "danger" };
    case "quota":
      return { text: "Provider quota reached. Try another model or account.", tone: "danger" };
    case "auth":
      return { text: "Authentication failed. Check the provider account.", tone: "danger" };
    case "overloaded":
      return { text: "The model is temporarily unavailable. Try again shortly.", tone: "danger" };
    case "network":
      return { text: "Connection lost. Check your network and try again.", tone: "danger" };
    case "provider":
    case "runner":
      return { text: oneLine(failure.message) ?? "Request failed.", tone: "danger" };
    default: {
      const _exhaustive: never = failure.class;

      return _exhaustive;
    }
  }
}
