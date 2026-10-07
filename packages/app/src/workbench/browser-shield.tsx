import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { BrowserSurfaceState } from "../bridge.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
  MenuSwitchItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { changeHostSettings, hostSetting, useSetting } from "../preferences/index.ts";

const styles = create({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: type.fontCode,
    fontFamily: type.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  off: { color: role.contentDisabled },
  menu: { minWidth: 260 },
});

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function covers(allowed: string, host: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

interface ShieldMenuProps {
  readonly state: BrowserSurfaceState;
  /** A changed shield applies to the next load, so the page reloads. */
  readonly onChanged: () => void;
}

export function ShieldMenu({ state, onChanged }: ShieldMenuProps): ReactElement {
  const blockAds = useSetting(hostSetting("blockAds")) ?? true;
  const allowedHosts = useSetting(hostSetting("adblockAllowedHosts")) ?? [];
  const host = hostOf(state.url);
  const unavailable = blockAds && state.blocking === "off";
  const active = state.blocking === "on";

  const change = (patch: Parameters<typeof changeHostSettings>[0]): void => {
    void changeHostSettings(patch).then(onChanged);
  };

  const summary = unavailable
    ? "No filter lists in this build"
    : state.blocking === "off"
      ? "Blocking off everywhere"
      : state.blocking === "paused"
        ? `Paused for ${host}`
        : `${String(state.blocked)} blocked on this page`;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button aria-haspopup="menu" title={summary}>
            <span {...props(styles.badge, !active && styles.off)}>
              <Icon name="shield" size={12} />
              {active ? String(state.blocked) : state.blocking === "paused" ? "paused" : "off"}
            </span>
          </Button>
        }
      />
      <MenuContent align="end" xstyle={styles.menu}>
        <MenuGroup>
          <MenuGroupLabel>{summary}</MenuGroupLabel>
          <MenuSwitchItem
            checked={active}
            disabled={!blockAds || unavailable || host === ""}
            onCheckedChange={(block) =>
              change({
                adblockAllowedHosts: block
                  ? allowedHosts.filter((allowed) => !covers(allowed, host))
                  : [...allowedHosts, host],
              })
            }
          >
            Block on {host || "This Page"}
          </MenuSwitchItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuSwitchItem
          checked={blockAds}
          disabled={unavailable}
          onCheckedChange={(block) => change({ blockAds: block })}
        >
          Block Ads and Trackers
        </MenuSwitchItem>
      </MenuContent>
    </Menu>
  );
}
