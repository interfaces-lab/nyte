import { useRouter } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { ProfileSettings } from "../chrome/profile-settings.tsx";

export function ProfileSettingsPage(): ReactElement {
  const router = useRouter();

  return (
    <ProfileSettings
      onOpenServer={() =>
        void router.navigate({
          to: "/settings/$section",
          params: { section: "server" },
          replace: true,
        })
      }
    />
  );
}
