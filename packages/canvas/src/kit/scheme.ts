import { createContext, useContext } from "react";

export const SchemeContext = createContext<"light" | "dark">("light");

export function useColorScheme(): "light" | "dark" {
  return useContext(SchemeContext);
}
