import { create, props } from "@stylexjs/stylex";
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

export interface Site {
  readonly host: string;
  readonly path: string;
  readonly title: string;
  readonly lede: string;
}

/** The board treats the chat as a pinned tab on this site, so links to it are "same site". */
export const CHAT_HOST = "nyte.sh";

export const SITES = {
  corners: {
    host: "developer.mozilla.org",
    path: "/docs/Web/CSS/corner-shape",
    title: "corner-shape",
    lede: "The corner-shape property sets the shape of a box's corners inside the area its border-radius defines.",
  },
  webContentsView: {
    host: "electronjs.org",
    path: "/docs/latest/api/web-contents-view",
    title: "WebContentsView",
    lede: "A View that displays a WebContents. Its bounds are set by the main process, above the window's own page.",
  },
  transitions: {
    host: "motion.dev",
    path: "/docs/react-transitions",
    title: "Transitions",
    lede: "A transition defines how a value animates between two states: a tween, a spring, or an inertia.",
  },
  browser: {
    host: CHAT_HOST,
    path: "/docs/browser",
    title: "Browser panel",
    lede: "The Browser panel shows a live page beside the chat, in the same window, with its own tabs.",
  },
  workbench: {
    host: CHAT_HOST,
    path: "/docs/workbench",
    title: "Workbench",
    lede: "The workbench holds the panels a chat opens: files, diffs, terminals and pages.",
  },
} as const satisfies Readonly<Record<string, Site>>;

const SECTIONS = [
  {
    title: "In the app",
    text: "This stands in for the live page. In the app it would be the Browser's own view, moved into the card's rect once the card has grown.",
  },
  {
    title: "Closing it",
    text: "Esc, a click outside the card or the Close control put it away. Drag the strip at the top, or keep scrolling up once you are back at the top of the page, to pull it away.",
  },
  {
    title: "Keeping it",
    text: "Open as Tab (⌘O) grows the card into the page and keeps it there. Open in Split View puts it beside the chat.",
  },
  {
    title: "Getting it back",
    text: "After a close, the status line offers to reopen it for a few seconds, and ⌘Z does the same.",
  },
  {
    title: "Length",
    text: "The figures give the page enough height to scroll in any window, so the scroll gesture has somewhere to start from.",
  },
];

export function SitePage({
  site,
  dark,
  scroller,
  handle,
  action,
}: {
  readonly site: Site;
  readonly dark: boolean;
  readonly scroller?: Ref<HTMLDivElement>;
  readonly handle?: HTMLAttributes<HTMLDivElement>;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <div
      ref={scroller}
      role="region"
      aria-label={site.title}
      tabIndex={0}
      {...props(styles.site, dark ? styles.gray1Dark : styles.gray1Light, focus.ringInset)}
    >
      <div {...handle} {...props(styles.nav, handle !== undefined && styles.grab)}>
        <Icon name="globe" size={14} />
        <span {...props(styles.address)}>
          {site.host}
          {site.path}
        </span>
        {action}
      </div>
      <div {...props(styles.body)}>
        <h2 {...props(styles.title)}>{site.title}</h2>
        <p {...props(styles.text)}>{site.lede}</p>
        {SECTIONS.map((section) => (
          <section key={section.title} {...props(styles.section)}>
            <div aria-hidden="true" {...props(styles.figure)} />
            <h3 {...props(styles.heading)}>{section.title}</h3>
            <p {...props(styles.text)}>{section.text}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

const styles = create({
  site: {
    height: "100%",
    overflowY: "auto",
    overscrollBehavior: "contain",
    color: role.contentPrimary,
  },
  // Arc's Gray1 asset, the Peek card's fill.
  gray1Light: { backgroundColor: "color(srgb 0.99 0.99 0.99)" },
  gray1Dark: { backgroundColor: "color(srgb 0.085 0.085 0.085)" },
  nav: {
    position: "sticky",
    top: 0,
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: 40,
    paddingBlock: space.s1,
    paddingInline: space.s6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: "inherit",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  grab: {
    cursor: { default: "grab", ":active": "grabbing" },
    touchAction: "none",
    userSelect: "none",
  },
  address: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    width: "100%",
    maxWidth: 680,
    marginInline: "auto",
    paddingBlock: 40,
    paddingInline: space.s8,
  },
  title: {
    margin: 0,
    fontSize: type.font2xl,
    fontWeight: type.weightSemibold,
    letterSpacing: type.letterLg,
  },
  section: { display: "flex", flexDirection: "column", gap: space.s2, marginBlockStart: space.s4 },
  heading: {
    margin: 0,
    fontSize: type.fontLg,
    fontWeight: type.weightSemibold,
    lineHeight: type.leadingLg,
  },
  text: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  figure: { height: 180, borderRadius: radius.card, backgroundColor: role.bgMuted },
});
