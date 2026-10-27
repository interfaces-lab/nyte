import { createContext, use } from "react";
import type { SelectedWorkspace } from "../bridge.ts";

/** The folder a conversation runs in. Its mentions, citations and links resolve there, whatever folder the window has open. */
export const ChatFolderContext = createContext<SelectedWorkspace | undefined>(undefined);

export function useChatFolder(): SelectedWorkspace | undefined {
  return use(ChatFolderContext);
}
