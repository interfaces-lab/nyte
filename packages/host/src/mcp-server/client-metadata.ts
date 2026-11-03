import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Type } from "typebox";
import { compile, isJson } from "@nyte-ai/schema";
import type { McpClient } from "./grants.ts";

/** One answer from a client's metadata URL: its status, the headers that set how long it may be cached, and its body. */
export type ClientMetadataAnswer = {
  readonly status: number;
  readonly cacheControl: string | null;
  readonly expires: string | null;
  readonly body: string;
};

/** Fetches a Client ID Metadata Document; it refuses what it may not fetch by throwing. */
export type ClientMetadataFetch = (url: URL) => Promise<ClientMetadataAnswer>;

/** Finds the clients that identify themselves by a metadata document URL. */
export interface ClientDirectory {
  find(clientId: string): Promise<McpClient | null>;
}

type Cached = { readonly client: McpClient; readonly until: number };

const MAX_BYTES = 5 * 1024;

const TIMEOUT_MS = 5_000;

const DEFAULT_CACHE_MS = 60_000;

const MAX_CACHE_MS = 24 * 60 * 60 * 1000;

const MAX_CACHED = 256;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const document = compile(
  Type.Object({
    client_id: Type.String(),
    client_name: Type.String({ minLength: 1, maxLength: 200 }),
    redirect_uris: Type.Array(Type.String(), { minItems: 1, maxItems: 16 }),
    token_endpoint_auth_method: Type.Optional(Type.String()),
  }),
);

const PRIVATE = privateRanges();

/** Whether `clientId` names a metadata document: an https URL with a path, no fragment and no credentials. */
export function namesMetadataDocument(clientId: string): boolean {
  if (!clientId.startsWith("https://") || !URL.canParse(clientId)) return false;
  const url = new URL(clientId);

  return url.pathname !== "/" && url.hash === "" && url.username === "" && url.password === "";
}

/** Keeps fetched documents for as long as their Cache-Control or Expires allows, at most a day, and a minute when they name no lifetime; `no-store` and `no-cache` keep nothing. A document counts only when its `client_id` is its URL, it names a client and redirect URIs, and it asks for no client authentication. */
export function createClientDirectory(fetchDocument: ClientMetadataFetch): ClientDirectory {
  const cache = new Map<string, Cached>();

  return {
    async find(clientId) {
      if (!namesMetadataDocument(clientId)) return null;
      const now = Date.now();
      const known = cache.get(clientId);

      if (known !== undefined && known.until > now) return known.client;
      cache.delete(clientId);
      const answer = await fetchDocument(new URL(clientId)).catch(() => null);

      if (answer === null || answer.status !== 200) return null;
      const value = readJson(answer.body);

      if (!document.Check(value) || value.client_id !== clientId) return null;

      if (
        value.token_endpoint_auth_method !== undefined &&
        value.token_endpoint_auth_method !== "none"
      )
        return null;

      if (!value.redirect_uris.every(allowsRedirect)) return null;
      const client = { id: clientId, name: value.client_name, redirectUris: value.redirect_uris };
      const lifetime = cacheLifetime(answer, now);

      if (lifetime > 0 && cache.size < MAX_CACHED)
        cache.set(clientId, { client, until: now + lifetime });

      return client;
    },
  };
}

/** Fetches a metadata document over https from a public address only: the name resolves once, every address must be public, and the connection goes to that address. It follows no redirect, waits 5 s at most and reads 5 KiB at most. */
export const fetchClientMetadata: ClientMetadataFetch = async (url) => {
  if (url.protocol !== "https:") throw new Error("A client metadata document needs an https URL.");
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const addresses: readonly LookupAddress[] =
    isIP(host) === 0
      ? await lookup(host, { all: true, verbatim: true })
      : [{ address: host, family: isIP(host) }];
  const pinned = addresses[0];

  if (pinned === undefined || addresses.some((entry) => blocked(entry)))
    throw new Error(`${url.hostname} resolves to an address this host does not fetch from.`);

  return new Promise<ClientMetadataAnswer>((answered, failed) => {
    const sent = request(
      url,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        timeout: TIMEOUT_MS,
        lookup: (_name, options, done) => {
          if (options.all === true) done(null, [pinned]);
          else done(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;

        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;

          if (size > MAX_BYTES) {
            response.destroy();
            failed(new Error("The client metadata document is larger than 5 KiB."));

            return;
          }

          chunks.push(chunk);
        });
        response.on("end", () =>
          answered({
            status: response.statusCode ?? 0,
            cacheControl: header(response.headers["cache-control"]),
            expires: header(response.headers.expires),
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", failed);
      },
    );

    sent.on("timeout", () =>
      sent.destroy(new Error("The client metadata document took too long.")),
    );
    sent.on("error", failed);
    sent.end();
  });
};

/** Whether a redirect URI is one this host sends a code to: https, or http on a loopback host, with no fragment. */
export function allowsRedirect(uri: string): boolean {
  if (!URL.canParse(uri)) return false;
  const url = new URL(uri);

  if (url.hash !== "") return false;

  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
}

function blocked(entry: LookupAddress): boolean {
  const family = entry.family === 6 ? "ipv6" : "ipv4";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(entry.address)?.[1];

  return mapped === undefined
    ? PRIVATE.check(entry.address, family)
    : PRIVATE.check(mapped, "ipv4");
}

function privateRanges(): BlockList {
  const list = new BlockList();
  const ipv4: readonly (readonly [string, number])[] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 3],
  ];
  const ipv6: readonly (readonly [string, number])[] = [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ];

  for (const range of ipv4) list.addSubnet(range[0], range[1], "ipv4");

  for (const range of ipv6) list.addSubnet(range[0], range[1], "ipv6");

  return list;
}

function cacheLifetime(answer: ClientMetadataAnswer, now: number): number {
  const control = (answer.cacheControl ?? "").toLowerCase();

  if (/\b(no-store|no-cache)\b/.test(control)) return 0;
  const maxAge = /\bmax-age=(\d+)/.exec(control)?.[1];

  if (maxAge !== undefined) return Math.min(Number(maxAge) * 1000, MAX_CACHE_MS);
  const expires = answer.expires === null ? Number.NaN : Date.parse(answer.expires);

  if (!Number.isNaN(expires)) return Math.min(Math.max(expires - now, 0), MAX_CACHE_MS);

  return DEFAULT_CACHE_MS;
}

function header(value: string | readonly string[] | undefined): string | null {
  if (value === undefined) return null;

  return typeof value === "string" ? value : value.join(", ");
}

function readJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);

    return isJson(value) ? value : null;
  } catch {
    return null;
  }
}
