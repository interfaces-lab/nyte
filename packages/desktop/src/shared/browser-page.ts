import type { BrowserDesign } from "@nyte-ai/app/contract/bridge.ts";

export const BROWSER_PAGE_KEY_CHANNEL = "nyte:browser-page-key";

export const BROWSER_PAGE_DESIGN_CHANNEL = "nyte:browser-page-design";

export type DesignMainMessage =
  | { readonly kind: "design"; readonly design: BrowserDesign }
  | { readonly kind: "captured"; readonly id: string };

export const DESIGN_PICK_CHARS = { selector: 2_000, text: 2_000 } as const;
