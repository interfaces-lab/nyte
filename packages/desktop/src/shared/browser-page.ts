import type { BrowserDesign } from "@nyte-ai/app/contract/bridge.ts";

export const BROWSER_PAGE_KEY_CHANNEL = "nyte:browser-page-key";

export const BROWSER_PAGE_DESIGN_CHANNEL = "nyte:browser-page-design";

/** Main tells the page whether it is entered on the Design board; the entered page sends the wheels it hands back. */
export const BROWSER_PAGE_BOARD_CHANNEL = "nyte:browser-page-board";

/** The farthest one handed-back wheel may move, in CSS px per axis. */
export const WHEEL_DELTA_LIMIT = 1_000;

export interface BoardMainMessage {
  readonly entered: boolean;
}

export type DesignMainMessage =
  | { readonly kind: "design"; readonly design: BrowserDesign }
  | { readonly kind: "captured"; readonly id: string };

export const DESIGN_PICK_CHARS = { selector: 2_000, text: 2_000 } as const;
