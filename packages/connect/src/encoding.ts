import { UUID_PATTERN } from "./schemas.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64Url(bytes: Uint8Array): string {
  let text = "";
  let index = 0;

  for (; index + 2 < bytes.length; index += 3) {
    const chunk =
      ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    text += `${ALPHABET[(chunk >> 18) & 63]}${ALPHABET[(chunk >> 12) & 63]}${ALPHABET[(chunk >> 6) & 63]}${ALPHABET[chunk & 63]}`;
  }

  const rest = bytes.length - index;

  if (rest === 1) {
    const chunk = (bytes[index] ?? 0) << 16;
    text += `${ALPHABET[(chunk >> 18) & 63]}${ALPHABET[(chunk >> 12) & 63]}`;
  } else if (rest === 2) {
    const chunk = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8);
    text += `${ALPHABET[(chunk >> 18) & 63]}${ALPHABET[(chunk >> 12) & 63]}${ALPHABET[(chunk >> 6) & 63]}`;
  }

  return text;
}

const DIGITS = new Map(Array.from(ALPHABET, (char, index) => [char.charCodeAt(0), index]));

export function fromBase64Url(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let offset = 0;

  for (let index = 0; index < text.length; index += 1) {
    const value = DIGITS.get(text.charCodeAt(index));

    if (value === undefined) return undefined;
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes[offset] = (buffer >> bits) & 0xff;
      offset += 1;
    }
  }

  if ((buffer & ((1 << bits) - 1)) !== 0) return undefined;

  return bytes;
}

export function base64ToBase64Url(base64: string): string {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

const UUID = new RegExp(UUID_PATTERN, "u");

export function namesBrokerOrigin(origin: string): boolean {
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" && url.username === "" && url.password === "" && url.origin === origin
  );
}

export function relayAddress(origin: string, environmentId: string): string {
  if (!namesBrokerOrigin(origin))
    throw new Error("The connect origin must be a canonical https:// origin.");

  if (!UUID.test(environmentId)) throw new Error("An environment id is a lowercase v4 UUID.");

  return `${origin}/r/${environmentId}`;
}

export function namesRelayAddress(address: string, origin: string): boolean {
  if (!namesBrokerOrigin(origin) || !address.startsWith(`${origin}/r/`)) return false;

  return UUID.test(address.slice(origin.length + 3));
}
