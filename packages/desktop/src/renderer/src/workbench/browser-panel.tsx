import * as stylex from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, FormEvent, ReactElement, ReactNode, RefObject } from "react";
import { flushSync } from "react-dom";
import type { BrowserBoundsMessage, BrowserNavigationAction } from "../../../shared/ipc.ts";
import { errorMessage } from "../../../shared/errors.ts";
import { Icon } from "../components/icons";
import { overlayCovers, subscribeOverlayRects } from "../components/overlay-occlusion.ts";
import { focus, IconButton } from "../components/ui";
import { workbench } from "../theme/schema.stylex";
import { t } from "../theme/vars.stylex";
import { nyte } from "../nyte";
import { keys } from "../queries.ts";
import { displayAddress, resolveBrowserAddress } from "./browser-address.ts";
import {
  applyBrowserEvent,
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
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: workbench.headerHeight,
    flexShrink: 0,
    paddingInline: 6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.strokeTertiary,
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
    borderBottomColor: t.strokeTertiary,
  },
  bookmark: { display: "flex", alignItems: "center", flexShrink: 0, maxWidth: 220 },
  bookmarkLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  addressForm: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    marginInline: 4,
  },
  addressWrap: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 6,
    height: 26,
    paddingInline: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    borderRadius: t.radiusLg,
    backgroundColor: t.bgElevated,
    // The ring belongs on the rounded field, not on the square input nested
    // inside it, so its corners stay concentric with the border it wraps.
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: 2,
    outlineColor: t.focusRing,
    outlineOffset: 1,
  },
  addressIcon: { display: "inline-flex", flexShrink: 0, color: t.iconSecondary },
  blocked: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    paddingInline: 4,
    color: t.textTertiary,
    fontSize: t.fontCode,
    fontFamily: t.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  blockedOff: { opacity: 0.5 },
  address: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: t.textPrimary,
    fontSize: t.fontSm,
  },
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
    borderInlineStartColor: t.strokeTertiary,
    backgroundColor: t.bgSubtle,
  },
  historyHeading: {
    margin: 0,
    paddingBlock: 6,
    paddingInline: 6,
    color: t.textTertiary,
    fontSize: t.fontSm,
    fontWeight: 400,
    lineHeight: t.leadingSm,
  },
  historyEntry: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    minWidth: 0,
    minHeight: 32,
    padding: 6,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
    },
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textAlign: "start",
    cursor: "pointer",
  },
  historyCurrent: { backgroundColor: t.fillGhostSelected, color: t.textPrimary },
  historyText: { display: "flex", flex: 1, minWidth: 0, flexDirection: "column" },
  historyTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  historyAddress: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: t.textTertiary,
    fontSize: t.fontXs,
  },
  message: {
    display: "flex",
    maxWidth: 360,
    flexDirection: "column",
    gap: 8,
    textAlign: "center",
  },
  messageTitle: { color: t.textPrimary, fontSize: t.fontBase, fontWeight: 600 },
  messageDetail: { color: t.textTertiary, fontSize: t.fontSm, lineHeight: t.leadingSm },
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    paddingBlock: 6,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.strokeTertiary,
    backgroundColor: t.bgSubtle,
    color: t.textSecondary,
    fontSize: t.fontSm,
  },
  noticeText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  action: {
    minHeight: 26,
    paddingInline: 10,
    borderStyle: "none",
    borderRadius: t.radiusLg,
    backgroundColor: { default: t.fillSecondary, ":hover": t.fillGhostHover },
    color: t.textPrimary,
    fontSize: t.fontSm,
    cursor: "pointer",
  },
  agentBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    paddingInline: 6,
    color: t.textTertiary,
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
    backgroundColor: t.bgBase,
    opacity: 0.15,
    pointerEvents: "none",
  },
});

/** Release this surface's view holder in main. */
function releaseSurface(surface: string): void {
  forgetBrowserSurface(surface);
  void nyte.host.browser.close({ surface }).catch(() => undefined);
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
      nyte.host.browser.setBounds(message);
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
        nyte.host.browser.setBounds(lastRef.current);
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
    queryFn: () => nyte.host.browser.captureFrame({ surface }),
    enabled: covered && url !== "",
    // A page re-covered later needs a fresh capture.
    staleTime: 0,
  });
  return frame.data;
}

interface BrowserPanelProps {
  readonly surface: string;
  readonly visible: boolean;
  readonly historyVisible: boolean;
  readonly url: string | undefined;
  readonly onUrlChange: (url: string | undefined) => void;
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
  const currentUrl = state?.url ?? url ?? "";
  const hasPage = state !== undefined && state.url !== "";
  const showSurface = visible && hasPage && state.error === undefined;

  const covered = useSurfaceBounds(slotRef, surface, showSurface);
  const pageFrame = usePageFrame(surface, hasPage ? state.url : "", covered);

  useEffect(() => {
    if (url !== undefined) {
      const owner =
        workspacePath === null
          ? ({ kind: "home" } as const)
          : ({ kind: "project", path: workspacePath } as const);
      // open() in main retains the view holder for this surface.
      void nyte.host.browser.open({ surface, url, owner }).then(
        (openState) => applyBrowserEvent({ kind: "browser_changed", surface, state: openState }),
        (cause: unknown) => {
          setFailure(errorMessage(cause));
        },
      );
    }
    // Release the view holder when the panel unmounts or the surface changes.
    return () => releaseSurface(surface);
  }, [surface, url, workspacePath]);

  const navigate = (action: BrowserNavigationAction): void => {
    void nyte.host.browser.navigate({ surface, action }).catch(() => undefined);
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
    void nyte.host.browser
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
        await nyte.host.browser.perform({ surface, action });
        if (action === "clear-history") clearBrowserHistory();
      })
      .catch((cause) => setFailure(errorMessage(cause)));
  };

  const loading = state?.loading === true;
  const secure = state?.secure ?? "none";
  const agentActive = (state?.agentHolders ?? 0) > 0;

  return (
    <section aria-label="Browser" {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.toolbar)}>
        <IconButton
          icon="arrow-left"
          label="Back"
          disabled={state?.canGoBack !== true}
          onClick={() => navigate("back")}
        />
        <IconButton
          icon="arrow-right"
          label="Forward"
          disabled={state?.canGoForward !== true}
          onClick={() => navigate("forward")}
        />
        <IconButton
          icon={loading ? "x" : "refresh"}
          label={loading ? "Stop" : "Reload"}
          disabled={!hasPage}
          onClick={() => navigate(loading ? "stop" : "reload")}
        />
        <form {...stylex.props(styles.addressForm)} onSubmit={submit}>
          <div {...stylex.props(styles.addressWrap)}>
            {secure === "https" && draft === undefined && (
              <span {...stylex.props(styles.addressIcon)} title="Secure connection">
                <Icon name="lock" size={12} />
              </span>
            )}
            <input
              ref={inputRef}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-label="Address"
              placeholder="Search or enter address"
              value={draft ?? displayAddress(currentUrl)}
              {...stylex.props(styles.address)}
              onFocus={(event) => {
                flushSync(() => setDraft(currentUrl));
                event.currentTarget.select();
              }}
              onBlur={() => setDraft(undefined)}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraft(undefined);
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
        </form>
        {hasPage && (
          <span
            {...stylex.props(styles.blocked, state.blocking || styles.blockedOff)}
            title={
              state.blocking
                ? `${String(state.blocked)} requests blocked on this page`
                : "No filter lists in this build; run pnpm adblock"
            }
          >
            <Icon name="shield" size={12} />
            {state.blocking ? String(state.blocked) : "off"}
          </span>
        )}
        <IconButton
          icon="globe"
          label="Open in system browser"
          disabled={!hasPage}
          onClick={() => void nyte.host.openExternal({ url: currentUrl }).catch(() => undefined)}
        />
        <IconButton icon="more" label="Browser actions" onClick={openMenu} aria-haspopup="menu" />
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
          <IconButton
            icon="x"
            label="Dismiss browser error"
            onClick={() => setFailure(undefined)}
          />
        </div>
      )}
      {bookmarks.visible && (
        <div aria-label="Bookmark bar" {...stylex.props(styles.bookmarks)}>
          <button
            type="button"
            {...stylex.props(styles.action, focus.ring)}
            disabled={!hasPage}
            onClick={() => toggleBookmark({ url: currentUrl, title: state?.title || currentUrl })}
          >
            {bookmarks.items.some((item) => item.url === currentUrl)
              ? "Remove bookmark"
              : "Bookmark this page"}
          </button>
          {bookmarks.items.map((item) => (
            <div key={item.url} {...stylex.props(styles.bookmark)}>
              <button
                type="button"
                title={item.url}
                {...stylex.props(styles.action, styles.bookmarkLabel, focus.ring)}
                onClick={() => onUrlChange(item.url)}
              >
                {item.title || displayAddress(item.url)}
              </button>
              <IconButton
                icon="x"
                label={`Remove bookmark: ${item.title || item.url}`}
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
          <button
            type="button"
            {...stylex.props(styles.action, focus.ring)}
            onClick={() => {
              void nyte.host.openExternal({ url: refusedDownload }).catch(() => undefined);
              dismissRefusedDownload(surface);
            }}
          >
            Open in system browser
          </button>
          <IconButton icon="x" label="Dismiss" onClick={() => dismissRefusedDownload(surface)} />
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
              <span {...stylex.props(styles.messageDetail)}>
                Enter an address or search above. Pages cannot ask for permissions, open popups, or
                download files here.
              </span>
            </div>
          )}
          {state?.error !== undefined && (
            <div role="alert" {...stylex.props(styles.message)}>
              <span {...stylex.props(styles.messageTitle)}>This page did not load</span>
              <span {...stylex.props(styles.messageDetail)}>
                {state.error.description} ({String(state.error.code)})
              </span>
              <button
                type="button"
                {...stylex.props(styles.action, focus.ring)}
                onClick={() => navigate("reload")}
              >
                Try again
              </button>
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
                <Button
                  unstyled
                  key={entry.url}
                  type="button"
                  title={entry.url}
                  aria-current={entry.url === currentUrl ? "page" : undefined}
                  {...stylex.props(
                    styles.historyEntry,
                    focus.ringInset,
                    entry.url === currentUrl && styles.historyCurrent,
                  )}
                  onClick={() => {
                    setDraft(undefined);
                    setFailure(undefined);
                    onUrlChange(entry.url);
                  }}
                >
                  <span {...stylex.props(styles.addressIcon)}>
                    <Icon name="globe" size={13} />
                  </span>
                  <span {...stylex.props(styles.historyText)}>
                    <span {...stylex.props(styles.historyTitle)}>
                      {entry.title || displayAddress(entry.url)}
                    </span>
                    <span {...stylex.props(styles.historyAddress)}>
                      {displayAddress(entry.url)}
                    </span>
                  </span>
                </Button>
              ))
            )}
          </nav>
        )}
      </div>
    </section>
  );
}
