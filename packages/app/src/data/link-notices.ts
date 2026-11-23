import type { LinkState } from "@nyte-ai/sdk/client";

export interface LinkNotice {
  readonly role: "status" | "alert";
  readonly text: string;
  readonly restart: boolean;
}

export interface LinkNotices {
  /** The shell's one banner: what about the host needs the person. */
  readonly banner: LinkNotice | null;
  /** The composer's one status row: why the host isn't answering now. */
  readonly composer: LinkNotice | null;
  /** Why the chat list is empty, while it has no rows to show. */
  readonly sidebar: string | null;
}

const NONE: LinkNotices = { banner: null, composer: null, sidebar: null };

/** `restartable` when this app can restart the host, as the desktop app can its own. */
export function readLinkNotices(link: LinkState, restartable: boolean): LinkNotices {
  switch (link.kind) {
    case "connecting":
    case "closed":
      return NONE;
    case "open":
      return { ...NONE, banner: buildBanner(link.match, restartable) };
    case "away":
      return {
        banner: null,
        composer: { role: "status", text: AWAY[link.reason], restart: false },
        sidebar: "Can't load chats. Retrying…",
      };
    case "refused":
      return {
        banner:
          link.reason === "update-host" && restartable
            ? { role: "alert", text: TOO_OLD_TO_RESTART, restart: true }
            : { role: "alert", text: REFUSED[link.reason], restart: false },
        composer: null,
        sidebar: "Can't load chats.",
      };
    default: {
      const _exhaustive: never = link;

      return _exhaustive;
    }
  }
}

const AWAY = {
  replacing: "Nyte Host is updating…",
  restarting: "Nyte Host is restarting…",
  stopping: "Nyte Host stopped.",
  lost: "Reconnecting to the host…",
} as const satisfies Record<Extract<LinkState, { readonly kind: "away" }>["reason"], string>;

const TOO_OLD_TO_RESTART = "Nyte Host runs a build too old for this app. Restart it to update.";

const REFUSED = {
  auth: "The host no longer accepts this device. Pair it again.",
  "update-host": "This host runs a build of Nyte too old for this app. Update Nyte on the host.",
  "update-client": "This host runs a newer Nyte. Update this app to reach it.",
  "other-host": "A different host answered at this address. Reconnect to reach it.",
} as const satisfies Record<Extract<LinkState, { readonly kind: "refused" }>["reason"], string>;

function buildBanner(
  match: Extract<LinkState, { readonly kind: "open" }>["match"],
  restartable: boolean,
): LinkNotice | null {
  if (match.kind !== "host-older" || match.replace === "when-idle") return null;

  if (match.replace === "manual" && restartable) {
    return {
      role: "status",
      text: "Nyte Host runs an older build than this app. Restart it to update.",
      restart: true,
    };
  }

  return {
    role: "status",
    text: "This host runs an older build of Nyte, so some features may not work. Update Nyte on the host.",
    restart: false,
  };
}
