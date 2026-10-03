/**
 * The phone in the sidebar footer. Unlinked, it opens the link tray; linked, it
 * carries the access status as a dot and opens Environments. It reads only
 * this Mac's link, never who is signed in, and a build without account remote
 * access shows nothing.
 */
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import type { ConnectBridge } from "../bridge.ts";
import { linkedStanding, useConnectView } from "./connect-view.ts";
import type { ConnectionStanding } from "./connection-list.tsx";
import { LinkTray } from "./link-tray.tsx";
import { shellActions } from "./shell-state.ts";

const styles = create({
  badged: { position: "relative", display: "inline-flex" },
  badge: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineEnd: 0,
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: role.contentSecondary,
  },
});

function PhoneGlyph({ tone }: { readonly tone: ConnectionStanding["tone"] | undefined }) {
  return (
    <span {...props(styles.badged)}>
      <Icon name="phone" size={16} />
      {tone !== undefined && (
        <span
          aria-hidden="true"
          {...props(
            tone === "on" && intent.success,
            tone === "warn" && intent.warning,
            tone === "err" && intent.danger,
            styles.badge,
          )}
        />
      )}
    </span>
  );
}

export function RemoteAccessGlyph({
  connect,
}: {
  readonly connect: ConnectBridge;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const view = useConnectView(connect, true).data;

  if (view === undefined || view.kind === "unavailable") return null;

  if (view.kind === "linked" && !open) {
    const { tone, status } = linkedStanding(view);

    return (
      <Button
        iconOnly
        aria-label={`Remote access: ${status}`}
        onClick={() => shellActions.openEnvironments()}
      >
        <PhoneGlyph tone={tone} />
      </Button>
    );
  }

  const linking =
    view.kind === "unlinked" &&
    (view.linking.kind === "waiting_for_account" || view.linking.kind === "linking");

  return (
    <LinkTray
      connect={connect}
      open={open}
      onOpenChange={setOpen}
      side="top"
      trigger={
        <Button iconOnly aria-label={linking ? "Linking This Mac…" : "Link This Mac…"}>
          <PhoneGlyph tone={undefined} />
        </Button>
      }
    />
  );
}
