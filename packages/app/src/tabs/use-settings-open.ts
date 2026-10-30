import { useMatch } from "@tanstack/react-router";

export function useSettingsOpen(): boolean {
  return useMatch({ from: "/settings/$section", shouldThrow: false, select: () => true }) === true;
}
