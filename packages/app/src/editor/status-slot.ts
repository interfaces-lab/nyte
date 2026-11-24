import { createContext } from "react";

/**
 * Where a file's status shows. Undefined: in the file's own bar, as in a side panel. Otherwise the main area's one
 * status bar takes the focused group's file: an element there, null for a group that isn't focused.
 */
export const EditorStatusSlot = createContext<HTMLElement | null | undefined>(undefined);
