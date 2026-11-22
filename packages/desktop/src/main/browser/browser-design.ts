import type { WebContents } from "electron";
import type {
  BrowserDesign,
  BrowserDesignChange,
  BrowserDesignPick,
} from "@nyte-ai/app/contract/bridge.ts";
import { BROWSER_PAGE_DESIGN_CHANNEL } from "../../shared/browser-page.ts";
import type { DesignMainMessage } from "../../shared/browser-page.ts";
import { decodeDesignPageMessage } from "../../shared/ipc-inputs.ts";
import { capturePageRetrying } from "./browser-runtime.ts";
import type { DesignPageMessage } from "../../shared/ipc-inputs.ts";
import type { Surface, SurfaceRegistry } from "./browser-surface.ts";

const CROP_WIDTH = 1200;

type PagePick = Extract<DesignPageMessage, { kind: "pick" }>;

export function changeDesign(
  registry: SurfaceRegistry,
  surface: Surface,
  change: BrowserDesignChange,
): void {
  const design = changed(surface.design, change);

  if (design === surface.design) return;
  surface.design = design;
  send(surface, { kind: "design", design });
  registry.publish(surface);
}

export function wireDesign(
  registry: SurfaceRegistry,
  surface: Surface,
  contents: WebContents,
): void {
  contents.ipc.on(BROWSER_PAGE_DESIGN_CHANNEL, (event, input: unknown) => {
    if (event.senderFrame !== contents.mainFrame) return;
    let message: DesignPageMessage;

    try {
      message = decodeDesignPageMessage(input);
    } catch {
      return;
    }

    if (message.kind !== "pick") {
      changeDesign(registry, surface, message);

      return;
    }

    const captured = { kind: "captured", id: message.id } as const;

    if (!surface.design.on) {
      send(surface, captured);

      return;
    }

    void designPick(contents, message)
      .then((pick) =>
        registry.notify(surface, { kind: "browser_design_pick", surface: surface.id, pick }),
      )
      .finally(() => send(surface, captured));
  });
  contents.on("dom-ready", () => {
    if (surface.design.on) send(surface, { kind: "design", design: surface.design });
  });
}

function changed(design: BrowserDesign, change: BrowserDesignChange): BrowserDesign {
  switch (change.kind) {
    case "on":
      return design.on ? design : { ...design, on: true };
    case "off":
      return design.on ? { ...design, on: false } : design;
    case "view":
      return design.on && design.views[change.view] !== change.shown
        ? { ...design, views: { ...design.views, [change.view]: change.shown } }
        : design;
    default: {
      const exhaustive: never = change;

      return exhaustive;
    }
  }
}

function send(surface: Surface, message: DesignMainMessage): void {
  const contents = surface.guest;

  if (contents !== undefined && !contents.isDestroyed()) {
    contents.send(BROWSER_PAGE_DESIGN_CHANNEL, message);
  }
}

async function designPick(contents: WebContents, pick: PagePick): Promise<BrowserDesignPick> {
  const url = contents.getURL();
  const image = await capture(contents, pick.crop);

  return {
    source:
      pick.region === undefined
        ? { kind: "browser", url, selector: pick.selector }
        : { kind: "browser", url, selector: pick.selector, region: pick.region },
    text: pick.text,
    image,
  };
}

async function capture(contents: WebContents, crop: PagePick["crop"]): Promise<string | undefined> {
  const zoom = contents.getZoomFactor();
  const x = Math.max(0, Math.floor(crop.x * zoom));
  const y = Math.max(0, Math.floor(crop.y * zoom));
  const width = Math.ceil((crop.x + crop.width) * zoom) - x;
  const height = Math.ceil((crop.y + crop.height) * zoom) - y;

  if (width < 1 || height < 1) return undefined;
  const image = await capturePageRetrying(contents, { x, y, width, height });

  if (image === undefined) return undefined;

  const kept =
    image.getSize().width > CROP_WIDTH
      ? image.resize({ width: CROP_WIDTH, quality: "good" })
      : image;

  return kept.toDataURL();
}
