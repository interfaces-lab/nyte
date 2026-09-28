/**
 * Tailscale address discovery for the iOS share. Binding the share listener to
 * the tailnet address, rather than every interface, is what keeps it off the
 * local network: only devices in the same tailnet can route to 100.64.0.0/10,
 * and Tailscale has already authenticated them.
 *
 * `tailscale ip` answers from cached state even while the daemon is stopped,
 * and binding an address whose interface is down fails. Only `BackendState`
 * proves the address is live, so discovery always reads the full status.
 */
import { execFile } from "node:child_process";
import { Type } from "typebox";
import { Value } from "typebox/value";

/** The paths a macOS or Linux install puts the CLI in, in the order to try them. */
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
  /** This machine's IPv4 address on the tailnet, the one the listener binds. */
  readonly ip: string;
  /** The MagicDNS name without its trailing dot, shown instead of the raw address. */
  readonly name: string | undefined;
}

export type TailnetLookup =
  | { readonly kind: "ready"; readonly address: TailnetAddress }
  /** Installed but not usable yet: the daemon is stopped, or the machine is logged out. */
  | { readonly kind: "unavailable"; readonly state: string }
  | { readonly kind: "missing" };

type CommandRunner = (executable: string, arguments_: readonly string[]) => Promise<string>;

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

/** The 100.64.0.0/10 shared address space Tailscale assigns, checked numerically. */
export function isTailnetIpv4(value: string): boolean {
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

  const ip = status.TailscaleIPs?.find((candidate) => isTailnetIpv4(candidate));

  if (ip === undefined) return { kind: "unavailable", state: status.BackendState };
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "");

  return {
    kind: "ready",
    address: { ip, name: dnsName === undefined || dnsName === "" ? undefined : dnsName },
  };
}

/**
 * Find this machine's tailnet address, or say why there isn't one. A missing
 * CLI and a stopped daemon are different answers because the user can fix the
 * second one without installing anything.
 */
export async function findTailnetAddress(
  platform: NodeJS.Platform,
  run: CommandRunner = runFile,
): Promise<TailnetLookup> {
  if (platform === "win32") return { kind: "missing" };

  for (const cliPath of CLI_PATHS) {
    let output: string;

    try {
      output = await run(cliPath, ["status", "--json"]);
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
