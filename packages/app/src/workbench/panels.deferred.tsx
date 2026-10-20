import { publishDeferred } from "../deferred.tsx";
import { ChangesPanel } from "./changes-panel.tsx";
import { FilesPanel } from "./files-panel.tsx";
import { TerminalPanel } from "./terminal-panel.tsx";
import {
  addTerminalToChat,
  clearTerminal,
  copyTerminal,
  focusTerminal,
} from "./terminal-runtime.ts";

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
