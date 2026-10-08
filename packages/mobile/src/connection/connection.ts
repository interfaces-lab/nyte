import { NyteTransportError, NyteWireError } from "@nyte-ai/client";
import { relayAddress, Uuid } from "@nyte-ai/connect";
import { SHARE_LOCATION } from "./connect-copy.ts";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const connectionProperties = {
  name: Type.String({ minLength: 1 }),
  url: Type.String({ minLength: 1 }),
  token: Type.String({ minLength: 1 }),
};

const ConnectionSchema = Type.Object(connectionProperties, { additionalProperties: false });

export type Connection = Static<typeof ConnectionSchema>;

/**
 * A connection the phone enrolled through a Nyte account. It keeps the broker
 * that enrolled it and the account that owns it, so signing out or switching
 * accounts can find and remove exactly this credential.
 */
const ManagedConnectionSchema = Type.Object(
  {
    ...connectionProperties,
    origin: Type.String({ minLength: 1 }),
    environmentId: Uuid,
    deviceId: Uuid,
    ownerId: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export type AccountBinding = Omit<Static<typeof ManagedConnectionSchema>, keyof Connection>;

export type SavedConnection =
  | { readonly kind: "manual"; readonly connection: Connection }
  | { readonly kind: "managed"; readonly connection: Connection; readonly binding: AccountBinding };

export type ManagedConnection = Extract<SavedConnection, { kind: "managed" }>;

/** The broker this build trusts, which a restored account connection must match. */
export interface ManagedPolicy {
  readonly origin: string;
}

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

/**
 * Decode a connection saved as JSON, then apply the same checks as a typed
 * one. A manual connection keeps the shape it has always been saved in.
 *
 * An account connection is held to `policy` again: its broker must be this
 * build's broker and its address exactly that broker's relay for its own Mac.
 * HTTPS alone proves nothing about which host it is. A build without account
 * configuration, or one pointed at another broker, cannot vouch for it and
 * refuses it, so the user picks the Mac again.
 */
export function parseStoredConnection(
  text: string,
  policy: ManagedPolicy | undefined,
): SavedConnection {
  const value: unknown = JSON.parse(text);

  if (Value.Check(ManagedConnectionSchema, value)) {
    const { origin, environmentId, deviceId, ownerId, ...fields } = value;

    if (
      policy === undefined ||
      origin !== policy.origin ||
      fields.url !== relayAddress(policy.origin, environmentId)
    )
      throw new Error("The saved account connection is outside this build's Nyte Connect.");

    return {
      kind: "managed",
      connection: parseConnection(fields),
      binding: { origin, environmentId, deviceId, ownerId },
    };
  }

  if (!Value.Check(ConnectionSchema, value))
    throw new Error("Enter a name, the address and the token.");

  return { kind: "manual", connection: parseConnection(value) };
}

export function serializeConnection(saved: SavedConnection): string {
  return JSON.stringify(
    saved.kind === "manual" ? saved.connection : { ...saved.connection, ...saved.binding },
  );
}

export function parseConnection(value: Connection): Connection {
  const name = value.name.trim();
  const token = value.token.trim();

  if (!name || !token || value.url === "")
    throw new Error("Enter a name, the address and the token.");
  let url: URL;

  try {
    url = new URL(value.url.trim());
  } catch {
    throw new Error("Enter the full address, including http:// or https://.");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isPrivateHost(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP with the computer's local or Tailscale address.");
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
      return `The host refused the token. Scan a new code from ${SHARE_LOCATION}, or use the current token from nyte serve.`;

    if (cause.code === "unknown_session") return "This conversation is no longer available.";

    if (cause.code === "closed") return "Nyte is closed on the host.";

    // The one error a version difference produces: the app asked for something
    // this host's Nyte does not serve yet.
    if (cause.code === "unknown_operation")
      return "The host is running an older Nyte than this app. Update it there.";

    return "The host couldn't complete the request.";
  }

  if (cause instanceof NyteTransportError) {
    switch (cause.failure.kind) {
      case "network":
        return "Couldn't reach the host. Check the address and that sharing is on.";
      case "disconnected":
        return "The connection to the host dropped.";
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

  return "Couldn't reach the host. Check that Nyte is running.";
}
