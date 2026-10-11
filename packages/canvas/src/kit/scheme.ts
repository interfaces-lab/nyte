import { createContext, useContext } from "react";

/** The colour scheme the shell applied; the kit reads it where a concrete colour must be chosen, as the charts do. */
export const SchemeContext = createContext<"light" | "dark">("light");

export function useColorScheme(): "light" | "dark" {
  return useContext(SchemeContext);
}
