import { useSyncExternalStore } from "react";
import { clientCapabilities } from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import { openExternalLink } from "./external-link.ts";
import type { ReferenceOpener } from "./reference-opener.tsx";

export type LinkPreference = "built-in" | "external";

const STORAGE_KEY = "nyte:link-target:v1";

const listeners = new Set<() => void>();

function readPreference(): LinkPreference {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "external" ? "external" : "built-in";
  } catch {
    return "built-in";
  }
}

let preference = readPreference();

function getPreference(): LinkPreference {
  return preference;
}

export function setLinkPreference(value: LinkPreference): void {
  preference = value;

  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    return;
  } finally {
    for (const listener of listeners) listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useLinkPreference(): LinkPreference {
  return useSyncExternalStore(subscribe, getPreference, getPreference);
}

/** Opens a link from conversation content where the user chose: the workbench browser, or the system browser. */
export function openConversationLink(href: string, opener: ReferenceOpener | undefined): void {
  const url = URL.parse(href);

  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) return;

  const builtIn =
    preference === "built-in" && clientCapabilities(nyte.host).browser
      ? opener?.({ kind: "url", url: url.href })
      : undefined;

  if (builtIn === undefined) {
    openExternalLink(url.href);

    return;
  }

  builtIn();
}
