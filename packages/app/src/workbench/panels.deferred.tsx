import { parsePatchFiles } from "@nyte-ai/ui/diffs";
import { publishDeferred } from "../lib/deferred.tsx";
import { ChangesPanel } from "../changes/changes-panel.tsx";
import { DesignTab } from "./design-tab.tsx";
import { EditorPanel } from "../editor/editor-panel.tsx";
import { TerminalPanel } from "../terminal/terminal-panel.tsx";
import {
  addTerminalToChat,
  clearTerminal,
  copyTerminal,
  focusTerminal,
} from "../terminal/terminal-runtime.ts";

export const workbenchRuntime = {
  EditorPanel,
  ChangesPanel,
  DesignTab,
  TerminalPanel,
  addTerminalToChat,
  clearTerminal,
  copyTerminal,
  focusTerminal,
  parsePatchFiles,
};

publishDeferred("workbench", workbenchRuntime);
