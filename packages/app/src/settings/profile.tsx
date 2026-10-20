import { useRouter } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { ProfileSettings } from "../chrome/profile-settings.tsx";
import { openEnvironmentsFromSettings } from "./return.ts";

export function ProfileSettingsPage(): ReactElement {
  const router = useRouter();

  return <ProfileSettings onOpenEnvironments={() => openEnvironmentsFromSettings(router)} />;
}
