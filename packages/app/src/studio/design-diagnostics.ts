import { useSyncExternalStore } from "react";
import type { BoardMessage, SheetError } from "@nyte-ai/plugin/design/board-protocol";

type Drawn = Extract<BoardMessage, { kind: "drawn" }>;

const listeners = new Set<() => void>();

interface Diagnostics {
  readonly build: number;
  readonly errors: ReadonlyMap<string, SheetError>;
}

let shown: Diagnostics = { build: 0, errors: new Map() };

export function recordDrawn(drawn: Drawn): void {
  if (drawn.build < shown.build) return;
  shown = {
    build: drawn.build,
    errors: new Map(
      drawn.sheets.flatMap((sheet) =>
        sheet.error === null ? [] : [[sheet.path, sheet.error] as const],
      ),
    ),
  };

  for (const listener of listeners) listener();
}

export function clearDrawn(): void {
  shown = { build: shown.build, errors: new Map() };

  for (const listener of listeners) listener();
}

export function useDesignDiagnostics(): ReadonlyMap<string, SheetError> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    () => shown.errors,
  );
}
