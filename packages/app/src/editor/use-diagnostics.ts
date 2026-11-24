import { useEffect, useEffectEvent, useRef } from "react";
import { findLanguage } from "@nyte-ai/schema";
import type {
  DiagnosticSeverity,
  LanguageDiagnostic,
  TextPosition,
  TextRange,
  WorkspaceId,
} from "@nyte-ai/schema";
import type { Marker, MarkerSeverity } from "@nyte-ai/ui/diffs/edit";
import { languageFor } from "../data/language.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { workspaceFile } from "../workbench/paths.ts";
import { fileActions } from "./file-store.ts";
import { languageDocuments } from "./language-documents.ts";
import { editorRange } from "./pierre-language.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

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
  readonly mac: boolean;
  readonly readOnly: boolean;
  readonly show: (markers: Marker[]) => void;
  readonly onQuickFix: (range: TextRange) => void;
}

export function useDiagnostics(input: DiagnosticsInput) {
  const held = useRef<Marker[]>([]);
  const shown = useRef<readonly LanguageDiagnostic[]>([]);
  const heldKey = useRef("[]");

  const show = useEffectEvent((diagnostics: readonly LanguageDiagnostic[]) => {
    const key = JSON.stringify(diagnostics);

    if (key === heldKey.current) return;
    heldKey.current = key;

    const markers = diagnostics.map((diagnostic) =>
      marker(diagnostic, {
        mac: input.mac,
        onQuickFix: input.readOnly ? undefined : input.onQuickFix,
      }),
    );

    held.current = markers;
    shown.current = diagnostics;
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

    if (findLanguage(path) === null) return undefined;
    const stop = new AbortController();

    void follow({ viewKey, path, id, root, relative }, stop.signal, show).catch(() => undefined);

    return () => stop.abort();
  }, [id, root, path, viewKey]);

  return {
    markers: () => held.current,
    diagnosed: (position: TextPosition) =>
      shown.current.some(
        (diagnostic) =>
          comparePosition(diagnostic.range.start, position) <= 0 &&
          comparePosition(position, diagnostic.range.end) <= 0,
      ),
    nearest: (position: TextPosition) =>
      shown.current
        .filter(
          (diagnostic) =>
            diagnostic.range.start.line <= position.line &&
            position.line <= diagnostic.range.end.line,
        )
        .toSorted((left, right) => offset(left.range, position) - offset(right.range, position))
        .at(0)?.range,
  };
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
  show: (diagnostics: readonly LanguageDiagnostic[]) => void,
): Promise<void> {
  const api = await languageFor(file.id);

  await languageDocuments.prepare(file.root, api, file.path, fileActions.documents(file.viewKey));

  if (signal.aborted) return;
  const stream = api.diagnostics()[Symbol.asyncIterator]();

  signal.addEventListener("abort", () => void stream.return?.(), { once: true });
  void api.symbols({ path: file.relative }).catch(() => undefined);

  for (let next = await stream.next(); next.done !== true; next = await stream.next()) {
    const frame = next.value.find((entry) => entry.path === file.relative);

    if (frame !== undefined && !signal.aborted) show(frame.diagnostics);
  }
}

function marker(
  diagnostic: LanguageDiagnostic,
  options: {
    readonly mac: boolean;
    readonly onQuickFix: ((range: TextRange) => void) | undefined;
  },
): Marker {
  const shown: Marker = {
    ...editorRange(diagnostic.range),
    severity: SEVERITIES[diagnostic.severity],
    message: diagnosticContent(diagnostic, options),
  };

  if (diagnostic.source !== null) shown.source = diagnostic.source;

  return shown;
}

function diagnosticContent(
  diagnostic: LanguageDiagnostic,
  options: {
    readonly mac: boolean;
    readonly onQuickFix: ((range: TextRange) => void) | undefined;
  },
): HTMLElement {
  const root = document.createElement("div");
  root.dataset.diagnostic = "";

  const body = document.createElement("div");
  body.dataset.diagnosticBody = "";

  const icon = document.createElement("span");
  icon.dataset.diagnosticIcon = "";
  icon.setAttribute("aria-hidden", "true");
  icon.append(severityIcon(diagnostic.severity));

  const text = document.createElement("p");
  text.dataset.diagnosticText = "";
  text.textContent = diagnostic.message;

  body.append(icon, text);
  root.append(body);

  const hasMeta = diagnostic.source !== null || diagnostic.code !== null;
  const onQuickFix = options.onQuickFix;

  if (!hasMeta && onQuickFix === undefined) return root;

  const footer = document.createElement("div");
  footer.dataset.diagnosticFooter = "";

  if (!hasMeta) footer.dataset.diagnosticActionOnly = "";

  if (hasMeta) {
    const meta = document.createElement("span");
    meta.dataset.diagnosticMeta = "";

    if (diagnostic.source !== null) {
      const source = document.createElement("span");
      source.dataset.diagnosticSource = "";
      source.textContent = diagnostic.source;
      meta.append(source);
    }

    if (diagnostic.source !== null && diagnostic.code !== null) meta.append("·");

    if (diagnostic.code !== null) {
      const code = document.createElement("span");
      code.dataset.diagnosticCode = "";
      code.textContent = diagnostic.code;
      code.title = diagnostic.code;
      meta.append(code);
    }

    footer.append(meta);
  }

  if (onQuickFix !== undefined) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.diagnosticAction = "";
    button.append("Quick Fix");

    const keys = document.createElement("kbd");
    keys.textContent = options.mac ? "⌘." : "Ctrl+.";
    button.append(keys);

    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onQuickFix(diagnostic.range);
    });
    footer.append(button);
  }

  root.append(footer);

  return root;
}

function severityIcon(severity: DiagnosticSeverity): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");

  const stroke = (tag: "path" | "circle", attrs: Readonly<Record<string, string>>): void => {
    const node = document.createElementNS(SVG_NS, tag);

    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    svg.append(node);
  };

  switch (severity) {
    case "error":
      stroke("circle", { cx: "8", cy: "8", r: "6", stroke: "currentColor", "stroke-width": "1.4" });
      stroke("path", {
        d: "M5.75 5.75L10.25 10.25M10.25 5.75L5.75 10.25",
        stroke: "currentColor",
        "stroke-width": "1.4",
        "stroke-linecap": "round",
      });
      break;
    case "warning":
      stroke("path", {
        d: "M7.14 2.74a1 1 0 0 1 1.72 0l5.02 8.75A1 1 0 0 1 13.02 13H2.98a1 1 0 0 1-.86-1.51l5.02-8.75Z",
        stroke: "currentColor",
        "stroke-width": "1.4",
        "stroke-linejoin": "round",
      });
      stroke("path", {
        d: "M8 6v3",
        stroke: "currentColor",
        "stroke-width": "1.4",
        "stroke-linecap": "round",
      });
      stroke("circle", { cx: "8", cy: "11", r: "0.75", fill: "currentColor" });
      break;
    case "information":
      stroke("circle", { cx: "8", cy: "8", r: "6", stroke: "currentColor", "stroke-width": "1.4" });
      stroke("path", {
        d: "M8 7.5v3.25",
        stroke: "currentColor",
        "stroke-width": "1.4",
        "stroke-linecap": "round",
      });
      stroke("circle", { cx: "8", cy: "5.25", r: "0.75", fill: "currentColor" });
      break;
    case "hint":
      stroke("circle", { cx: "8", cy: "8", r: "2.5", fill: "currentColor" });
      break;
  }

  return svg;
}

function offset(range: TextRange, position: TextPosition): number {
  if (comparePosition(position, range.start) < 0) {
    return range.start.utf16Column - position.utf16Column;
  }

  return comparePosition(range.end, position) < 0
    ? position.utf16Column - range.end.utf16Column
    : 0;
}

function comparePosition(left: TextPosition, right: TextPosition): number {
  return left.line === right.line ? left.utf16Column - right.utf16Column : left.line - right.line;
}
