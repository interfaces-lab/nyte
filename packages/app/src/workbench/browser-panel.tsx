import { button, row } from "@nyte-ai/ui/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
// oxlint-disable-next-line no-restricted-imports -- the native surface follows its surface, workspace, and url
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, ReactElement, ReactNode, RefObject } from "react";
import type { BrowserBoundsMessage, BrowserBridge, BrowserNavigationAction } from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { overlayCovers, subscribeOverlayRects } from "../components/overlay-occlusion.ts";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Row } from "@nyte-ai/ui/row";
import { workbenchStyles } from "./workbench.stylex.ts";
import { WorkbenchRail } from "./workbench-rail.tsx";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { nyte } from "../nyte";
import { macPlatform } from "../platform.ts";
import { keys } from "../queries.ts";
import { displayAddress, parseWebUrl } from "./browser-address.ts";
import { AddressField } from "./browser-address-field.tsx";
import type { AddressFieldHandle } from "./browser-address-field.tsx";
import { useBrowserHistory } from "./browser-history.ts";
import {
  applyBrowserEvent,
  claimBrowserSurface,
  forgetBrowserSurface,
  onBrowserKey,
  setBrowserFinding,
  useBrowserSurface,
} from "./browser-surfaces.ts";
import { DownloadsBar } from "./browser-downloads.tsx";
import { FindBar } from "./browser-find.tsx";
import type { FindBarHandle } from "./browser-find.tsx";
import { LoginDialog } from "./browser-login.tsx";
import { repeatsWhenHeld, resolveBrowserShortcut } from "./browser-shortcuts.ts";
import type { BrowserShortcut } from "./browser-shortcuts.ts";

import { toggleBookmark, toggleBookmarkBar, useBookmarks } from "./browser-bookmarks.ts";
import { ShieldMenu } from "./browser-shield.tsx";

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
  },
  toolbar: { gap: 8 },
  bookmarks: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    minHeight: button.heightMd,
    paddingInline: 6,
    overflowX: "auto",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  bookmark: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0, maxWidth: 220 },
  bookmarkButton: { flex: 1, minWidth: 0 },
  bookmarkLabel: {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  addressIcon: { display: "inline-flex", flexShrink: 0, color: role.contentSecondary },
  blockedIcon: { display: "inline-flex", flexShrink: 0, color: role.contentDisabled },
  slot: {
    position: "relative",
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  body: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  history: { flex: 1, minHeight: 0, overflowY: "auto", padding: 4 },
  historyHeading: {
    margin: 0,
    paddingBlock: 6,
    paddingInline: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontWeight: 400,
    lineHeight: type.leadingSm,
  },
  historyEntry: {
    minHeight: row.heightLg,
    paddingBlock: 6,
    color: { default: role.contentSecondary, "[data-selected]": role.contentPrimary },
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  historyAddress: { fontSize: type.fontXs },
  message: {
    display: "flex",
    maxWidth: 360,
    flexDirection: "column",
    gap: 8,
    textAlign: "center",
  },
  messageTitle: { color: role.contentPrimary, fontSize: type.fontBase, fontWeight: 600 },
  messageDetail: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    paddingBlock: 6,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
    color: role.contentSecondary,
    fontSize: type.fontSm,
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
    gap: 4,
    flexShrink: 0,
    paddingInline: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  // Sits under the native view at all times, so hiding the page reveals a
  // still frame that is already painted rather than an empty panel.
  frozenFrame: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    objectPosition: "top",
    pointerEvents: "none",
  },
  // The still frame is not the live page; a light wash says so without words.
  frozenVeil: {
    position: "absolute",
    inset: 0,
    backgroundColor: role.bgScrim,
    pointerEvents: "none",
  },
});

/**
 * One panel's hold on a surface in main, from the first open until the panel
 * leaves the surface or its owner. Navigation reuses the hold; a reply that
 * lands after release, or after a newer request, is dropped so it cannot write
 * a forgotten surface back into the store.
 */
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

/** Release this surface's view holder in main. */
function releaseSurface(surface: string): void {
  forgetBrowserSurface(surface);
  void browserBridge()
    .close({ surface })
    .catch(() => undefined);
}

function sameBounds(a: BrowserBoundsMessage, b: BrowserBoundsMessage): boolean {
  return (
    a.visible === b.visible &&
    a.bounds.x === b.bounds.x &&
    a.bounds.y === b.bounds.y &&
    a.bounds.width === b.bounds.width &&
    a.bounds.height === b.bounds.height
  );
}

function useSurfaceBounds(
  slot: RefObject<HTMLDivElement | null>,
  surface: string,
  visible: boolean,
): boolean {
  const [covered, setCovered] = useState(false);
  const lastRef = useRef<BrowserBoundsMessage | undefined>(undefined);
  useLayoutEffect(() => {
    const element = slot.current;

    if (element === null) return;
    let frame: number | undefined;

    const measure = (): void => {
      frame = undefined;
      const rect = element.getBoundingClientRect();

      // The page composites above the renderer, so it has to step aside while a
      // menu or a dialog overlaps it.
      const overlapped = overlayCovers({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });

      setCovered(overlapped);

      const message: BrowserBoundsMessage = {
        surface,
        bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        visible: visible && !overlapped && rect.width > 0 && rect.height > 0,
      };

      if (lastRef.current !== undefined && sameBounds(lastRef.current, message)) return;
      lastRef.current = message;
      browserBridge().setBounds(message);
    };

    const schedule = (): void => {
      frame ??= requestAnimationFrame(measure);
    };

    const observer = new ResizeObserver(schedule);

    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      observer.observe(node);
    }

    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    // The overlay store already batches to a frame, so this applies at once
    // rather than a frame after the popup painted.
    const unsubscribe = subscribeOverlayRects(measure);
    measure();

    return () => {
      observer.disconnect();
      unsubscribe();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, { capture: true });

      if (frame !== undefined) cancelAnimationFrame(frame);
      const last = lastRef.current;

      if (last !== undefined && last.visible) {
        lastRef.current = { ...last, visible: false };
        browserBridge().setBounds(lastRef.current);
      }
    };
  }, [slot, surface, visible]);

  return covered;
}

/**
 * The page's last pixels, painted in the slot the native view sits over and
 * refreshed whenever an overlay forces the page to hide, so an open menu leaves
 * a still frame behind it instead of an empty panel. A frame belongs to the url
 * it was taken from; after a navigation the old one is not shown again.
 */
function usePageFrame(surface: string, url: string, covered: boolean): string | undefined {
  const frame = useQuery({
    queryKey: keys.browserFrame(surface, url),
    queryFn: () => browserBridge().captureFrame({ surface }),
    enabled: covered && url !== "",
    // A page re-covered later needs a fresh capture.
    staleTime: 0,
    // A frame is page-sized pixels; nothing shows one from a url the panel left.
    gcTime: 0,
  });

  return frame.data;
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

interface BrowserPanelProps {
  readonly surface: string;
  readonly visible: boolean;
  readonly historyVisible: boolean;
  readonly onToggleHistory: () => void;
  readonly url: string;
  readonly onUrlChange: (url: string) => void;
  readonly toolbarActions?: ReactNode;
  /** Workspace path for per-workspace cookie jars. Null for home. */
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
  // A new tab has no web address yet, so it opens nothing until the user enters one.
  const blank = parseWebUrl(url) === undefined;
  const currentUrl = stateUrl ?? (blank ? "" : url);
  const hasPage = state !== undefined && state.url !== "";
  const showSurface = visible && hasPage && state.error === undefined;

  const covered = useSurfaceBounds(slotRef, surface, showSurface);
  const pageFrame = usePageFrame(surface, hasPage ? state.url : "", covered);

  const holdRef = useRef<SurfaceHold | undefined>(undefined);

  // The hold lasts as long as the panel shows this surface for this owner.
  // Navigation never ends it; only leaving does, and that is the one close.
  useEffect(() => {
    const hold: SurfaceHold = { opened: false, url: undefined, released: false };
    holdRef.current = hold;

    return () => {
      hold.released = true;
      holdRef.current = undefined;
      releaseSurface(surface);
    };
  }, [surface, workspacePath]);

  // The first open retains the view holder in main. Later runs ask for a page
  // only when the tab url moved away from what the page shows: an address the
  // user entered, a bookmark, a history entry. A url that arrived from the page
  // itself (a link, back, forward, a redirect) is already where it points.
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
      .open({ surface, url, owner })
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

  // Focus inside the panel decides where menu commands go, so a panel that hides gives it up.
  useEffect(() => {
    if (!visible) return;

    return () => browserBridge().setFocus({ surface, focused: false });
  }, [surface, visible]);

  // A key the focused page did not use is this panel's keydown: a browser shortcut, or an app one.
  useEffect(
    () =>
      onBrowserKey(surface, (key) => {
        sectionRef.current?.dispatchEvent(
          new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }),
        );
      }),
    [surface],
  );

  // Deferred a frame: the address bar's focus handler flushes a render, which an effect may not.
  useEffect(() => {
    if (!visible || !blank) return;
    const frame = requestAnimationFrame(() => addressRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, [visible, blank]);

  const navigate = (action: BrowserNavigationAction): void => {
    void browserBridge()
      .navigate({ surface, action })
      .catch(() => undefined);
  };

  /** Typing follows: main moves native focus off the page when it holds it. */
  const focusControls = (): void => browserBridge().setFocus({ surface, focused: true });

  /** Dismissing the address bar or find hands the keyboard back to the page. */
  const focusPage = (): void => {
    void browserBridge()
      .focusPage({ surface })
      .catch(() => undefined);
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
      default: {
        const _exhaustive: never = shortcut;

        return _exhaustive;
      }
    }
  };

  const go = (target: string): void => {
    setFailure(undefined);

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

        // A forwarded page key is dispatched on the panel itself, which never takes focus.
        const shortcut = resolveBrowserShortcut(
          event,
          macPlatform(undefined),
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
      <div {...props(workbenchStyles.toolbar, styles.toolbar)}>
        <Button
          iconOnly
          icon="arrow-left"
          aria-label="Go back"
          disabled={state?.canGoBack !== true}
          onClick={() => navigate("back")}
        />
        <Button
          iconOnly
          icon="arrow-right"
          aria-label="Go forward"
          disabled={state?.canGoForward !== true}
          onClick={() => navigate("forward")}
        />
        <Button
          iconOnly
          icon={loading ? "x" : "refresh"}
          aria-label={loading ? "Stop loading page" : "Reload page"}
          disabled={!hasPage}
          onClick={() => navigate(loading ? "stop" : "reload")}
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
          onDismiss={focusPage}
        >
          {secure === "https" && draft === undefined && (
            <span {...props(styles.addressIcon)} title="Secure connection">
              <Icon name="lock" size={12} />
            </span>
          )}
          {hasPage && draft === undefined && state.deniedPermissions.length > 0 && (
            <span
              {...props(styles.blockedIcon)}
              role="img"
              aria-label={blockedPermissionsLabel(state.deniedPermissions)}
              title={blockedPermissionsLabel(state.deniedPermissions)}
            >
              <Icon name="circle-x" size={12} />
            </span>
          )}
        </AddressField>
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
              void nyte.host.openExternal({ url: currentUrl }).catch(() => undefined);
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
            <Icon name="sparkle" size={12} />
          </span>
        )}
        {toolbarActions}
      </div>
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
      {finding && hasPage && <FindBar ref={findRef} surface={surface} onClose={focusPage} />}
      <DownloadsBar surface={surface} downloads={downloads} />
      {login !== undefined && (
        <LoginDialog key={login.host} surface={surface} host={login.host} realm={login.realm} />
      )}
      <div {...props(styles.body)}>
        <div ref={slotRef} {...props(styles.slot)}>
          {pageFrame !== undefined && (
            <img src={pageFrame} alt="" aria-hidden="true" {...props(styles.frozenFrame)} />
          )}
          {covered && pageFrame !== undefined && <div {...props(styles.frozenVeil)} />}
          {!hasPage && failure === undefined && (
            <div {...props(styles.message)}>
              <span {...props(styles.messageTitle)}>Nothing open</span>
            </div>
          )}
          {state?.error !== undefined && state.error.untrustedHost === undefined && (
            <div role="alert" {...props(styles.message)}>
              <span {...props(styles.messageTitle)}>This page did not load</span>
              <span {...props(styles.messageDetail)}>
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
              <span {...props(styles.messageDetail)}>
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
          <WorkbenchRail>
            <nav aria-label="Visit history" data-nyte-scrollport {...props(styles.history)}>
              <h2 {...props(styles.historyHeading)}>Visit History</h2>
              {history.length === 0 ? (
                <p {...props(styles.historyHeading)}>No pages visited yet</p>
              ) : (
                history.map((entry) => (
                  <Row
                    key={entry.url}
                    interactive
                    selected={entry.url === currentUrl}
                    xstyle={styles.historyEntry}
                  >
                    <Row.Primary
                      render={<a href={entry.url} />}
                      title={entry.url}
                      aria-current={entry.url === currentUrl ? "page" : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        setDraft(undefined);
                        setFailure(undefined);
                        onUrlChange(entry.url);
                      }}
                    >
                      <Row.Leading>
                        <Icon name="globe" size={13} />
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
          </WorkbenchRail>
        )}
      </div>
    </section>
  );
}
