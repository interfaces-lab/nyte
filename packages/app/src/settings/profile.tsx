import { useRouter } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { ProfileSettings } from "../chrome/profile-settings.tsx";
import { placeHref } from "../tabs/places.ts";

export function ProfileSettingsPage(): ReactElement {
  const router = useRouter();

  return (
    <ProfileSettings
      onOpenEnvironments={() =>
        void router.navigate({
          href: placeHref({ kind: "environments", section: undefined }),
          replace: true,
        })
      }
    />
  );
}
