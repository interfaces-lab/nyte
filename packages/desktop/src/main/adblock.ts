/** Filter engine over bundled EasyList and EasyPrivacy. No Electron in here. */
import { readFile } from "node:fs/promises";
import { FiltersEngine, Request } from "@ghostery/adblocker";
import type { ElectronRequestType } from "@ghostery/adblocker";

export type BlockDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "block" }
  | { readonly kind: "redirect"; readonly url: string };

export interface RequestDetails {
  readonly url: string;
  readonly resourceType: ElectronRequestType;
  readonly referrer: string;
}

export interface Blocker {
  decide(details: RequestDetails): BlockDecision;
  /** Hostname-scoped element hiding for a committed page; empty when nothing applies. */
  stylesFor(url: string): string;
}

export function createBlocker(engine: FiltersEngine): Blocker {
  return {
    decide(details) {
      if (details.resourceType === "mainFrame") return { kind: "allow" };
      const request = Request.fromRawDetails({
        url: details.url,
        type: details.resourceType,
        sourceUrl: details.referrer,
      });
      const response = engine.match(request);
      if (response.redirect !== undefined)
        return { kind: "redirect", url: response.redirect.dataUrl };
      return response.match ? { kind: "block" } : { kind: "allow" };
    },
    stylesFor(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return "";
      }
      const { hostname } = parsed;
      if (hostname === "") return "";
      const domain = hostname.split(".").slice(-2).join(".");
      return engine.getCosmeticsFilters({
        url,
        hostname,
        domain,
        getBaseRules: false,
        getInjectionRules: false,
        getExtendedRules: false,
        getRulesFromDOM: false,
        getRulesFromHostname: true,
      }).styles;
    },
  };
}

export function parseFilterLists(text: string): FiltersEngine {
  return FiltersEngine.parse(text, {
    enableCompression: true,
    loadExtendedSelectors: false,
    loadGenericCosmeticsFilters: false,
  });
}

/** Undefined when the file is missing or was written by another engine version. */
export async function loadBlocker(path: string): Promise<Blocker | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    return undefined;
  }
  try {
    return createBlocker(FiltersEngine.deserialize(bytes));
  } catch {
    return undefined;
  }
}
