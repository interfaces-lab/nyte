import { createContext, use } from "react";
import type { SelectedWorkspace } from "../contract/bridge.ts";

export const ChatFolderContext = createContext<SelectedWorkspace | undefined>(undefined);

export function useChatFolder(): SelectedWorkspace | undefined {
  return use(ChatFolderContext);
}
