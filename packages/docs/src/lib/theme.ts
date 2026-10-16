import { useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const storageKey = "theme";
const darkQuery = "(prefers-color-scheme: dark)";

/*
 * Runs in <head> before first paint, so a stored dark choice never flashes
 * light. It mirrors `apply` below; keep the two in step.
 */
export const themeScript = `(() => {
  try {
    const choice = localStorage.getItem(${JSON.stringify(storageKey)});
    const dark = choice === "dark" || (choice !== "light" && matchMedia(${JSON.stringify(darkQuery)}).matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {}
})();`;

function readChoice(): ThemeChoice {
  const stored = localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function resolve(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return matchMedia(darkQuery).matches ? "dark" : "light";
}

/* Theme changes swap every colour at once; transitions would animate each one. */
function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  const resolved = resolve(choice);
  const freeze = document.createElement("style");
  freeze.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(freeze);
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  void getComputedStyle(root).colorScheme;
  freeze.remove();
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = matchMedia(darkQuery);
  const onSystemChange = () => {
    if (readChoice() === "system") apply("system");
    notify();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return;
    apply(readChoice());
    notify();
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setTheme(choice: ThemeChoice) {
  if (choice === "system") localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, choice);
  apply(choice);
  notify();
}

/** The stored choice and what it resolves to; both null until hydration reads storage. */
export function useTheme(): { theme: ThemeChoice | null; resolvedTheme: "light" | "dark" | null } {
  const theme = useSyncExternalStore(subscribe, readChoice, () => null);
  const resolvedTheme = useSyncExternalStore(
    subscribe,
    () => resolve(readChoice()),
    () => null,
  );
  return { theme, resolvedTheme };
}
