import { useRouter } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { ProfileSettings } from "../chrome/profile-settings.tsx";
import { openEnvironmentsFromSettings } from "./return.ts";

/** Profile reaches Environments over the workspace location settings was opened from. */
export function ProfileSettingsPage(): ReactElement {
  const router = useRouter();

  return <ProfileSettings onOpenEnvironments={() => openEnvironmentsFromSettings(router)} />;
}
