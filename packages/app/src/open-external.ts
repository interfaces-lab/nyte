import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "./errors.ts";
import { nyte } from "./nyte.ts";

export function openExternal(url: string, title?: string): void {
  void nyte.host.openExternal({ url }).catch((cause: unknown) =>
    toast.add({
      type: "error",
      title: title ?? `Couldn't open ${URL.parse(url)?.host ?? "the link"}.`,
      description: errorMessage(cause),
    }),
  );
}
