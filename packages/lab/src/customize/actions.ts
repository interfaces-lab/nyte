import { toast } from "@nyte-ai/ui/toast";

/** Stands in for `revealPath` and the clipboard; the lab has no host to open Finder. */
export function reveal(path: string, kind: "open" | "copy" | "edit"): void {
  switch (kind) {
    case "open":
      toast.add({ title: `Opened ${path} in Finder` });
      return;
    case "edit":
      toast.add({ title: `Opened ${path} in your editor` });
      return;
    case "copy":
      void navigator.clipboard.writeText(path);
      toast.add({ title: "Path copied" });
      return;
    default: {
      const _exhaustive: never = kind;

      return _exhaustive;
    }
  }
}
