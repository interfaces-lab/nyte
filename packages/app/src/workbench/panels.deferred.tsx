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

/** The workbench's Files, Changes and terminal surfaces, with the terminal commands that reach a mounted terminal. */
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
