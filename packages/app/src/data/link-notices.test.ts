import { expect, test } from "vitest";
import { SdkError } from "@nyte-ai/sdk";
import type { LinkState } from "@nyte-ai/sdk/client";
import { readLinkNotices } from "./link-notices.ts";
import type { LinkNotices } from "./link-notices.ts";

function open(match: Extract<LinkState, { readonly kind: "open" }>["match"]): LinkState {
  return { kind: "open", since: 1, version: "0.0.29", startedAt: 1, match };
}

function away(reason: Extract<LinkState, { readonly kind: "away" }>["reason"]): LinkState {
  return { kind: "away", since: 1, retryAt: 2, reason };
}

function refused(reason: Extract<LinkState, { readonly kind: "refused" }>["reason"]): LinkState {
  return { kind: "refused", reason, error: new SdkError("not_supported", "Refused.") };
}

const NOTHING: LinkNotices = { banner: null, composer: null, sidebar: null };

const rows: readonly {
  readonly name: string;
  readonly link: LinkState;
  readonly restartable: boolean;
  readonly notices: LinkNotices;
}[] = [
  { name: "the first dial", link: { kind: "connecting" }, restartable: true, notices: NOTHING },
  { name: "the same build", link: open({ kind: "current" }), restartable: true, notices: NOTHING },
  { name: "a newer host", link: open({ kind: "host-newer" }), restartable: true, notices: NOTHING },
  {
    name: "an older host that updates once idle",
    link: open({ kind: "host-older", replace: "when-idle" }),
    restartable: true,
    notices: NOTHING,
  },
  {
    name: "an older host the desktop app restarts",
    link: open({ kind: "host-older", replace: "manual" }),
    restartable: true,
    notices: {
      banner: {
        role: "status",
        text: "Nyte Host runs an older build than this app. Restart it to update.",
        restart: true,
      },
      composer: null,
      sidebar: null,
    },
  },
  {
    name: "an older host a web app can't restart",
    link: open({ kind: "host-older", replace: "manual" }),
    restartable: false,
    notices: {
      banner: {
        role: "status",
        text: "This host runs an older build of Nyte, so some features may not work. Update Nyte on the host.",
        restart: false,
      },
      composer: null,
      sidebar: null,
    },
  },
  {
    name: "a host updating itself",
    link: away("replacing"),
    restartable: true,
    notices: {
      banner: null,
      composer: { role: "status", text: "Nyte Host is updating…", restart: false },
      sidebar: "Can't load chats. Retrying…",
    },
  },
  {
    name: "a host restarting",
    link: away("restarting"),
    restartable: true,
    notices: {
      banner: null,
      composer: { role: "status", text: "Nyte Host is restarting…", restart: false },
      sidebar: "Can't load chats. Retrying…",
    },
  },
  {
    name: "a host someone stopped",
    link: away("stopping"),
    restartable: true,
    notices: {
      banner: null,
      composer: { role: "status", text: "Nyte Host stopped.", restart: false },
      sidebar: "Can't load chats. Retrying…",
    },
  },
  {
    name: "a lost link",
    link: away("lost"),
    restartable: true,
    notices: {
      banner: null,
      composer: { role: "status", text: "Reconnecting to the host…", restart: false },
      sidebar: "Can't load chats. Retrying…",
    },
  },
  {
    name: "a host too old to talk to, which the desktop app restarts",
    link: refused("update-host"),
    restartable: true,
    notices: {
      banner: {
        role: "alert",
        text: "Nyte Host runs a build too old for this app. Restart it to update.",
        restart: true,
      },
      composer: null,
      sidebar: "Can't load chats.",
    },
  },
  {
    name: "a host too new for this app",
    link: refused("update-client"),
    restartable: true,
    notices: {
      banner: {
        role: "alert",
        text: "This host runs a newer Nyte. Update this app to reach it.",
        restart: false,
      },
      composer: null,
      sidebar: "Can't load chats.",
    },
  },
  {
    name: "a device the host stopped accepting",
    link: refused("auth"),
    restartable: false,
    notices: {
      banner: {
        role: "alert",
        text: "The host no longer accepts this device. Pair it again.",
        restart: false,
      },
      composer: null,
      sidebar: "Can't load chats.",
    },
  },
  {
    name: "another host at the address",
    link: refused("other-host"),
    restartable: false,
    notices: {
      banner: {
        role: "alert",
        text: "A different host answered at this address. Reconnect to reach it.",
        restart: false,
      },
      composer: null,
      sidebar: "Can't load chats.",
    },
  },
  { name: "a closed connection", link: { kind: "closed" }, restartable: true, notices: NOTHING },
];

test("each link state shows at most one banner and one composer row", () => {
  expect(
    rows.map((row) => ({ name: row.name, notices: readLinkNotices(row.link, row.restartable) })),
  ).toEqual(rows.map((row) => ({ name: row.name, notices: row.notices })));
});
