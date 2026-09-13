import { NyteTransportError, NyteWireError } from "@nyte-ai/client";
import type { ModelInfo } from "@nyte-ai/protocol";
import type { DesktopCatalog, ServerConnectionProblem } from "../shared/ipc.ts";

/** Fixed desktop copy; response bodies and upstream exception text stay in diagnostics. */
export function serverConnectionProblem(cause: unknown): ServerConnectionProblem {
  if (cause instanceof NyteWireError) {
    if (cause.code === "unauthorized" || cause.code === "forbidden") {
      return {
        kind: "authentication",
        message: "The server rejected this token. Update the connection token.",
      };
    }
    if (cause.code === "not_found" || cause.code === "unknown_operation") {
      return {
        kind: "incompatible",
        message: "This server does not support the desktop's protocol. Check its URL and version.",
      };
    }
    return {
      kind: "server",
      message:
        "The server could not complete this request. Check its deployment logs and try again.",
    };
  }
  if (cause instanceof NyteTransportError && cause.failure.kind !== "network") {
    const status = "status" in cause.failure ? cause.failure.status : undefined;
    if (status === 401 || status === 403) {
      return {
        kind: "authentication",
        message: "The deployment refused access. Check its protection settings and server token.",
      };
    }
    return {
      kind: "incompatible",
      message: "The server returned an unexpected response. Check its URL and deployment.",
    };
  }
  return {
    kind: "network",
    message: "Cannot reach the server. Check your connection and try again.",
  };
}

/** Remote choices never inherit local credentials, hidden models, or plugin settings. */
export function serverCatalog(
  models: readonly ModelInfo[],
  defaultModel: ModelInfo,
): DesktopCatalog {
  return {
    source: "server",
    providers: [...new Set(models.map((model) => model.provider))].map((provider) => ({
      id: provider,
      name: provider,
      enabled: true,
      connection: { kind: "server" },
      signIn: [],
    })),
    defaults: {
      model: { provider: defaultModel.provider, id: defaultModel.id },
      thinkingLevel: "off",
    },
    models: models.map((model) => ({
      ...model,
      key: `${model.provider}/${model.id}`,
      fastMode: { kind: "unavailable" },
      hidden: false,
      listed: true,
    })),
  };
}
