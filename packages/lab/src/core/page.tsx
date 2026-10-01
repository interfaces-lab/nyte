import { applyDisplayMode } from "@nyte-ai/app/theme/appearance.ts";
import { useLayoutEffect, useState } from "react";
import { CoreGuide } from "./guide";

type Appearance = "light" | "dark";

/** `?appearance=` wins, then the system; the toggle takes over from there. */
function initialAppearance(): Appearance {
  const asked = new URLSearchParams(window.location.search).get("appearance");

  if (asked === "light" || asked === "dark") return asked;

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function CorePage() {
  const [appearance, setAppearance] = useState(initialAppearance);

  useLayoutEffect(() => {
    applyDisplayMode(appearance === "dark" ? "dark" : "light");
  }, [appearance]);

  return <CoreGuide appearance={appearance} onAppearance={setAppearance} />;
}
