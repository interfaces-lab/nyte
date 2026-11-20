import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { control, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, keyframes, props } from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, ReactElement, ReactNode, RefObject } from "react";
import type {
  BrowserBridge,
  BrowserDesignChange,
  BrowserNavigationAction,
} from "../../contract/bridge.ts";
import { NO_DESIGN } from "../../contract/bridge.ts";
import { errorMessage } from "../../contract/errors.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { Row } from "@nyte-ai/ui/row";
import { workbenchStyles } from "../workbench.stylex.ts";
import { SidePanel } from "../side-panel.tsx";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../../contract/nyte.ts";
import { openExternal } from "../../lib/open-external.ts";
import { displayAddress, parseWebUrl } from "./browser-address.ts";
import { AddressField } from "./browser-address-field.tsx";
import type { AddressFieldHandle } from "./browser-address-field.tsx";
import { useBrowserHistory } from "./browser-history.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { focusGuest, placeGuest } from "./browser-guests.tsx";
import {
  applyBrowserEvent,
  claimBrowserSurface,
  forgetBrowserSurface,
  onBrowserKey,
  onBrowserPick,
  setBrowserFinding,
  useBrowserSurface,
} from "./browser-surfaces.ts";
import { DesignBar } from "./browser-design-bar.tsx";
import { addPickToChat } from "./browser-pick.ts";
import { DownloadsBar } from "./browser-downloads.tsx";
import { FindBar } from "./browser-find.tsx";
import type { FindBarHandle } from "./browser-find.tsx";
import { LoginDialog } from "./browser-login.tsx";
import { repeatsWhenHeld, resolveBrowserShortcut } from "../../contract/browser-shortcuts.ts";
import type { BrowserShortcut } from "../../contract/browser-shortcuts.ts";

import { toggleBookmark, toggleBookmarkBar, useBookmarks } from "./browser-bookmarks.ts";
import { ShieldMenu } from "./browser-shield.tsx";

const pageLoading = keyframes({
  from: { transform: "translateX(-100%)" },
  to: { transform: "translateX(340%)" },
});

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  toolbar: { position: "relative", gap: space.s2 },
  progress: {
    position: "absolute",
    insetInline: 0,
    insetBlockEnd: 0,
    height: space.s0_5,
    overflow: "clip",
    pointerEvents: "none",
  },
  progressBar: {
    width: { default: "30%", "@media (prefers-reduced-motion: reduce)": "100%" },
    height: "100%",
    backgroundColor: role.bgInteractiveStrong,
    animationName: { default: pageLoading, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.2s",
    animationTimingFunction: motion.easeOut,
    animationIterationCount: "infinite",
  },
  bookmarks: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    minHeight: control.heightMd,
    paddingInline: space.s1_5,
    overflowX: "auto",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.strokeQuaternary,
  },
  bookmark: { display: "flex", alignItems: "center", gap: space.s2, flexShrink: 0, maxWidth: 220 },
  bookmarkButton: { flex: 1, minWidth: 0 },
  bookmarkLabel: {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  addressIcon: { display: "inline-flex", flexShrink: 0, color: role.contentSecondary },
  blockedIcon: { display: "inline-flex", flexShrink: 0, color: role.contentTertiary },
  slot: {
    position: "relative",
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: space.s6,
  },
  body: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  history: { flex: 1, minHeight: 0, overflowY: "auto", padding: space.s1 },
  historyHeading: {
    margin: 0,
    paddingBlock: space.s1_5,
    paddingInline: space.s1_5,
    color: role.contentSecondary,
    fontWeight: type.weightRegular,
  },
  historyEntry: {
    minHeight: row.heightLg,
    paddingBlock: space.s1_5,
    color: { default: role.contentSecondary, "[data-selected]": role.contentPrimary },
  },
  historyAddress: { fontSize: type.fontXs, lineHeight: type.leadingXs },
  message: {
    display: "flex",
    maxWidth: 360,
    flexDirection: "column",
    gap: space.s2,
    textAlign: "center",
  },
  messageTitle: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontWeight: type.weightSemibold,
  },
  messageDetail: {
    color: role.contentSecondary,
  },
  notice: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    paddingBlock: space.s1_5,
    paddingInline: space.s2_5,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.strokeQuaternary,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  noticeText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  agentBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    flexShrink: 0,
    paddingInline: space.s1_5,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
});

interface SurfaceHold {
  opened: boolean;
  url: string | undefined;
  released: boolean;
}

function browserBridge(): BrowserBridge {
  const browser = nyte.host.browser;

  if (browser === undefined) throw new Error("This host does not provide browser tabs");

  return browser;
}

function releaseSurface(surface: string): void {
  forgetBrowserSurface(surface);
  void browserBridge()
    .close({ surface })
    .catch(() => undefined);
}

interface PagePlacement {
  readonly focus: () => void;
  readonly cancelFocus: () => void;
}

function usePagePlacement(
  slot: RefObject<HTMLDivElement | null>,
  surface: string,
  visible: boolean,
): PagePlacement {
  const pageFocus = useRef(false);
  const placeRef = useRef<() => void>(() => undefined);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- keeps the page's guest on the slot, measured before paint
  useLayoutEffect(() => {
    const element = slot.current;

    if (element === null) return;
    let frame: number | undefined;

    const measure = (): void => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      const rect = element.getBoundingClientRect();
      const shown = visible && rect.width > 0 && rect.height > 0;

      placeGuest(
        surface,
        shown
          ? {
              rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
              scale: 1,
              clip: null,
              interactive: true,
            }
          : null,
      );

      if (!shown || !pageFocus.current) return;
      pageFocus.current = false;
      focusGuest(surface);
    };

    const schedule = (): void => {
      if (frame === undefined) frame = requestAnimationFrame(measure);
    };

    const scrolled = (event: Event): void => {
      if (event.target instanceof Node && event.target.contains(element)) schedule();
    };

    const observer = new ResizeObserver(measure);

    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      observer.observe(node);
    }

    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", scrolled, { capture: true, passive: true });
    placeRef.current = schedule;
    measure();

    return () => {
      placeRef.current = () => undefined;
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", scrolled, { capture: true });

      if (frame !== undefined) cancelAnimationFrame(frame);
      placeGuest(surface, null);
    };
  }, [slot, surface, visible]);

  return {
    focus: () => {
      pageFocus.current = true;
      placeRef.current();
    },
    cancelFocus: () => {
      pageFocus.current = false;
    },
  };
}

const PERMISSION_NAMES = new Map([
  ["media", "Camera and microphone"],
  ["notifications", "Notifications"],
  ["geolocation", "Location"],
  ["midi", "MIDI"],
  ["midiSysex", "MIDI"],
  ["pointerLock", "Pointer lock"],
  ["openExternal", "Opening other apps"],
  ["display-capture", "Screen capture"],
  ["clipboard-read", "Clipboard reading"],
  ["idle-detection", "Idle detection"],
]);

function blockedPermissionsLabel(permissions: readonly string[]): string {
  const names = [...new Set(permissions.map((name) => PERMISSION_NAMES.get(name) ?? name))];

  return `Blocked by Nyte: ${names.join(", ")}`;
}

function FocusAddressNextFrame({
  address,
}: {
  readonly address: RefObject<AddressFieldHandle | null>;
}): null {
  useMountEffect(() => {
    const frame = requestAnimationFrame(() => address.current?.focus());

    return () => cancelAnimationFrame(frame);
  });

  return null;
}

interface BrowserPanelProps {
  readonly surface: string;
  readonly visible: boolean;
  readonly historyVisible: boolean;
  readonly onToggleHistory: () => void;
  readonly url: string;
  readonly onUrlChange: (url: string) => void;
  readonly toolbarActions?: ReactNode;
  readonly workspacePath: string | null;
}

export function BrowserPanel({
  surface,
  visible,
  historyVisible,
  onToggleHistory,
  url,
  onUrlChange,
  toolbarActions,
  workspacePath,
}: BrowserPanelProps): ReactElement {
  const bookmarks = useBookmarks();
  const sectionRef = useRef<HTMLElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<AddressFieldHandle>(null);
  const findRef = useRef<FindBarHandle>(null);
  const { state, downloads, finding, login } = useBrowserSurface(surface);
  const history = useBrowserHistory(workspacePath);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const stateUrl = state?.url;
  const blank = parseWebUrl(url) === undefined;
  const currentUrl = stateUrl ?? (blank ? "" : url);
  const hasPage = state !== undefined && state.url !== "";
  const design = state?.design ?? NO_DESIGN;
  const showSurface = visible && hasPage && state.error === undefined;

  const page = usePagePlacement(slotRef, surface, showSurface);

  const holdRef = useRef<SurfaceHold | undefined>(undefined);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- holds the native surface for this surface and workspace
  useEffect(() => {
    const hold: SurfaceHold = { opened: false, url: undefined, released: false };
    holdRef.current = hold;

    return () => {
      hold.released = true;
      holdRef.current = undefined;
      releaseSurface(surface);
    };
  }, [surface, workspacePath]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- opens the requested URL when the native surface drifts from it
  useEffect(() => {
    const hold = holdRef.current;

    if (hold === undefined || parseWebUrl(url) === undefined) return;

    if (hold.opened && (url === stateUrl || url === hold.url)) {
      hold.url = url;

      return;
    }

    hold.opened = true;
    hold.url = url;
    let superseded = false;

    const owner =
      workspacePath === null
        ? ({ kind: "home" } as const)
        : ({ kind: "project", path: workspacePath } as const);

    claimBrowserSurface(surface);
    void browserBridge()
      .open({ surface, url, owner, holder: "tab" })
      .then(
        (openState) => {
          if (hold.released || superseded) return;
          applyBrowserEvent({ kind: "browser_changed", surface, state: openState });
        },
        (cause: unknown) => {
          if (hold.released || superseded) return;
          setFailure(errorMessage(cause));
        },
      );

    return () => {
      superseded = true;
    };
  }, [surface, url, stateUrl, workspacePath]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- clears native page focus when the panel hides or the surface changes
  useEffect(() => {
    if (!visible) return;

    return () => browserBridge().setFocus({ surface, focused: false });
  }, [surface, visible]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- key events forwarded from the native surface, resubscribed per surface
  useEffect(
    () =>
      onBrowserKey(surface, (key) => {
        sectionRef.current?.dispatchEvent(
          new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }),
        );
      }),
    [surface],
  );

  // oxlint-disable-next-line nyte-code/no-direct-effect -- picks forwarded from the page's Design Mode, resubscribed per surface
  useEffect(
    () =>
      onBrowserPick(surface, (pick) => {
        void addPickToChat(pick).catch((cause: unknown) => setFailure(errorMessage(cause)));
      }),
    [surface],
  );

  const navigate = (action: BrowserNavigationAction): void => {
    void browserBridge()
      .navigate({ surface, action })
      .catch(() => undefined);
  };

  const focusControls = (): void => {
    page.cancelFocus();
    browserBridge().setFocus({ surface, focused: true });
  };

  const changeDesign = (change: BrowserDesignChange): void => {
    setFailure(undefined);
    void browserBridge()
      .design({ surface, change })
      .catch((cause: unknown) => setFailure(errorMessage(cause)));

    if (change.kind === "on") focusGuest(surface);
  };

  const runShortcut = (shortcut: BrowserShortcut): boolean => {
    switch (shortcut) {
      case "back":
      case "forward":
      case "reload":
      case "hard-reload":
      case "zoom-in":
      case "zoom-out":
      case "zoom-reset":
      case "toggle-devtools":
        navigate(shortcut);

        return true;
      case "focus-address":
        focusControls();
        addressRef.current?.focus();

        return true;
      case "find":
        if (!hasPage) return false;
        focusControls();

        if (finding) findRef.current?.focus();
        else setBrowserFinding(surface, true);

        return true;
      case "find-next":
      case "find-previous":
        if (!finding || !hasPage) return false;
        findRef.current?.step(shortcut === "find-next" ? "next" : "previous");

        return true;
      case "bookmark":
        if (!hasPage) return false;
        toggleBookmark({ url: currentUrl, title: state.title || currentUrl });

        return true;
      case "history":
        onToggleHistory();

        return true;
      case "design-mode":
        if (!hasPage) return false;
        changeDesign({ kind: design.on ? "off" : "on" });

        return true;
      default: {
        const _exhaustive: never = shortcut;

        return _exhaustive;
      }
    }
  };

  const go = (target: string): void => {
    setFailure(undefined);
    page.focus();

    if (target === url) navigate("reload");
    else onUrlChange(target);
  };

  const forget = (entry: string): void => {
    void browserBridge()
      .forgetHistory({ owner: workspacePath, url: entry })
      .catch((cause) => setFailure(errorMessage(cause)));
  };

  const openMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    setFailure(undefined);
    void browserBridge()
      .menu({
        surface,
        bookmarksVisible: bookmarks.visible,
        x: Math.round(rect.left),
        y: Math.round(rect.bottom),
        owner: workspacePath,
      })
      .then(async (action) => {
        if (action === undefined) return;

        if (action === "toggle-bookmarks") {
          toggleBookmarkBar();

          return;
        }

        if (action === "hard-reload") {
          navigate(action);

          return;
        }

        await browserBridge().perform({ surface, action, owner: workspacePath });
      })
      .catch((cause) => setFailure(errorMessage(cause)));
  };

  const loading = state?.loading === true;
  const secure = state?.secure ?? "none";
  const agentActive = (state?.agentHolders ?? 0) > 0;

  return (
    <section
      ref={sectionRef}
      aria-label="Browser"
      {...props(styles.panel)}
      onFocus={focusControls}
      onBlur={(event) => {
        const next = event.relatedTarget;

        if (next instanceof Node && event.currentTarget.contains(next)) return;
        browserBridge().setFocus({ surface, focused: false });
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;

        const shortcut = resolveBrowserShortcut(
          event,
          nyte.platform === "darwin",
          event.target === event.currentTarget ? "page" : "panel",
        );

        if (shortcut === undefined) return;

        if (event.repeat && !repeatsWhenHeld(shortcut)) {
          event.preventDefault();

          return;
        }

        if (!runShortcut(shortcut)) return;
        event.preventDefault();
      }}
    >
      {visible && blank && <FocusAddressNextFrame address={addressRef} />}
      <div {...props(workbenchStyles.toolbar, hairline.blockEnd, styles.toolbar)}>
        <Button
          iconOnly
          icon="arrow-left"
          aria-label="Go back"
          disabled={state?.canGoBack !== true}
          onClick={() => {
            page.focus();
            navigate("back");
          }}
        />
        <Button
          iconOnly
          icon="arrow-right"
          aria-label="Go forward"
          disabled={state?.canGoForward !== true}
          onClick={() => {
            page.focus();
            navigate("forward");
          }}
        />
        <Button
          iconOnly
          icon={loading ? "x" : "refresh"}
          aria-label={loading ? "Stop loading page" : "Reload page"}
          disabled={!hasPage}
          onClick={() => {
            page.focus();
            navigate(loading ? "stop" : "reload");
          }}
        />
        <AddressField
          ref={addressRef}
          currentUrl={currentUrl}
          draft={draft}
          onDraftChange={setDraft}
          history={history}
          bookmarks={bookmarks.items}
          onOpen={go}
          onForget={forget}
          onDismiss={page.focus}
        >
          {secure === "https" && draft === undefined && (
            <span {...props(styles.addressIcon)} title="Secure connection">
              <Icon name="lock" size="xs" />
            </span>
          )}
          {hasPage && draft === undefined && state.deniedPermissions.length > 0 && (
            <span
              {...props(styles.blockedIcon)}
              role="img"
              aria-label={blockedPermissionsLabel(state.deniedPermissions)}
              title={blockedPermissionsLabel(state.deniedPermissions)}
            >
              <Icon name="circle-x" size="xs" />
            </span>
          )}
        </AddressField>
        {hasPage && (
          <Toggle
            iconOnly
            icon="bezier-pointer"
            aria-label="Design Mode"
            aria-keyshortcuts={nyte.platform === "darwin" ? "Meta+Shift+L" : "Control+Shift+L"}
            pressed={design.on}
            onPressedChange={(on) => changeDesign({ kind: on ? "on" : "off" })}
          />
        )}
        {hasPage && <ShieldMenu state={state} onChanged={() => navigate("reload")} />}
        {hasPage ? (
          <ButtonLink
            href={currentUrl}
            target="_blank"
            rel="noreferrer"
            iconOnly
            icon="globe"
            aria-label="Open in system browser"
            onClick={(event) => {
              event.preventDefault();
              openExternal(currentUrl);
            }}
          />
        ) : (
          <Button iconOnly icon="globe" aria-label="Open in system browser" disabled />
        )}
        <Button
          iconOnly
          icon="more-horizontal"
          aria-label="Browser actions"
          onClick={openMenu}
          aria-haspopup="menu"
        />
        {agentActive && (
          <span
            {...props(styles.agentBadge)}
            title="An agent is driving this page"
            aria-label="Agent active"
          >
            <Icon name="sparkle" size="xs" />
          </span>
        )}
        {toolbarActions}
        {loading && (
          <div role="progressbar" aria-label="Loading page" {...props(styles.progress)}>
            <div {...props(styles.progressBar)} />
          </div>
        )}
      </div>
      {hasPage && state.error === undefined && design.on && (
        <DesignBar views={design.views} onChange={changeDesign} onPointerDone={page.focus} />
      )}
      {failure !== undefined && (
        <div role="alert" {...props(styles.notice)}>
          <span {...props(styles.noticeText)}>{failure}</span>
          <Button
            iconOnly
            icon="x"
            aria-label="Dismiss browser error"
            onClick={() => setFailure(undefined)}
          />
        </div>
      )}
      {bookmarks.visible && (
        <div aria-label="Bookmark bar" {...props(styles.bookmarks)}>
          <Button
            variant="outline"
            disabled={!hasPage}
            onClick={() => toggleBookmark({ url: currentUrl, title: state?.title || currentUrl })}
          >
            {bookmarks.items.some((item) => item.url === currentUrl)
              ? "Remove Bookmark"
              : "Bookmark Page"}
          </Button>
          {bookmarks.items.map((item) => (
            <div key={item.url} {...props(styles.bookmark)}>
              <ButtonLink
                href={item.url}
                variant="outline"
                title={item.url}
                xstyle={styles.bookmarkButton}
                onClick={(event) => {
                  event.preventDefault();
                  page.focus();
                  onUrlChange(item.url);
                }}
              >
                <span {...props(styles.bookmarkLabel)}>
                  {item.title || displayAddress(item.url)}
                </span>
              </ButtonLink>
              <Button
                iconOnly
                icon="x"
                aria-label={`Remove bookmark: ${item.title || item.url}`}
                onClick={() => toggleBookmark(item)}
              />
            </div>
          ))}
        </div>
      )}
      {finding && hasPage && <FindBar ref={findRef} surface={surface} onClose={page.focus} />}
      <DownloadsBar surface={surface} downloads={downloads} />
      {login !== undefined && (
        <LoginDialog key={login.host} surface={surface} host={login.host} realm={login.realm} />
      )}
      <div {...props(styles.body)}>
        <div ref={slotRef} {...props(styles.slot)}>
          {!hasPage && failure === undefined && (
            <div {...props(styles.message)}>
              <span {...props(styles.messageTitle)}>Type an address or a search</span>
            </div>
          )}
          {state?.error !== undefined && state.error.untrustedHost === undefined && (
            <div role="alert" {...props(styles.message)}>
              <span {...props(styles.messageTitle)}>This page did not load</span>
              <span {...props(text.sm, styles.messageDetail)}>
                {state.error.description} ({String(state.error.code)})
              </span>
              <Button variant="outline" onClick={() => navigate("reload")}>
                Try Again
              </Button>
            </div>
          )}
          {state?.error?.untrustedHost !== undefined && (
            <div role="alert" {...props(styles.message)}>
              <span {...props(styles.messageTitle)}>This connection isn’t private</span>
              <span {...props(text.sm, styles.messageDetail)}>
                {state.error.untrustedHost} uses a certificate this computer doesn’t trust, which is
                usual for a dev server. Continue only if you run it.
              </span>
              <Button variant="outline" onClick={() => navigate("trust-certificate")}>
                Continue to {state.error.untrustedHost}
              </Button>
            </div>
          )}
        </div>
        {historyVisible && (
          <SidePanel>
            <nav aria-label="Visit history" data-nyte-scrollport {...props(styles.history)}>
              <h2 {...props(text.sm, styles.historyHeading)}>Visit History</h2>
              {history.length === 0 ? (
                <p {...props(text.sm, styles.historyHeading)}>No pages visited yet</p>
              ) : (
                history.map((entry) => (
                  <Row
                    key={entry.url}
                    interactive
                    selected={entry.url === currentUrl}
                    xstyle={[text.sm, styles.historyEntry]}
                  >
                    <Row.Primary
                      render={<a href={entry.url} />}
                      title={entry.url}
                      aria-current={entry.url === currentUrl ? "page" : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        setDraft(undefined);
                        setFailure(undefined);
                        page.focus();
                        onUrlChange(entry.url);
                      }}
                    >
                      <Row.Leading>
                        <Icon name="globe" size="sm" />
                      </Row.Leading>
                      <Row.Body>
                        <Row.Label>{entry.title || displayAddress(entry.url)}</Row.Label>
                        <Row.Description xstyle={styles.historyAddress}>
                          {displayAddress(entry.url)}
                        </Row.Description>
                      </Row.Body>
                    </Row.Primary>
                    <Row.Actions placement="overlay">
                      <Button
                        size="sm"
                        variant="plain"
                        iconOnly
                        icon="x"
                        aria-label={`Remove from history: ${entry.title || displayAddress(entry.url)}`}
                        onClick={() => forget(entry.url)}
                      />
                    </Row.Actions>
                  </Row>
                ))
              )}
            </nav>
          </SidePanel>
        )}
      </div>
    </section>
  );
}
