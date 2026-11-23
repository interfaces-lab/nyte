import type { HostState } from "../contract/bridge.ts";
import type { DesktopApp } from "../contract/desktop-app.ts";
import type { ArrivalSubject } from "../contract/desktop-window.ts";
import { nyte } from "../contract/nyte.ts";
import { appShape } from "../workbench/app-shape.ts";
import { documentsApi } from "../data/documents.ts";
import { keys, queryClient } from "../data/query-client.ts";
import type { ReferenceOpener } from "../references/reference-opener.tsx";
import { openChanges, openUrl } from "../workbench/commands.ts";
import { FOLLOW_BROWSE } from "../workbench/model.ts";
import type { KindInput, WorkbenchViewKey } from "../workbench/model.ts";
import { workspacePathForView } from "../workbench/paths.ts";
import { workbench } from "../workbench/store.ts";
import { fileActions } from "./file-store.ts";

interface Lines {
  readonly start: number;
  readonly end: number;
}

function openInApp(to: DesktopApp, subject: ArrivalSubject | null): void {
  void nyte.host.switchApp?.({
    to,
    workspace: queryClient.getQueryData<HostState>(keys.host)?.workspace ?? null,
    subject,
  });
}

/** Opens what a reference in a chat names. A window whose app offers no Editor opens files in Code. */
export function workbenchReferenceOpener(view: WorkbenchViewKey): ReferenceOpener {
  const workspacePath = workspacePathForView(view);
  const here = appShape().launchers.includes("editor");

  const openFile = (path: string, lines: Lines | undefined): (() => void) =>
    here
      ? () =>
          fileActions.open(view, {
            path,
            target: lines === undefined ? undefined : lineTarget(lines),
            preview: true,
          })
      : () => void linkSubject(path, lines).then((subject) => openInApp("code", subject));

  return (reference) => {
    if (reference.kind === "url") return () => openUrl(view, reference.url);

    if (reference.kind === "canvas") {
      const tab: KindInput<"canvas"> = {
        kind: "canvas",
        sessionId: reference.sessionId,
        part: reference.part,
        title: reference.title,
        pinned: null,
      };

      return () =>
        workbench.dispatch(view, {
          kind: "open",
          tab: { id: crypto.randomUUID(), ...tab },
          activate: true,
        });
    }

    if (workspacePath === undefined) return undefined;

    switch (reference.kind) {
      case "file": {
        const file = reference.file;

        if (file.kind === "folder" && !here) return () => openInApp("code", null);

        if (file.kind === "folder") {
          return () => {
            workbench.dispatch(view, { kind: "browse", root: FOLLOW_BROWSE });
            fileActions.reveal(view, file.displayPath);
          };
        }

        return openFile(file.path, reference.lines);
      }

      case "skill":
        return openFile(reference.path, undefined);
      case "excerpt": {
        const source = reference.source;

        if (source.kind === "browser") return () => openUrl(view, source.url);

        if (source.kind !== "diff" || source.side === "old") return undefined;

        return openFile(`${workspacePath.replace(/\/$/u, "")}/${source.path}`, source);
      }

      case "changes":
        return () => openChanges(view, { kind: "thread" }, reference.path);
      case "mention":
      case "clipboard":
        return undefined;
      default: {
        const exhaustive: never = reference;

        return exhaustive;
      }
    }
  };
}

function lineTarget(lines: Lines) {
  return lines.start === lines.end
    ? { kind: "position" as const, line: lines.start }
    : { kind: "lines" as const, lines: { start: lines.start, end: lines.end } };
}

async function linkSubject(path: string, lines: Lines | undefined): Promise<ArrivalSubject> {
  if (lines === undefined) return { kind: "file", path };
  const document = await (await documentsApi()).read(path, { as: "document" });

  if (document.kind !== "text") return { kind: "file", path };
  const rows = document.contents.split("\n");
  const first = Math.max(lines.start, 1) - 1;
  const start = rows.slice(0, first).reduce((offset, row) => offset + row.length + 1, 0);

  return {
    kind: "span",
    path,
    start,
    end: start + rows.slice(first, Math.max(lines.end, first + 1)).join("\n").length,
  };
}
