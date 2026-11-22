import { useEffect, useEffectEvent, useRef } from "react";
import type {
  DiagnosticSeverity,
  LanguageDiagnostic,
  TextPosition,
  WorkspaceId,
} from "@nyte-ai/schema";
import type { Marker, MarkerSeverity } from "@nyte-ai/ui/diffs/edit";
import { languageFor } from "../../data/language.ts";
import type { WorkbenchViewKey } from "../model.ts";
import { workspaceFile } from "../paths.ts";
import { fileActions } from "./file-store.ts";
import { languageDocuments, languageFamily } from "./language-documents.ts";
import { editorRange } from "./pierre-language.ts";

const SEVERITIES = {
  error: "error",
  warning: "warning",
  information: "info",
  hint: "hint",
} as const satisfies Record<DiagnosticSeverity, MarkerSeverity>;

interface DiagnosticsInput {
  readonly viewKey: WorkbenchViewKey;
  readonly path: string;
  readonly workspace: { readonly id: WorkspaceId; readonly path: string } | undefined;
  readonly show: (markers: Marker[]) => void;
}

export function useDiagnostics(input: DiagnosticsInput) {
  const held = useRef<Marker[]>([]);

  const show = useEffectEvent((markers: Marker[]) => {
    if (JSON.stringify(markers) === JSON.stringify(held.current)) return;
    held.current = markers;
    input.show(markers);
  });

  const id = input.workspace?.id;
  const root = input.workspace?.path;
  const path = input.path;
  const viewKey = input.viewKey;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- follows the file's diagnostics while its workspace is known, so a tab restored before its workspace loads starts once it does
  useEffect(() => {
    const relative = root === undefined ? undefined : workspaceFile(path, [root])?.relative;

    if (id === undefined || root === undefined || relative === undefined) return undefined;

    if (languageFamily(path) === undefined) return undefined;
    const stop = new AbortController();

    void follow({ viewKey, path, id, root, relative }, stop.signal, show).catch(() => undefined);

    return () => stop.abort();
  }, [id, root, path, viewKey]);

  return { markers: () => held.current };
}

async function follow(
  file: {
    readonly viewKey: WorkbenchViewKey;
    readonly path: string;
    readonly id: WorkspaceId;
    readonly root: string;
    readonly relative: string;
  },
  signal: AbortSignal,
  show: (markers: Marker[]) => void,
): Promise<void> {
  const api = await languageFor(file.id);

  await languageDocuments.prepare(file.root, api, file.path, fileActions.documents(file.viewKey));

  if (signal.aborted) return;
  const stream = api.diagnostics()[Symbol.asyncIterator]();

  signal.addEventListener("abort", () => void stream.return?.(), { once: true });
  void api.symbols({ path: file.relative }).catch(() => undefined);

  for (let next = await stream.next(); next.done !== true; next = await stream.next()) {
    const frame = next.value.find((entry) => entry.path === file.relative);

    if (frame !== undefined && !signal.aborted) show(frame.diagnostics.map(marker));
  }
}

function marker(diagnostic: LanguageDiagnostic): Marker {
  const shown: Marker = {
    ...editorRange(diagnostic.range),
    severity: SEVERITIES[diagnostic.severity],
    message: diagnostic.message,
  };

  if (diagnostic.source !== null) shown.source = diagnostic.source;

  return shown;
}

export function diagnosed(markers: readonly Marker[], position: TextPosition): boolean {
  return markers.some(
    (shown) =>
      comparePosition(shown.start, position) <= 0 && comparePosition(position, shown.end) <= 0,
  );
}

function comparePosition(
  left: { readonly line: number; readonly character: number } | TextPosition,
  right: { readonly line: number; readonly character: number } | TextPosition,
): number {
  const leftColumn = "character" in left ? left.character : left.utf16Column;
  const rightColumn = "character" in right ? right.character : right.utf16Column;

  return left.line === right.line ? leftColumn - rightColumn : left.line - right.line;
}
