import { paperMono } from "./paper-mono";

/*
 * One glyph layer of the sky, centred on the hero: Paper Mono at 11/13. Every
 * layer takes the field's full size rather than its trimmed text's, so the
 * layers share cells. Paper Mono's advance is 606 units, so a cell is 6.666
 * by 13 px.
 */
export const CELL_W = 11 * 0.606;
export const CELL_H = 13;
export const SKY_COLS = 436;
export const SKY_ROWS = 124;
export const skyBox = { width: SKY_COLS * CELL_W, height: SKY_ROWS * CELL_H };

export const skyLayer = `${paperMono.className} absolute top-1/2 left-1/2 m-0 -translate-x-1/2 -translate-y-1/2 text-[11px] leading-[13px] tracking-normal whitespace-pre text-white select-none`;
