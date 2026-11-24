import { SdkError } from "@nyte-ai/sdk";
import type { LinkState } from "@nyte-ai/sdk/client";
import { expect, test } from "vitest";
import { SHARE_LOCATION } from "../src/connection/connect-copy.ts";
import { linkMessage } from "../src/connection/live.ts";

const OPEN: LinkState = {
  kind: "open",
  since: 1,
  version: "0.0.29",
  startedAt: 1,
  match: { kind: "host-older", replace: "none" },
};

function refused(reason: Extract<LinkState, { readonly kind: "refused" }>["reason"]): LinkState {
  return { kind: "refused", reason, error: new SdkError("not_supported", "No.") };
}

function away(reason: Extract<LinkState, { readonly kind: "away" }>["reason"]): LinkState {
  return { kind: "away", since: 1, retryAt: 2, reason };
}

test.each<{ readonly link: LinkState; readonly message: string | undefined }>([
  { link: { kind: "connecting" }, message: undefined },
  { link: OPEN, message: undefined },
  { link: away("replacing"), message: "Nyte is updating on your Mac…" },
  { link: away("restarting"), message: "Nyte is restarting on your Mac…" },
  { link: away("stopping"), message: "Nyte stopped on your Mac." },
  { link: away("lost"), message: "Reconnecting to your Mac…" },
  {
    link: refused("other-host"),
    message: "Another Nyte answered at your Mac's address. Scan a new code to reach it.",
  },
  {
    link: refused("auth"),
    message: `Your Mac refused this iPhone. Scan a new code from ${SHARE_LOCATION}.`,
  },
  {
    link: refused("update-host"),
    message: "Your Mac runs an older Nyte. Update Nyte on your Mac.",
  },
  {
    link: refused("update-client"),
    message: "Your Mac runs a newer Nyte. Update Nyte on this iPhone.",
  },
  { link: { kind: "closed" }, message: undefined },
])("says $message for $link.kind", ({ link, message }) => {
  expect(linkMessage(link)).toBe(message);
});
