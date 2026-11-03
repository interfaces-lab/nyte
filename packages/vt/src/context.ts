import { TerminalData } from "./constants.ts";
import { check } from "./memory.ts";

import type { CellSize } from "./index.ts";
import type { Layout } from "./layout.ts";
import type { Memory } from "./memory.ts";
import type { Native } from "./native.ts";

export interface Context {
  readonly native: Native;
  readonly layout: Layout;
  readonly memory: Memory;
  readonly terminal: number;
  readonly geometry: () => Geometry;
  readonly mode: (mode: number) => boolean;
  readonly flag: (data: number) => boolean;
}

export interface Geometry {
  readonly cols: number;
  readonly rows: number;
  readonly cell: CellSize;
  readonly pixels: CellSize;
}

export function createContext(
  native: Native,
  layout: Layout,
  memory: Memory,
  terminal: number,
  geometry: () => Geometry,
): Context {
  const config = memory.allocate(layout.modeConfig.size);
  const out = memory.allocate(8);

  return {
    native,
    layout,
    memory,
    terminal,
    geometry,
    mode: (mode) => {
      memory.view().setUint16(config + layout.modeConfig.mode, mode, true);
      check(native.ghostty_terminal_get(terminal, TerminalData.MODE, config), "mode query");

      return memory.view().getUint8(config + layout.modeConfig.value) !== 0;
    },
    flag: (data) => {
      memory.view().setUint8(out, 0);
      check(native.ghostty_terminal_get(terminal, data, out), "terminal query");

      return memory.view().getUint8(out) !== 0;
    },
  };
}

export function pixelPosition(geometry: Geometry, x: number, y: number) {
  return {
    x: (x * geometry.pixels.width) / geometry.cell.width,
    y: (y * geometry.pixels.height) / geometry.cell.height,
  };
}
