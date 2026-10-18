import { useEffect } from "react";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";

export type DisplayMode = "light" | "dark";

export const DISPLAY_MODES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { readonly value: DisplayMode; readonly label: string }[];

/** Paint the page in `mode` the way the app does; leaving it returns the lab to light. */
export function useDisplayMode(mode: DisplayMode): void {
  useEffect(() => {
    applyDisplayMode(mode);

    return () => applyDisplayMode("light");
  }, [mode]);
}
