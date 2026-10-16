import { clientCapabilities } from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import { openExternal } from "../open-external.ts";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../errors.ts";
import { preferences } from "../preferences/index.ts";
import type { ReferenceOpener } from "./reference-opener.tsx";

/** Ask about a link whose host isn't trusted; true when it should open. */
async function confirmOpen(url: URL): Promise<boolean> {
  const trusted = preferences.trustedLinkHosts.get();

  if (!preferences.confirmExternalLinks.get() || trusted.includes(url.host)) return true;
  const choice = await nyte.host.confirmExternal({ url: url.href });

  if (choice === "copy") await navigator.clipboard.writeText(url.href);

  if (choice === "trust") preferences.trustedLinkHosts.set([...trusted, url.host]);

  return choice === "open" || choice === "trust";
}

/** Opens a link in the system browser, asking first unless its host was trusted. */
export function openExternalLink(href: string): void {
  const url = URL.parse(href);

  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) return;
  void confirmOpen(url).then(
    (open) => {
      if (open) openExternal(url.href);
    },
    (cause: unknown) =>
      toast.add({
        type: "error",
        title: "Couldn't open the link.",
        description: errorMessage(cause),
      }),
  );
}

/** Opens a link from conversation content where the user chose: the workbench browser, or the system browser. */
export function openConversationLink(href: string, opener: ReferenceOpener | undefined): void {
  const url = URL.parse(href);

  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) return;

  const builtIn =
    preferences.linkTarget.get() === "built-in" && clientCapabilities(nyte.host).browser
      ? opener?.({ kind: "url", url: url.href })
      : undefined;

  if (builtIn === undefined) {
    openExternalLink(url.href);

    return;
  }

  builtIn();
}
