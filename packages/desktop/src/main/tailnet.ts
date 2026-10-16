import { execFile } from "node:child_process";
import { Type } from "typebox";
import { Value } from "typebox/value";

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
      Type.Object({ DNSName: Type.Optional(Type.String()) }, { additionalProperties: true }),
    ),
  },
  { additionalProperties: true },
);

export interface TailnetAddress {
  readonly ip: string;
  readonly name: string | undefined;
}

export type TailnetLookup =
  | { readonly kind: "ready"; readonly address: TailnetAddress }
  | { readonly kind: "unavailable"; readonly state: string }
  | { readonly kind: "missing" };

function runFile(executable: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      arguments_,
      { encoding: "utf8", maxBuffer: 1_048_576, windowsHide: true },
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

function parseStatus(output: string): TailnetLookup {
  const parsed: unknown = JSON.parse(output);
  const status = Value.Parse(statusSchema, parsed);

  if (status.BackendState !== "Running") {
    return { kind: "unavailable", state: status.BackendState };
  }

  const ip = status.TailscaleIPs?.find((candidate) => inTailnetRange(candidate));

  if (ip === undefined) return { kind: "unavailable", state: status.BackendState };
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "");

  return {
    kind: "ready",
    address: { ip, name: dnsName === undefined || dnsName === "" ? undefined : dnsName },
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
      return parseStatus(output);
    } catch {
      return { kind: "unavailable", state: "Unknown" };
    }
  }

  return { kind: "missing" };
}
