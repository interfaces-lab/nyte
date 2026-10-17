import type {
  McpExposure,
  McpExposureName,
  McpServerState,
  McpServerView,
  McpView,
} from "@nyte-ai/sdk";
import type { Choice } from "./dialogs/list.ts";

function row(
  id: string,
  label: string,
  description: string,
  badge: Choice["status"] = null,
): Choice {
  return { id, label, description, timing: null, status: badge, mark: null };
}

function attention(server: McpServerView): number {
  return server.state.kind === "failed" || server.state.kind === "needs-sign-in" ? 0 : 1;
}

function status(state: McpServerState): NonNullable<Choice["status"]> {
  switch (state.kind) {
    case "connected":
      return {
        text: `${String(state.tools.length)} ${state.tools.length === 1 ? "tool" : "tools"}`,
        tone: "ok",
      };
    case "connecting":
      return { text: "connecting", tone: "muted" };
    case "disabled":
      return { text: "off", tone: "muted" };
    case "needs-sign-in":
      return { text: "needs sign-in", tone: "warning" };
    case "failed":
      return { text: "failed", tone: "error" };
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

/** An exposure as `mcp.json` names it. */
export function exposureName(exposure: McpExposure): McpExposureName {
  switch (exposure) {
    case "model":
      return "direct";
    case "code":
      return "codemode";
    case "deferred":
    case "hidden":
      return exposure;
    default: {
      const _exhaustive: never = exposure;

      return _exhaustive;
    }
  }
}

/** Where a server runs: its url, or its command line. */
export function target(server: McpServerView): string {
  return server.transport.kind === "http"
    ? server.transport.url
    : [server.transport.command, ...server.transport.args].join(" ");
}

/** `/mcp`'s rows: servers that need attention first, then the rest, then problems in `mcp.json`. */
export function mcpServerChoices(view: McpView): readonly Choice[] {
  const servers = view.servers
    .toSorted((left, right) => attention(left) - attention(right))
    .map((server) =>
      row(
        `server:${server.name}`,
        server.name,
        server.state.kind === "failed" ? server.state.message : target(server),
        status(server.state),
      ),
    );

  const issues = view.issues.map((issue, index) =>
    row(`issue:${String(index)}`, issue.source?.file ?? "mcp.json", issue.message, {
      text: "invalid",
      tone: "error",
    }),
  );

  if (servers.length > 0 || issues.length > 0) return [...servers, ...issues];

  return [
    row(
      "none",
      "No MCP servers",
      "Add one with `nyte mcp add`, or under mcpServers in ~/.nyte/mcp.json",
    ),
  ];
}

/** What can be done to one server, from its state. */
export function mcpActionChoices(server: McpServerView): readonly Choice[] {
  const where = server.override ?? server.path;
  const enabled = server.state.kind !== "disabled";
  const http = server.transport.kind === "http";

  return [
    ...(http && enabled
      ? [
          row(
            "login",
            "Sign in",
            server.state.kind === "needs-sign-in" ? "Open the authorization page" : "Sign in again",
          ),
        ]
      : []),
    ...(enabled ? [row("reconnect", "Reconnect", "Drop the connection and connect again")] : []),
    enabled
      ? row("disable", "Turn off", `Saves enabled: false to ${where}`)
      : row("enable", "Turn on", `Saves to ${where}`),
    ...(http ? [row("logout", "Sign out", "Delete the stored credentials")] : []),
    row("details", "Details", "Tools, errors and where it is configured"),
  ];
}

/** The details view of one server. */
export function mcpDetailLines(server: McpServerView): readonly string[] {
  const { state } = server;

  const stateLines =
    state.kind === "connected"
      ? [
          `Tools (${String(state.tools.length)}):`,
          ...state.tools.map((tool) =>
            tool.exposure === server.exposure
              ? `  ${tool.name}`
              : `  ${tool.name} (${exposureName(tool.exposure)})`,
          ),
        ]
      : state.kind === "failed"
        ? [
            `Failed: ${state.message}`,
            ...(state.stderr === null ? [] : ["", "stderr:", ...state.stderr.split("\n")]),
          ]
        : [`State: ${status(state).text}`];

  return [
    target(server),
    `Configured in ${server.path}${server.override === null ? "" : `, overridden in ${server.override}`}`,
    `Exposure: ${exposureName(server.exposure)}`,
    ...(server.description === null ? [] : [server.description]),
    "",
    ...stateLines,
  ];
}
