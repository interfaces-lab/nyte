import type { ReactElement } from "react";
import { ChangesView } from "../changes/changes-view.tsx";
import { launch } from "../commands/launch.ts";
import { fileActions } from "../editor/file-store.ts";
import { terminalActions } from "../terminal/terminal-store.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";

/** The Code explorer's Changes view, wired to the Editor and the dock. */
export function EditorChangesView({
  viewKey,
}: {
  readonly viewKey: WorkbenchViewKey;
}): ReactElement {
  return (
    <ChangesView
      onOpen={(path) => fileActions.open(viewKey, { path })}
      onInitialize={(folder) => {
        const terminal = launch(viewKey, "terminal", folder);

        if (terminal === undefined) return;
        const quoted = `'${folder.replaceAll("'", String.raw`'\''`)}'`;

        void terminalActions.write(terminal, new TextEncoder().encode(`git init ${quoted}\r`));
      }}
    />
  );
}
