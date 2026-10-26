import { create, props } from "@stylexjs/stylex";
import { DialRoot } from "dialkit";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { shell, sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Kbd } from "@nyte-ai/ui/kbd";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { DISPLAY_MODES, useDisplayMode, type DisplayMode } from "../shell/display-mode";
import { PeekCard, SPLIT_GAP, paneRect, rectStyle } from "./card";
import type { Landing, Opened, Size } from "./card";
import { usePeekDials, type Trigger } from "./motion";
import { CHAT_HOST, SITES, SitePage, type Site } from "./site";

const REDUCE_MOTION = "(prefers-reduced-motion: reduce)";

const CHATS = [
  "Port Arc's Peek",
  "Sidebar float timing",
  "Corner radius audit",
  "Occlusion over guests",
];

interface Landed {
  readonly site: Site;
  readonly link: HTMLElement;
  readonly landing: Landing;
}

export function PeekPage(): ReactElement {
  const [scheme, setScheme] = useState<DisplayMode>("light");
  const [size, setSize] = useState<Size>();
  const [opened, setOpened] = useState<Opened>();
  const [landed, setLanded] = useState<Landed>();
  const [undo, setUndo] = useState<Opened>();
  const [status, setStatus] = useState("");
  const host = useRef<HTMLDivElement | null>(null);
  const landedPage = useRef<HTMLDivElement | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const dials = usePeekDials();

  const reduce =
    useSyncExternalStore(watchReducedMotion, prefersReducedMotion, () => false) ||
    dials.reduceMotion;

  const split = landed?.landing === "split" || opened?.landing === "split";
  const receded = opened !== undefined && opened.landing !== "split";

  useDisplayMode(scheme);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- the card's geometry follows the page area's size
  useEffect(() => {
    const element = host.current;

    if (element === null) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);

      if (entry === undefined) return;
      setSize({
        width: element.offsetWidth,
        height: element.offsetHeight,
        pageWidth: entry.contentRect.width,
        pageHeight: entry.contentRect.height,
      });
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const open = (site: Site, link: HTMLElement): void => {
    const area = host.current?.getBoundingClientRect();

    if (area === undefined) return;
    const source = link.getBoundingClientRect();

    window.clearTimeout(undoTimer.current);
    setUndo(undefined);
    setStatus("");
    setOpened({
      id: performance.now(),
      site,
      link,
      source: {
        left: source.left - area.left,
        top: source.top - area.top,
        width: source.width,
        height: source.height,
      },
    });
  };

  // oxlint-disable-next-line nyte-code/no-direct-effect -- ⌘Z reopens the last Peek wherever focus is on the page
  useEffect(() => {
    if (undo === undefined) return;

    const onKey = (event: WindowEventMap["keydown"]): void => {
      const editing =
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]") !== null;

      if (editing || event.key !== "z" || event.shiftKey || !(event.metaKey || event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      open(undo.site, undo.link);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  });

  const follow = (event: MouseEvent<HTMLAnchorElement>, site: Site): void => {
    event.preventDefault();
    const address = `${site.host}${site.path}`;

    if (peeks(dials.trigger, event.shiftKey, site)) {
      open(site, event.currentTarget);

      return;
    }

    if (dials.trigger === "other-sites") {
      setStatus(`${address} is on this tab's own site, so it would open in place.`);

      return;
    }

    setStatus(`${address} would open in a Browser tab.`);
  };

  const close = (message: string): void => {
    if (opened === undefined) return;
    const last = opened;

    flushSync(() => {
      setOpened(undefined);
      setStatus(message);
      setUndo(last);
    });
    last.link.focus();
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(undefined), dials.undoSeconds * 1000);
  };

  const land = (peek: Opened, landing: Landing): void => {
    flushSync(() => {
      setOpened(undefined);
      setLanded({ site: peek.site, link: peek.link, landing });
      setStatus(
        landing === "tab"
          ? `Opened ${peek.site.host} as a Browser tab.`
          : `Opened ${peek.site.host} beside the chat.`,
      );
    });
    landedPage.current?.focus();
  };

  const promote = (landing: Landing): void => {
    if (opened === undefined) return;

    if (reduce) {
      land(opened, landing);

      return;
    }

    setOpened({ ...opened, landing });
  };

  const leave = (): void => {
    if (landed === undefined) return;
    const link = landed.link;

    flushSync(() => {
      setLanded(undefined);
      setStatus("");
    });
    link.focus();
  };

  return (
    <main {...props(styles.page)}>
      <div {...props(styles.column)}>
        <header {...props(styles.header)}>
          <h1 {...props(styles.title)}>Peek</h1>
          <p {...props(styles.lede)}>
            Click a link in the chat. The page opens in a card over the chat instead of a tab, so
            you can read it and get back without losing your place. Drag the card&apos;s top strip
            or scroll past the top of its page to put it away. Arc 1.170&apos;s geometry, corners
            and springs are read from its binary; tune them, and this board&apos;s guesses, in the
            dial panel.
          </p>
        </header>

        <div {...props(styles.toolbar)}>
          <label {...props(styles.choice)}>
            <span {...props(styles.choiceLabel)}>Appearance</span>
            <ToggleGroup
              aria-label="Appearance"
              value={[scheme]}
              onValueChange={(values) => {
                const next = DISPLAY_MODES.find((mode) => mode.value === values.at(-1));

                if (next !== undefined) setScheme(next.value);
              }}
            >
              {DISPLAY_MODES.map((mode) => (
                <Toggle key={mode.value} value={mode.value} size="sm">
                  {mode.label}
                </Toggle>
              ))}
            </ToggleGroup>
          </label>
          <span role="status" {...props(styles.status)}>
            {status}
          </span>
          {undo !== undefined && (
            <Button
              size="sm"
              variant="outline"
              aria-keyshortcuts="Meta+Z"
              onClick={() => open(undo.site, undo.link)}
            >
              Reopen Peek <Kbd keys={["⌘", "Z"]} plain />
            </Button>
          )}
          {reduce && <span {...props(styles.choiceLabel)}>Reduce motion is on.</span>}
        </div>

        <div {...props(styles.window)}>
          <div {...props(styles.titlebar)}>
            <span aria-hidden="true" {...props(styles.lights)}>
              <span {...props(styles.lamp)} />
              <span {...props(styles.lamp)} />
              <span {...props(styles.lamp)} />
            </span>
            <span {...props(styles.windowTitle)}>Port Arc&apos;s Peek</span>
          </div>
          <div {...props(styles.body)}>
            <nav aria-label="Chats" {...props(styles.rail)}>
              {CHATS.map((chat, index) => (
                <span key={chat} {...props(styles.railRow, index === 0 && styles.railRowActive)}>
                  {chat}
                </span>
              ))}
            </nav>
            <div ref={host} {...props(styles.host)}>
              <motion.article
                hidden={landed?.landing === "tab"}
                inert={opened === undefined ? undefined : true}
                {...props(styles.card)}
                animate={{
                  scaleX:
                    receded && !reduce && size !== undefined ? 1 - dials.recede / size.width : 1,
                  scaleY:
                    receded && !reduce && size !== undefined ? 1 - dials.recede / size.height : 1,
                  opacity: receded ? dials.pageOpacity : 1,
                  marginInlineEnd:
                    split && size !== undefined ? (size.pageWidth + SPLIT_GAP) / 2 : 0,
                }}
                transition={
                  reduce
                    ? { ...dials.fade, marginInlineEnd: { duration: 0 } }
                    : opened?.landing === "split"
                      ? dials.promote
                      : opened === undefined
                        ? dials.close
                        : dials.open
                }
              >
                <div {...props(styles.cardBody)}>
                  <div {...props(styles.you)}>
                    Find the docs for corner-shape, WebContentsView and motion transitions, and our
                    own notes on the browser.
                  </div>
                  <p {...props(styles.reply)}>
                    MDN covers{" "}
                    <Anchor site={SITES.corners} onFollow={follow}>
                      corner-shape
                    </Anchor>
                    , Electron documents{" "}
                    <Anchor site={SITES.webContentsView} onFollow={follow}>
                      WebContentsView
                    </Anchor>
                    , and Motion has a page on{" "}
                    <Anchor site={SITES.transitions} onFollow={follow}>
                      transitions
                    </Anchor>
                    .
                  </p>
                  <p {...props(styles.reply)}>
                    On nyte.sh, see{" "}
                    <Anchor site={SITES.browser} onFollow={follow}>
                      Browser panel
                    </Anchor>{" "}
                    and{" "}
                    <Anchor site={SITES.workbench} onFollow={follow}>
                      Workbench
                    </Anchor>
                    .
                  </p>
                  <p {...props(styles.hint)}>{HINTS[dials.trigger]}</p>
                </div>
              </motion.article>

              <AnimatePresence>
                {landed !== undefined && size !== undefined && (
                  <motion.div
                    key={landed.landing}
                    {...props(styles.pane)}
                    style={rectStyle(paneRect(size, landed.landing))}
                    initial={reduce ? { opacity: 0 } : false}
                    animate={{ opacity: 1, transition: dials.fade }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  >
                    <SitePage
                      site={landed.site}
                      dark={scheme === "dark"}
                      scroller={landedPage}
                      action={
                        <Button size="sm" variant="ghost" onClick={leave}>
                          {landed.landing === "tab" ? "Back to Chat" : "Close Split View"}
                        </Button>
                      }
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {opened !== undefined && opened.landing === undefined && (
                <div
                  aria-hidden="true"
                  {...props(styles.scrim)}
                  onClick={() => close("Closed by clicking outside.")}
                />
              )}
              <AnimatePresence>
                {opened !== undefined && size !== undefined && (
                  <PeekCard
                    key={`${opened.site.host}${opened.site.path}`}
                    opened={opened}
                    size={size}
                    dials={dials}
                    reduce={reduce}
                    dark={scheme === "dark"}
                    onClose={close}
                    onPromote={promote}
                    onLanded={(landing) => land(opened, landing)}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <section {...props(styles.notes)}>
          <h2 {...props(styles.notesTitle)}>Design notes</h2>
          <ul {...props(styles.list)}>
            <Note
              title="The card"
              arc="80% of the host's width, centred, 12pt from its top and bottom. Corners 8pt and circular; the page is clipped to the same 8pt with no inset, so there is no frame and no header. Shadow 8pt down, CoreAnimation radius 16, 47.5% black. Fill Gray1: sRGB 0.99 in light, 0.085 in dark."
              here="The shadow's radius is drawn as 32px of CSS blur. The host is the page area right of the sidebar, inset included. The mock page's address strip stands in for the site's own header; it is also the drag handle."
            />
            <Note
              title="Full-bleed"
              arc="Full host width, 10pt corners, shadow 2pt down with radius 10, on 0.18s springs (damping 0.885 open, 0.9 close). When Arc picks it over the popover wasn't recovered."
              here="A dial. It keeps the popover's 12pt top and bottom and its 47.5% shadow opacity, and with no room beside it the controls sit over the card's top-right corner. All three are guesses."
            />
            <Note
              title="The page behind"
              arc="An overlay that takes clicks goes over it, and the page springs to a scale of 1 − 18/W by 1 − 18/H, centred, and fades. Arc stores 0.3, 0.7 and 0.6 for this; which one Peek uses wasn't recovered. No black dim: that was the old modal."
              here="Opacity starts at 0.7, on the card's spring. The overlay is pointer-only, so the Close Peek control is the only control with that name."
            />
            <Note
              title="Motion"
              arc="The card grows from the link's rect using a snapshot on a 0.245s spring at damping 0.865 and shrinks back on 0.225s at 0.895. Stiffness is (2π/response)², damping 4πζ/response. An interruption starts from the on-screen values. Reduce Motion swaps movement for a 0.3s ease-out crossfade."
              here="The live mock page is scaled instead of a snapshot. Reduce motion follows the system setting as it changes, or the dial. The page behind uses the card's spring."
            />
            <Note
              title="Gestures"
              arc="Dismissal needs 75pt of travel with a qualifying velocity and direction, or 152pt without. Scroll-driven dismissal exists. A 0.06 is stored nearby with no known role."
              here="Down only by default (the dial adds up, or any direction). Travel is the raw pointer or scroll distance; 400pt/s qualifies as a fling. The card trails by an iOS-style rubber band (0.55) and springs back on the open spring. Scrolling past the top pulls it down; a pull ends 150ms after the last wheel event, and a dismissed card shrinks into the link."
            />
            <Note
              title="Controls"
              arc="A column beside the card: Arc reserves 146pt on each side and hosts two controls in 120 × 90 or three in 120 × 135, so rows are 45pt. A flag swaps their order. ⌘O (openInCurrentSpace) opens it in the current space; Esc (exit:) closes."
              here="The 120pt column is centred in the right reservation, pulled inside the window when it would overflow. The alternate order is a guess: reversed."
            />
            <Note
              title="Open as Tab and Split View"
              arc="Both actions exist. Split panes have 6pt continuous corners and a 4pt gap. The promotion's animation wasn't recovered."
              here="The card grows into the page card, or the right pane, on the full-bleed open spring, its corner easing to 6pt, and then the page takes its place. The chat slides into the left pane for split view."
            />
            <Note
              title="Triggers"
              arc="Two preferences: Peek links to other sites (pinned and favourite tabs only), and Peek links clicked with Shift held. In a favourite, a plain click peeks."
              here="A plain click by default, as in an Arc favourite. The dial also offers Shift-click, other sites only, and off."
            />
            <Note
              title="Undo"
              arc="An undo prompt reopens a closed Peek. Its lifetime wasn't recovered."
              here="Five seconds by default, from the status line or ⌘Z, with the same open motion."
            />
            <Note
              title="Porting to the app"
              arc="Arc grows a snapshot of the page and hosts the live content in the card at rest."
              here="In Nyte the page is a native WebContentsView painted above the DOM, so CSS can't scale it. Grow a capturePage snapshot from the link, then place the live view in the card's rect at rest and hide it again for the close. The receding chat is DOM, so it animates as here."
            />
          </ul>
        </section>
      </div>
      <DialRoot position="bottom-right" defaultOpen={false} />
    </main>
  );
}

const HINTS = {
  click: "Click a link to peek it.",
  shift: "Shift-click a link to peek it.",
  "other-sites": "Click a link to another site to peek it. nyte.sh links open in place.",
  off: "Peek is off. Links open in Browser tabs.",
} as const satisfies Record<Trigger, string>;

function peeks(trigger: Trigger, shift: boolean, site: Site): boolean {
  if (trigger === "click") return true;

  if (trigger === "shift") return shift;

  return trigger === "other-sites" && site.host !== CHAT_HOST;
}

function watchReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCE_MOTION);

  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCE_MOTION).matches;
}

function Anchor({
  site,
  onFollow,
  children,
}: {
  readonly site: Site;
  readonly onFollow: (event: MouseEvent<HTMLAnchorElement>, site: Site) => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <a
      href={`https://${site.host}${site.path}`}
      {...props(styles.link)}
      onClick={(event) => onFollow(event, site)}
    >
      {children}
    </a>
  );
}

function Note({
  title,
  arc,
  here,
}: {
  readonly title: string;
  readonly arc: string;
  readonly here: string;
}): ReactElement {
  return (
    <li {...props(styles.note)}>
      <span {...props(styles.noteTitle)}>{title}</span>
      <span>
        <span {...props(styles.noteSource)}>Arc: </span>
        {arc}
      </span>
      <span>
        <span {...props(styles.noteSource)}>Here: </span>
        {here}
      </span>
    </li>
  );
}

const styles = create({
  page: {
    height: "100%",
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1440,
    marginInline: "auto",
    padding: "48px 32px 96px",
  },
  header: { display: "flex", flexDirection: "column", gap: 4, maxWidth: 760 },
  title: { margin: 0, fontSize: type.font2xl, fontWeight: 600, letterSpacing: type.letterLg },
  lede: { margin: 0, color: role.contentSecondary, fontSize: type.fontBase },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 },
  choice: { display: "inline-flex", alignItems: "center", gap: 8 },
  choiceLabel: { color: role.contentTertiary, fontSize: type.fontSm, whiteSpace: "nowrap" },
  status: { color: role.contentSecondary, fontSize: type.fontSm },
  window: {
    display: "flex",
    flexDirection: "column",
    height: 680,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: role.sidebarMaterial,
    color: role.contentPrimary,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  titlebar: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    height: shell.titlebarHeight,
    paddingInlineStart: 84,
  },
  lights: {
    position: "absolute",
    insetInlineStart: 12,
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    gap: 8,
  },
  lamp: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: role.bgHover,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  windowTitle: { color: role.contentSecondary, fontSize: type.fontSm, lineHeight: type.leadingSm },
  body: { display: "flex", flex: 1, minHeight: 0 },
  rail: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flexShrink: 0,
    width: sidebar.width,
    paddingInline: 8,
  },
  railRow: {
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: radius.control,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  railRowActive: { backgroundColor: role.bgHover, color: role.contentPrimary },
  host: {
    position: "relative",
    display: "flex",
    flex: 1,
    minWidth: 0,
    paddingInlineEnd: shell.cardInset,
    paddingBlockEnd: shell.cardInset,
  },
  card: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    borderRadius: shell.cardRadius,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  cardBody: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
    maxWidth: 640,
    marginInline: "auto",
    padding: 32,
  },
  you: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  reply: { margin: 0, fontSize: type.fontBase, lineHeight: type.leadingBase },
  hint: { margin: 0, color: role.contentTertiary, fontSize: type.fontSm },
  link: {
    color: role.contentInteractivePrimary,
    textDecoration: "underline",
    textUnderlineOffset: 2,
    cursor: "pointer",
  },
  scrim: { position: "absolute", inset: 0, zIndex: 1 },
  pane: {
    position: "absolute",
    borderRadius: shell.cardRadius,
    overflow: "clip",
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  notes: { display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 },
  notesTitle: { margin: 0, marginTop: 8, fontSize: type.fontBase, fontWeight: 600 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    margin: 0,
    padding: 0,
    listStyle: "none",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  note: { display: "flex", flexDirection: "column", gap: space.s1 },
  noteTitle: { color: role.contentPrimary, fontWeight: type.weightSemibold },
  noteSource: { color: role.contentPrimary, fontWeight: type.weightMedium },
});
