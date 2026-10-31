import { createContext } from "react";

/** The app's own icon, as its host ships it: the desktop's Dock icon, or the web app's. */
export const AppIcon = createContext<string | undefined>(undefined);
