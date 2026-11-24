import { createContext } from "react";

export interface AppIcons {
  readonly light: string;
  readonly dark: string;
}

export const AppIcon = createContext<string | undefined>(undefined);
