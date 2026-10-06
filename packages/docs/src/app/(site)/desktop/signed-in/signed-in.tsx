"use client";

import { useEffect, useSyncExternalStore } from "react";

/* Mirrors ACCOUNT_SCHEMES in packages/desktop/src/account/scheme.ts. */
const APPS = new Set(["nyte-desktop", "nyte-desktop-test", "nyte-desktop-dev"]);

export function SignedIn() {
  const search = useSyncExternalStore(
    () => () => undefined,
    () => window.location.search,
    () => "",
  );
  const params = new URLSearchParams(search);
  const app = params.get("app");
  const failed = params.get("__clerk_status") === "failed";

  // The deep link Clerk would have sent the browser to, with Clerk's parameters intact.
  params.delete("app");
  const query = params.toString();
  const deepLink =
    app !== null && APPS.has(app) ? `${app}://account/${query === "" ? "" : `?${query}`}` : undefined;

  // One-time external sync: hand the callback to the app. The query never changes.
  useEffect(() => {
    if (deepLink !== undefined) window.location.replace(deepLink);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- mount-only is the contract
  }, []);

  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-[34px] leading-[1.15] font-medium tracking-[-0.03em] text-balance text-foreground">
        {failed ? "Sign-in didn’t finish" : "Signed in"}
      </h1>
      <p className="max-w-[640px] text-[17px] leading-[1.65] tracking-[-0.01em] text-pretty text-muted-foreground">
        {failed
          ? "Return to Nyte to see what went wrong and try again."
          : "You can close this tab and return to Nyte."}
      </p>
      {deepLink !== undefined && (
        <a
          href={deepLink}
          className="mt-3 inline-flex h-11 items-center rounded-full bg-foreground px-5 text-[15px] font-medium text-background outline-none transition-[background-color,scale] active:scale-[0.96] hover:bg-foreground/85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Open Nyte
        </a>
      )}
    </div>
  );
}
