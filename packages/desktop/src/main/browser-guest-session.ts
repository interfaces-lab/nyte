/** Guest sessions: one cookie jar per workspace, with its permission, ad-block, and HTTPS policy. */
import { createHash } from "node:crypto";
import { app, session } from "electron";
import type { BrowserSurfaceState } from "@nyte-ai/app/bridge.ts";
import { loadBlocker, shieldPaused } from "./adblock.ts";
import type { Blocker } from "./adblock.ts";
import type { BrowserOwner } from "./browser-agent.ts";
import type { BrowserDownloads } from "./browser-downloads.ts";
import { httpsUpgrade, permissionAllowed } from "./browser-policy.ts";
import { countSessionHolders, hasViewHolder } from "./browser-surface.ts";
import type { BrowserSurfacesDependencies, GuestSession, Surface } from "./browser-surface.ts";

function partitionName(owner: BrowserOwner): string {
  if (owner.kind === "home") return "persist:nyte-browser";
  const hash = createHash("sha256").update(owner.path).digest("hex").slice(0, 16);

  return `persist:nyte-browser-${hash}`;
}

function guestUserAgent(): string {
  return app.userAgentFallback
    .split(" ")
    .filter((token) => !token.startsWith("Electron/") && !token.startsWith(`${app.name}/`))
    .join(" ");
}

export interface GuestSessionsOptions {
  readonly dependencies: BrowserSurfacesDependencies;
  readonly downloads: BrowserDownloads;
  /** The live surface showing this `WebContents`, if any. */
  readonly surface: (webContentsId: number) => Surface | undefined;
  readonly publish: (surface: Surface) => void;
}

export class GuestSessions {
  readonly #options: GuestSessionsOptions;
  /** Keyed by partition name. */
  readonly #sessions = new Map<string, GuestSession>();
  #blocker: Blocker | undefined;
  #blockerReady: Promise<void> | undefined;

  constructor(options: GuestSessionsOptions) {
    this.#options = options;
  }

  /** Loads the filter engine once; pages load after it so the first request is filtered. */
  ensureBlocker(): Promise<void> {
    this.#blockerReady ??= loadBlocker(this.#options.dependencies.filterListPath).then((loaded) => {
      this.#blocker = loaded;
    });

    return this.#blockerReady;
  }

  blocking(url: string): BrowserSurfaceState["blocking"] {
    const settings = this.#options.dependencies.settings();

    if (this.#blocker === undefined || !settings.blockAds) return "off";

    return shieldPaused(url, settings.adblockAllowedHosts) ? "paused" : "on";
  }

  blockedStyles(url: string): string {
    return this.blocking(url) === "on" ? (this.#blocker?.stylesFor(url) ?? "") : "";
  }

  forOwner(owner: BrowserOwner): GuestSession {
    const partition = partitionName(owner);
    const existing = this.#sessions.get(partition);

    if (existing !== undefined) return existing;

    void this.ensureBlocker();

    const guestSession: GuestSession = {
      session: session.fromPartition(partition),
      plainHosts: new Set(),
      upgrades: new Map(),
      trustedCertificateHosts: new Set(),
    };

    this.#configure(guestSession);
    this.#sessions.set(partition, guestSession);

    return guestSession;
  }

  #configure(guestSession: GuestSession): void {
    const { dependencies, downloads, surface: surfaceFor, publish } = this.#options;
    const guest = guestSession.session;

    guest.setUserAgent(guestUserAgent());
    guest.setSpellCheckerEnabled(false);
    guest.registerPreloadScript({ type: "frame", filePath: dependencies.pagePreload });

    guest.setPermissionRequestHandler((contents, permission, callback) => {
      const allowed = permissionAllowed(permission);

      if (!allowed) {
        const surface = surfaceFor(contents.id);

        if (surface !== undefined && !surface.deniedPermissions.has(permission)) {
          surface.deniedPermissions.add(permission);
          publish(surface);
        }
      }

      callback(allowed);
    });
    guest.setPermissionCheckHandler((_contents, permission) => permissionAllowed(permission));

    guest.on("will-download", (event, item, contents) => {
      const surface = surfaceFor(contents.id);

      if (surface === undefined || !hasViewHolder(surface) || countSessionHolders(surface) > 0) {
        event.preventDefault();

        return;
      }

      downloads.start(surface, item);
    });

    guest.webRequest.onBeforeRequest((details, callback) => {
      const surface =
        details.webContentsId === undefined ? undefined : surfaceFor(details.webContentsId);

      const contents = surface?.view.webContents;

      const blocking = this.blocking(
        contents === undefined || contents.isDestroyed() ? "" : contents.getURL(),
      );

      if (this.#blocker !== undefined && blocking === "on") {
        const decision = this.#blocker.decide(details);

        if (decision.kind !== "allow") {
          if (surface !== undefined) surface.blocked += 1;

          callback(decision.kind === "block" ? { cancel: true } : { redirectURL: decision.url });

          return;
        }
      }

      if (details.resourceType !== "mainFrame") {
        callback({});

        return;
      }

      const upgraded = dependencies.settings().upgradeToHttps
        ? httpsUpgrade(details.url, guestSession.plainHosts)
        : undefined;

      if (upgraded === undefined) {
        callback({});

        return;
      }

      if (details.webContentsId !== undefined)
        guestSession.upgrades.set(details.webContentsId, details.url);
      callback({ redirectURL: upgraded });
    });

    guest.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, "Sec-GPC": "1" } });
    });
  }
}
