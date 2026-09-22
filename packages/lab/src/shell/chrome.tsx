import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { chrome } from "./chrome.stylex";

export type Appearance = "light" | "dark";

export type BackdropKind = "photo" | "grid" | "flat";

export type TokenSet = "nyte" | "calendar";

const backdropStyles = {
  photo: chrome.photo,
  grid: chrome.grid,
  flat: chrome.flat,
} as const;

export function Page({ backdrop, children }: { backdrop: BackdropKind; children: ReactNode }) {
  return (
    <div {...stylex.props(chrome.page)}>
      <div {...stylex.props(chrome.backdrop, backdropStyles[backdrop])} />
      <div {...stylex.props(chrome.stage)}>{children}</div>
    </div>
  );
}
