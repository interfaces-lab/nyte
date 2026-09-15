import { NyteTransportError, NyteWireError } from "@nyte-ai/client";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const ConnectionSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    url: Type.String({ minLength: 1 }),
    token: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type Connection = Static<typeof ConnectionSchema>;

/**
 * Plain HTTP is allowed only toward loopback, private IPv4 ranges, and the
 * Tailscale range, checked numerically. 100.64.0.0/10 is shared address space
 * rather than a private network, so it is accepted for a narrower reason than
 * the others: reaching one means the device is already inside an authenticated
 * tailnet, and the host binds that address alone.
 */
function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]" || hostname.endsWith(".local")) return true;
  if (hostname.endsWith(".ts.net")) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4) return false;
  if (!octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return false;
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function parseConnection(value: unknown): Connection {
  if (!Value.Check(ConnectionSchema, value))
    throw new Error("Enter a name, the address and the token.");
  const name = value.name.trim();
  const token = value.token.trim();
  if (!name || !token) throw new Error("Enter a name, the address and the token.");
  let url: URL;
  try {
    url = new URL(value.url.trim());
  } catch {
    throw new Error("Enter the full address, including http:// or https://.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isPrivateHost(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP with your Mac's local or Tailscale address.");
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Enter only the address. The token has its own field.");
  url.search = "";
  url.hash = "";
  return { name, url: url.href.replace(/\/$/, ""), token };
}

/** Host address without scheme or path, safe to show next to the host name. */
export function displayAddress(connection: Connection): string {
  return new URL(connection.url).host;
}

/**
 * The pairing payload a desktop QR code carries, and the same string the user
 * can paste: `nyte://connect?name=…&url=…&token=…`. It is untrusted text until
 * `parseConnection` has checked the address policy.
 */
export function parseConnectionPayload(text: string): Connection {
  const trimmed = text.trim();
  let link: URL;
  try {
    link = new URL(trimmed);
  } catch {
    throw new Error("That code isn't a Nyte connection.");
  }
  if (link.protocol !== "nyte:" || link.host !== "connect") {
    throw new Error("That code isn't a Nyte connection.");
  }
  const url = link.searchParams.get("url");
  const token = link.searchParams.get("token");
  if (url === null || token === null) {
    throw new Error("That code is missing the address or the token.");
  }
  return parseConnection({ name: link.searchParams.get("name") ?? "My Mac", url, token });
}

export function describeHostError(cause: unknown): string {
  if (cause instanceof NyteWireError) {
    if (cause.code === "unauthorized" || cause.code === "forbidden")
      return "Your Mac refused the token. Copy it again from Settings › Server.";
    if (cause.code === "unknown_session") return "This conversation is no longer available.";
    if (cause.code === "closed") return "Nyte is closed on your Mac.";
    return "Your Mac couldn't complete the request.";
  }
  if (cause instanceof NyteTransportError) {
    switch (cause.failure.kind) {
      case "network":
        return "Couldn't reach your Mac. Check the address and that sharing is on.";
      case "disconnected":
        return "The connection to your Mac dropped.";
      case "bad_status":
      case "bad_content_type":
      case "bad_body":
        return "That address answered, but not as a Nyte server.";
      default: {
        const exhaustive: never = cause.failure;
        return exhaustive;
      }
    }
  }
  return "Couldn't reach your Mac. Check that Nyte is running.";
}
