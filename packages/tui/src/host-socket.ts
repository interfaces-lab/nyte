import { existsSync } from "node:fs";
import { openHostSocket, encodeError } from "@nyte-ai/protocol";
import type { HostSocket } from "@nyte-ai/protocol";
import { SdkError } from "@nyte-ai/schema";
import type { SdkErrorCode } from "@nyte-ai/schema";
import { findRunningHost, hostFilePath } from "@nyte-ai/service/host-endpoint";
import type { CommandName } from "./cli/commands.ts";
import { CliError } from "./cli/errors.ts";
import type { Reason } from "./cli/errors.ts";
import { printable } from "./cli/format.ts";
import type { HostSource } from "./local-host.ts";
import { VERSION } from "./version.ts";

/** What each wire code means for the command that sent the call: its reason, and the cause after `<action>: `. */
const HOST_FAILURES: Readonly<
  Record<SdkErrorCode, { readonly reason: Reason; readonly verb: string; readonly cause: string }>
> = {
  invalid: { reason: "invalid_arguments", verb: "Can't", cause: "the host rejected the input" },
  unknown: { reason: "not_found", verb: "Couldn't", cause: "the host found no match" },
  stale: { reason: "conflict", verb: "Couldn't", cause: "the host's state changed first" },
  unauthenticated: {
    reason: "auth_required",
    verb: "Can't",
    cause: "the host needs a valid token",
  },
  denied: { reason: "permission_denied", verb: "Can't", cause: "the host denied it" },
  not_supported: { reason: "failed", verb: "Can't", cause: "the host doesn't support it" },
  unavailable: { reason: "network_error", verb: "Couldn't", cause: "the host is unavailable" },
  timeout: {
    reason: "failed",
    verb: "Couldn't",
    cause: "the host timed out, and it may still finish",
  },
  internal: { reason: "failed", verb: "Failed to", cause: "the host hit an internal error" },
};

/** `--host-url` as given, checked before any request. */
export function readHostUrl(command: CommandName, url: string | undefined): string | undefined {
  if (url === undefined || URL.canParse(url)) return url;

  throw new CliError("invalid_arguments", `Can't read --host-url ${url} as a URL.`, {
    next: [{ label: "See the options", argv: ["nyte", command, "--help"] }],
  });
}

/** Never starts a host: a read or a stream fails with `host_not_running` when this home runs none. */
export async function connectHostSocket(input: {
  readonly source: HostSource;
  readonly name: string;
}): Promise<HostSocket> {
  const endpoint = await findEndpoint(input.source);

  return openHostSocket({
    socket: new WebSocket(endpoint.url, {
      headers: { Authorization: `Bearer ${endpoint.token}` },
    }),
    client: { kind: "cli", name: input.name, version: VERSION, actions: [] },
  }).catch((error: unknown) => {
    if (!(error instanceof SdkError)) throw error;

    if (input.source.kind === "local")
      throw new CliError("network_error", "Couldn't connect to the running host's socket.");

    throw new CliError("network_error", "Couldn't connect to the host at --host-url.", {
      details: [
        { label: "URL", value: input.source.endpoint.url },
        { label: "Token", value: "A wrong NYTE_HOST_TOKEN fails this way too" },
      ],
    });
  });
}

/**
 * A rejection handler for a host request: an `SdkError` becomes the error the command ends with.
 * The host's message is remote text, so it goes in a detail row, never the headline; `--json`
 * carries the whole wire error as `data`. `action` is what the command tried, such as `call head.send`.
 */
export function hostFailure(action: string): (error: unknown) => never {
  return (error) => {
    if (!(error instanceof SdkError)) throw error;
    const failure = HOST_FAILURES[error.code];

    throw new CliError(failure.reason, `${failure.verb} ${action}: ${failure.cause}.`, {
      details: [
        { label: "Host error", value: printable(error.message) },
        ...(error.correlation === null ? [] : [{ label: "Correlation", value: error.correlation }]),
      ],
      data: encodeError(error),
    });
  };
}

async function findEndpoint(
  source: HostSource,
): Promise<{ readonly url: string; readonly token: string }> {
  if (source.kind === "attached")
    return { url: socketUrl(source.endpoint.url), token: source.endpoint.token };

  const running = await findRunningHost(hostFilePath());

  if (running === null)
    throw new CliError("host_not_running", "Can't reach a Nyte host: none is running.", {
      next: [{ label: "Start one in another terminal", argv: ["nyte", "host"] }],
    });

  if (running.socket !== undefined && existsSync(running.socket))
    return { url: `ws+unix://${running.socket}:/.nyte/ws`, token: running.token };

  return { url: socketUrl(running.url), token: running.token };
}

function socketUrl(hostUrl: string): string {
  const url = new URL("/.nyte/ws", hostUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  return url.href;
}
