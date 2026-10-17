import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "./errors.ts";
import { nyte } from "./nyte.ts";

/**
 * Open a link in the system browser. A failure says so with the reason, so a
 * click is never lost in silence; `title` names what didn't open and what to
 * do instead, and defaults to the link's host.
 */
export function openExternal(url: string, title?: string): void {
  void nyte.host.openExternal({ url }).catch((cause: unknown) =>
    toast.add({
      type: "error",
      title: title ?? `Couldn't open ${URL.parse(url)?.host ?? "the link"}.`,
      description: errorMessage(cause),
    }),
  );
}
