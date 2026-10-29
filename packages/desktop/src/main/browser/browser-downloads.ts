import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { app } from "electron";
import type { DownloadItem } from "electron";
import type { BrowserDownload, HostEvent } from "@nyte-ai/app/bridge.ts";
import { uniqueDownloadName } from "./browser-policy.ts";
import type { Surface } from "./browser-surface.ts";

const PROGRESS_INTERVAL_MS = 250;

export class BrowserDownloads {
  readonly #items = new Map<string, DownloadItem>();
  readonly #emit: (surface: Surface, event: HostEvent) => void;

  constructor(emit: (surface: Surface, event: HostEvent) => void) {
    this.#emit = emit;
  }

  start(surface: Surface, item: DownloadItem): void {
    const folder = app.getPath("downloads");
    const id = randomUUID();

    const path = join(
      folder,
      uniqueDownloadName(item.getFilename(), (name) => existsSync(join(folder, name))),
    );

    item.setSavePath(path);
    this.#items.set(id, item);

    const report = (state: BrowserDownload["state"]): void => {
      this.#emit(surface, {
        kind: "browser_download",
        surface: surface.id,
        download: {
          id,
          url: item.getURL(),
          filename: basename(path),
          path,
          received: item.getReceivedBytes(),
          total: item.getTotalBytes(),
          state,
        },
      });
    };

    let reported = 0;
    report("progressing");
    item.on("updated", (_event, state) => {
      const now = Date.now();

      if (state === "progressing" && now - reported < PROGRESS_INTERVAL_MS) return;
      reported = now;
      report(state);
    });
    item.once("done", (_event, state) => {
      this.#items.delete(id);
      report(state);
    });
  }

  cancel(id: string): void {
    this.#items.get(id)?.cancel();
  }
}
