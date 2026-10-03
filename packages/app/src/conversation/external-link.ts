import { Type } from "typebox";
import { Value } from "typebox/value";
import { nyte } from "../nyte.ts";

const STORAGE_KEY = "nyte:trusted-link-hosts:v1";

const trustedHosts = Type.Array(Type.String());

function readTrustedHosts(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");

    return new Set(Value.Check(trustedHosts, parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function trustHost(host: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...readTrustedHosts(), host]));
  } catch {
    return;
  }
}

async function confirmAndOpen(url: URL): Promise<void> {
  if (!readTrustedHosts().has(url.host)) {
    const choice = await nyte.host.confirmExternal({ url: url.href });

    if (choice === "cancel") return;

    if (choice === "copy") return navigator.clipboard.writeText(url.href);

    if (choice === "trust") trustHost(url.host);
  }

  return nyte.host.openExternal({ url: url.href });
}

/** Opens a link from conversation content, asking first unless its host was trusted. */
export function openExternalLink(href: string): void {
  const url = URL.parse(href);

  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) return;
  void confirmAndOpen(url).catch(() => undefined);
}
