import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { Toggle } from "@nyte-ai/ui/toggle";
import { NO_DESIGN } from "../contract/bridge.ts";
import type { BrowserDesignChange } from "../contract/bridge.ts";
import { errorMessage } from "../contract/errors.ts";
import { nyte } from "../contract/nyte.ts";
import { DesignBar } from "../workbench/browser/browser-design-bar.tsx";
import { focusGuest } from "../workbench/browser/browser-guests.tsx";
import { useBrowserSurface } from "../workbench/browser/browser-surfaces.ts";
import type { ActivePage } from "./board-pages.ts";

function changeDesign(surface: string, change: BrowserDesignChange): void {
  void nyte.host.browser
    ?.design({ surface, change })
    .catch((cause: unknown) => toast.add({ type: "error", title: errorMessage(cause) }));
}

export function DesignModeToggle({
  page,
  onEnter,
}: {
  readonly page: ActivePage | null;
  readonly onEnter: (page: ActivePage) => void;
}): ReactElement {
  const design = useBrowserSurface(page?.surface ?? "").state?.design ?? NO_DESIGN;

  return (
    <Toggle
      iconOnly
      size="sm"
      icon="bezier-pointer"
      aria-label="Design Mode"
      disabled={page === null}
      pressed={page !== null && design.on}
      onPressedChange={(on) => {
        if (page === null) return;
        changeDesign(page.surface, { kind: on ? "on" : "off" });

        if (on) onEnter(page);
      }}
    />
  );
}

export function PageDesignBar({ surface }: { readonly surface: string }): ReactElement | null {
  const design = useBrowserSurface(surface).state?.design ?? NO_DESIGN;

  if (!design.on) return null;

  return (
    <DesignBar
      views={design.views}
      onChange={(change) => changeDesign(surface, change)}
      onPointerDone={() => focusGuest(surface)}
    />
  );
}
