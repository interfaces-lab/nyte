import { publishDeferred } from "../lib/deferred.tsx";
import { ChangesPanel } from "./changes/changes-panel.tsx";
import { FilesPanel } from "./files/files-panel.tsx";
import { TerminalPanel } from "./terminal/terminal-panel.tsx";
import {
  addTerminalToChat,
  clearTerminal,
  copyTerminal,
  focusTerminal,
} from "./terminal/terminal-runtime.ts";

export const workbenchRuntime = {
  FilesPanel,
  ChangesPanel,
  TerminalPanel,
  addTerminalToChat,
  clearTerminal,
  copyTerminal,
  focusTerminal,
};

publishDeferred("workbench", workbenchRuntime);
