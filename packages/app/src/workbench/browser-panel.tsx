import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
// oxlint-disable-next-line no-restricted-imports -- the native surface follows its surface, workspace, and url
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, FormEvent, ReactElement, ReactNode, RefObject } from "react";
import { flushSync } from "react-dom";
import type { BrowserBoundsMessage, BrowserBridge, BrowserNavigationAction } from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { overlayCovers, subscribeOverlayRects } from "../components/overlay-occlusion.ts";
import { Button } from "@nyte-ai/ui/button";
import { Row } from "@nyte-ai/ui/row";
import { workbench } from "../theme/schema.stylex";
import { workbenchStyles } from "./workbench.stylex.ts";
import { t } from "@nyte-ai/ui/vars.stylex";
import { nyte } from "../nyte";
import { keys } from "../queries.ts";
import { displayAddress, resolveBrowserAddress } from "./browser-address.ts";
import {
  applyBrowserEvent,
  claimBrowserSurface,
  clearBrowserHistory,
  dismissRefusedDownload,
  forgetBrowserSurface,
  useBrowserSurface,
} from "./browser-surfaces.ts";

import { toggleBookmark, toggleBookmarkBar, useBookmarks } from "./browser-bookmarks.ts";

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  bookmarks: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    minHeight: 32,
    paddingInline: 6,
    overflowX: "auto",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.borderSecondaryTranslucent,
  },
  bookmark: { display: "flex", alignItems: "center", flexShrink: 0, maxWidth: 220 },
  bookmarkButton: { flex: 1, minWidth: 0 },
  bookmarkLabel: {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  addressForm: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    marginInline: 4,
  },
  addressWrap: {
    flex: 1,
    gap: 6,
    height: 26,
    paddingInline: 8,
    borderColor: t.borderSecondaryTranslucent,
    borderRadius: t.radius8,
    // The ring belongs on the rounded field, not on the square input nested
    // inside it, so its corners stay concentric with the border it wraps.
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: 1,
    outlineColor: t.focusRing,
    outlineOffset: 0,
  },
  addressIcon: { display: "inline-flex", flexShrink: 0, color: t.contentSecondary },
  blocked: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    paddingInline: 4,
    color: t.contentSecondary,
    fontSize: t.fontCode,
    fontFamily: t.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  blockedOff: { color: t.contentDisabled },
  address: { height: "100%" },
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
  history: {
    width: workbench.fileListWidth,
    maxWidth: "45%",
    flexShrink: 0,
    minHeight: 0,
    overflowY: "auto",
    padding: 4,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.borderSecondaryTranslucent,
    backgroundColor: t.bgBase,
  },
  historyHeading: {
    margin: 0,
    paddingBlock: 6,
    paddingInline: 6,
    color: t.contentSecondary,
    fontSize: t.fontSm,
    fontWeight: 400,
    lineHeight: t.leadingSm,
  },
  historyEntry: {
    "--nyte-row-height": "32px",
    paddingBlock: 6,
    color: { default: t.contentSecondary, "[data-selected]": t.contentPrimary },
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  historyAddress: { fontSize: t.fontXs },
  message: {
    display: "flex",
    maxWidth: 360,
    flexDirection: "column",
    gap: 8,
    textAlign: "center",
  },
  messageTitle: { color: t.contentPrimary, fontSize: t.fontBase, fontWeight: 600 },
  messageDetail: { color: t.contentSecondary, fontSize: t.fontSm, lineHeight: t.leadingSm },
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    paddingBlock: 6,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.borderSecondaryTranslucent,
    backgroundColor: t.bgBase,
    color: t.contentSecondary,
    fontSize: t.fontSm,
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
    color: t.contentSecondary,
    fontSize: t.fontSm,
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
    backgroundColor: t.bgScrim,
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

interface BrowserPanelProps {
  readonly surface: string;
  readonly visible: boolean;
  readonly historyVisible: boolean;
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
  url,
  onUrlChange,
  toolbarActions,
  workspacePath,
}: BrowserPanelProps): ReactElement {
  const bookmarks = useBookmarks();
  const slotRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, refusedDownload, history } = useBrowserSurface(surface);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const stateUrl = state?.url;
  const currentUrl = stateUrl ?? url;
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

    if (hold === undefined) return;

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

    claimBrowserSurface(surface, workspacePath);
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

  const navigate = (action: BrowserNavigationAction): void => {
    void browserBridge()
      .navigate({ surface, action })
      .catch(() => undefined);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const target = resolveBrowserAddress(draft ?? "");

    if (target === undefined) return;
    setDraft(undefined);
    setFailure(undefined);
    inputRef.current?.blur();

    if (target === url) navigate("reload");
    else onUrlChange(target);
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
      })
      .then(async (action) => {
        if (action === undefined) return;

        if (action === "toggle-bookmarks") {
          toggleBookmarkBar();

          return;
        }

        await browserBridge().perform({ surface, action });

        if (action === "clear-history") clearBrowserHistory(workspacePath);
      })
      .catch((cause) => setFailure(errorMessage(cause)));
  };

  const loading = state?.loading === true;
  const secure = state?.secure ?? "none";
  const agentActive = (state?.agentHolders ?? 0) > 0;

  return (
    <section aria-label="Browser" {...stylex.props(styles.panel)}>
      <div {...stylex.props(workbenchStyles.toolbar)}>
        <Button
          iconOnly
          icon="arrow-left"
          aria-label="Back"
          disabled={state?.canGoBack !== true}
          onClick={() => navigate("back")}
        />
        <Button
          iconOnly
          icon="arrow-right"
          aria-label="Forward"
          disabled={state?.canGoForward !== true}
          onClick={() => navigate("forward")}
        />
        <Button
          iconOnly
          icon={loading ? "x" : "refresh"}
          aria-label={loading ? "Stop" : "Reload"}
          disabled={!hasPage}
          onClick={() => navigate(loading ? "stop" : "reload")}
        />
        <form {...stylex.props(styles.addressForm)} onSubmit={submit}>
          <InputGroup xstyle={styles.addressWrap}>
            {secure === "https" && draft === undefined && (
              <span {...stylex.props(styles.addressIcon)} title="Secure connection">
                <Icon name="lock" size={12} />
              </span>
            )}
            <Input
              ref={inputRef}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-label="Address"
              placeholder="Search or enter address"
              value={draft ?? displayAddress(currentUrl)}
              xstyle={styles.address}
              onFocus={(event) => {
                flushSync(() => setDraft(currentUrl));
                event.currentTarget.select();
              }}
              onBlur={() => setDraft(undefined)}
              onValueChange={setDraft}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraft(undefined);
                  event.currentTarget.blur();
                }
              }}
            />
          </InputGroup>
        </form>
        {hasPage && (
          <span
            {...stylex.props(styles.blocked, state.blocking || styles.blockedOff)}
            title={
              state.blocking
                ? `${String(state.blocked)} requests blocked on this page`
                : "Ad blocking is off in this build"
            }
          >
            <Icon name="shield" size={12} />
            {state.blocking ? String(state.blocked) : "off"}
          </span>
        )}
        <Button
          iconOnly
          icon="globe"
          aria-label="Open in system browser"
          disabled={!hasPage}
          onClick={() => void nyte.host.openExternal({ url: currentUrl }).catch(() => undefined)}
        />
        <Button
          iconOnly
          icon="more-horizontal"
          aria-label="Browser actions"
          onClick={openMenu}
          aria-haspopup="menu"
        />
        {agentActive && (
          <span
            {...stylex.props(styles.agentBadge)}
            title="An agent is driving this page"
            aria-label="Agent active"
          >
            <Icon name="sparkle" size={12} />
          </span>
        )}
        {toolbarActions}
      </div>
      {failure !== undefined && (
        <div role="alert" {...stylex.props(styles.notice)}>
          <span {...stylex.props(styles.noticeText)}>{failure}</span>
          <Button
            iconOnly
            icon="x"
            aria-label="Dismiss browser error"
            onClick={() => setFailure(undefined)}
          />
        </div>
      )}
      {bookmarks.visible && (
        <div aria-label="Bookmark bar" {...stylex.props(styles.bookmarks)}>
          <Button
            variant="secondary"
            disabled={!hasPage}
            onClick={() => toggleBookmark({ url: currentUrl, title: state?.title || currentUrl })}
          >
            {bookmarks.items.some((item) => item.url === currentUrl)
              ? "Remove bookmark"
              : "Bookmark this page"}
          </Button>
          {bookmarks.items.map((item) => (
            <div key={item.url} {...stylex.props(styles.bookmark)}>
              <Button
                variant="secondary"
                title={item.url}
                xstyle={styles.bookmarkButton}
                onClick={() => onUrlChange(item.url)}
              >
                <span {...stylex.props(styles.bookmarkLabel)}>
                  {item.title || displayAddress(item.url)}
                </span>
              </Button>
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
      {refusedDownload !== undefined && (
        <div role="status" {...stylex.props(styles.notice)}>
          <span {...stylex.props(styles.noticeText)}>
            Downloads do not run here: {refusedDownload}
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              void nyte.host.openExternal({ url: refusedDownload }).catch(() => undefined);
              dismissRefusedDownload(surface);
            }}
          >
            Open in system browser
          </Button>
          <Button
            iconOnly
            icon="x"
            aria-label="Dismiss"
            onClick={() => dismissRefusedDownload(surface)}
          />
        </div>
      )}
      <div {...stylex.props(styles.body)}>
        <div ref={slotRef} {...stylex.props(styles.slot)}>
          {pageFrame !== undefined && (
            <img src={pageFrame} alt="" aria-hidden="true" {...stylex.props(styles.frozenFrame)} />
          )}
          {covered && pageFrame !== undefined && <div {...stylex.props(styles.frozenVeil)} />}
          {!hasPage && failure === undefined && (
            <div {...stylex.props(styles.message)}>
              <span {...stylex.props(styles.messageTitle)}>Nothing open</span>
            </div>
          )}
          {state?.error !== undefined && (
            <div role="alert" {...stylex.props(styles.message)}>
              <span {...stylex.props(styles.messageTitle)}>This page did not load</span>
              <span {...stylex.props(styles.messageDetail)}>
                {state.error.description} ({String(state.error.code)})
              </span>
              <Button variant="secondary" onClick={() => navigate("reload")}>
                Try again
              </Button>
            </div>
          )}
        </div>
        {historyVisible && (
          <nav aria-label="Visit history" data-nyte-scrollport {...stylex.props(styles.history)}>
            <h2 {...stylex.props(styles.historyHeading)}>Visit History</h2>
            {history.length === 0 ? (
              <p {...stylex.props(styles.historyHeading)}>No pages visited yet</p>
            ) : (
              history.map((entry) => (
                <Row
                  key={entry.url}
                  interactive
                  selected={entry.url === currentUrl}
                  xstyle={styles.historyEntry}
                >
                  <Row.Primary
                    title={entry.url}
                    aria-current={entry.url === currentUrl ? "page" : undefined}
                    onClick={() => {
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
                </Row>
              ))
            )}
          </nav>
        )}
      </div>
    </section>
  );
}
