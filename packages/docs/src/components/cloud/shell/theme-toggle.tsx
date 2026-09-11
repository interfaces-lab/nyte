"use client";

import { IconMoon, IconSun } from "central-icons";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The resolved theme is unknown until the client reads storage; render the
  // moon on the server and let hydration correct it.
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const dark = hydrated && resolvedTheme === "dark";

  return (
    <button
      type="button"
      className="cloud-icon-button"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <IconSun size={16} /> : <IconMoon size={16} />}
    </button>
  );
}
