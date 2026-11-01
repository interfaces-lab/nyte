import { useSyncExternalStore } from "react";
import { preferences, useSetting } from "@nyte-ai/app/preferences/index.ts";

export type Scheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function watchSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

/** The display mode the app's theme preference resolves to, which the app's boot paints. */
export function useScheme(): Scheme {
  const theme = useSetting(preferences.theme);
  const systemDark = useSyncExternalStore(watchSystem, () => window.matchMedia(DARK_QUERY).matches);

  if (theme === "system") return systemDark ? "dark" : "light";

  return theme;
}
