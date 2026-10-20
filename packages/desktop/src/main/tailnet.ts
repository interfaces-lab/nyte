import { execFile } from "node:child_process";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ExpectedHostError } from "./errors.ts";

const CLI_PATHS = [
  "/usr/local/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/bin/tailscale",
] as const;

const statusSchema = Type.Object(
  {
    BackendState: Type.String(),
    TailscaleIPs: Type.Optional(Type.Array(Type.String())),
    Self: Type.Optional(
      Type.Object(
        {
          DNSName: Type.Optional(Type.String()),
          Capabilities: Type.Optional(Type.Array(Type.String())),
          CapMap: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);

const serveStatusSchema = Type.Object(
  {
    Web: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Object(
          {
            Handlers: Type.Optional(
              Type.Record(
                Type.String(),
                Type.Object(
                  { Proxy: Type.Optional(Type.String()) },
                  { additionalProperties: true },
                ),
              ),
            ),
          },
          { additionalProperties: true },
        ),
      ),
    ),
  },
  { additionalProperties: true },
);

const SERVE_TIMEOUT_MS = 15_000;

interface TailnetAddress {
  readonly ip: string;
  readonly name: string | undefined;
  readonly https: boolean;
}

type TailnetLookup =
  | { readonly kind: "ready"; readonly cli: string; readonly address: TailnetAddress }
  | { readonly kind: "unavailable"; readonly state: string }
  | { readonly kind: "missing" };

function runFile(executable: string, arguments_: readonly string[], timeout = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      arguments_,
      { encoding: "utf8", maxBuffer: 1_048_576, windowsHide: true, timeout },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function inTailnetRange(value: string): boolean {
  const octets = value.split(".").map(Number);

  if (octets.length !== 4) return false;

  if (!octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return false;
  const [first, second] = octets;

  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

function parseStatus(cli: string, output: string): TailnetLookup {
  const parsed: unknown = JSON.parse(output);
  const status = Value.Parse(statusSchema, parsed);

  if (status.BackendState !== "Running") {
    return { kind: "unavailable", state: status.BackendState };
  }

  const ip = status.TailscaleIPs?.find((candidate) => inTailnetRange(candidate));

  if (ip === undefined) return { kind: "unavailable", state: status.BackendState };
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "");

  const https =
    (status.Self?.CapMap !== undefined && "https" in status.Self.CapMap) ||
    (status.Self?.Capabilities?.includes("https") ?? false);

  return {
    kind: "ready",
    cli,
    address: { ip, name: dnsName === undefined || dnsName === "" ? undefined : dnsName, https },
  };
}

export async function findTailnetAddress(platform: NodeJS.Platform): Promise<TailnetLookup> {
  if (platform === "win32") return { kind: "missing" };

  for (const cliPath of CLI_PATHS) {
    let output: string;

    try {
      output = await runFile(cliPath, ["status", "--json"]);
    } catch {
      continue;
    }

    try {
      return parseStatus(cliPath, output);
    } catch {
      return { kind: "unavailable", state: "Unknown" };
    }
  }

  return { kind: "missing" };
}

const SERVE_PORT = 443;

function tailnetUnavailable(message: string): ExpectedHostError {
  return new ExpectedHostError({ code: "unavailable", message });
}

/**
 * Serves `http://127.0.0.1:<port>` at `https://<this Mac>.ts.net` with Tailscale Serve, so a page
 * on an HTTPS origin can reach it. A port-443 mapping to another loopback port is a stale one of
 * ours and is replaced; any other mapping is the user's and is refused.
 */
export async function serveTailnet(port: number): Promise<{
  readonly address: string;
  readonly stop: () => Promise<void>;
}> {
  const lookup = await findTailnetAddress(process.platform);

  if (lookup.kind === "missing") throw tailnetUnavailable("Tailscale isn't installed on this Mac.");

  if (lookup.kind === "unavailable")
    throw tailnetUnavailable("Tailscale isn't running. Start it, then try again.");
  const { cli, address } = lookup;

  if (address.name === undefined)
    throw tailnetUnavailable("Turn on MagicDNS in the Tailscale admin console, then try again.");

  if (!address.https)
    throw tailnetUnavailable(
      "Turn on HTTPS certificates in the Tailscale admin console, then try again.",
    );
  const name = address.name;
  const output = await runFile(cli, ["serve", "status", "--json"], SERVE_TIMEOUT_MS);
  const status = Value.Parse(serveStatusSchema, JSON.parse(output.trim() === "" ? "{}" : output));
  const handlers = Object.values(status.Web?.[`${name}:${String(SERVE_PORT)}`]?.Handlers ?? {});

  if (handlers.some((handler) => !(handler.Proxy?.startsWith("http://127.0.0.1:") ?? false)))
    throw tailnetUnavailable(
      `Tailscale already serves something at https://${name}. Run \`tailscale serve --https=${String(SERVE_PORT)} off\`, then try again.`,
    );
  const target = `http://127.0.0.1:${String(port)}`;

  try {
    await runFile(
      cli,
      ["serve", "--bg", `--https=${String(SERVE_PORT)}`, target],
      SERVE_TIMEOUT_MS,
    );
  } catch {
    throw tailnetUnavailable(
      `Tailscale couldn't serve this Mac over HTTPS. Run \`tailscale serve --https=${String(SERVE_PORT)} ${target}\` to see why.`,
    );
  }

  return {
    address: `https://${name}`,
    stop: async () => {
      await runFile(cli, ["serve", `--https=${String(SERVE_PORT)}`, "off"], SERVE_TIMEOUT_MS);
    },
  };
}
