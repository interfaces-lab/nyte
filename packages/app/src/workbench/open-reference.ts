import { mentionsFolder } from "../conversation/message-references.ts";
import type { ReferenceOpener } from "../conversation/reference-opener.tsx";
import type { WorkbenchViewKey } from "./controller.ts";
import { workbenchController } from "./controller.ts";
import { fileActions } from "./file-store.ts";

export function workbenchReferenceOpener(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly workspacePath: string | undefined;
}): ReferenceOpener {
  const { viewKey, workspacePath } = input;

  return (reference) => {
    if (reference.kind === "url") {
      return () =>
        workbenchController.actions.openTab({
          view: viewKey,
          tab: { kind: "browser", url: reference.url },
          activate: true,
        });
    }

    if (reference.kind === "canvas") {
      const tab = {
        kind: "canvas",
        sessionId: reference.sessionId,
        part: reference.part,
        title: reference.title,
        pinned: null,
      } as const;

      return () => workbenchController.actions.openTab({ view: viewKey, tab, activate: true });
    }

    if (workspacePath === undefined) return undefined;

    switch (reference.kind) {
      case "file": {
        const { file } = reference;

        if (mentionsFolder(file)) return () => fileActions.reveal(viewKey, file.displayPath);

        return () =>
          fileActions.open(viewKey, {
            path: file.path,
            line: reference.lines?.start,
            preview: true,
          });
      }

      case "skill": {
        const root = workspacePath.endsWith("/") ? workspacePath : `${workspacePath}/`;

        if (!reference.path.startsWith(root)) return undefined;

        return () => fileActions.open(viewKey, { path: reference.path, preview: true });
      }

      case "excerpt": {
        const { source } = reference;

        if (source.kind === "browser")
          return () =>
            workbenchController.actions.openTab({
              view: viewKey,
              tab: { kind: "browser", url: source.url },
              activate: true,
            });

        if (source.kind !== "diff" || source.side === "old") return undefined;
        const path = `${workspacePath.replace(/\/$/u, "")}/${source.path}`;

        return () => fileActions.open(viewKey, { path, line: source.start, preview: true });
      }

      case "changes": {
        const { path } = reference;

        return () => {
          const tab = workbenchController
            .getView(viewKey)
            .tabs.find((candidate) => candidate.kind === "changes");

          const patch = {
            scope: { kind: "thread" },
            selectedPath: path,
            pathRevealRevision: (tab?.pathRevealRevision ?? 0) + (path === null ? 0 : 1),
            scrollTop: 0,
          } as const;

          const id = workbenchController.actions.openTab({
            view: viewKey,
            tab: { kind: "changes", ...patch },
            activate: true,
          });

          workbenchController.actions.updateTab({ view: viewKey, id, kind: "changes", patch });
        };
      }

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
