/**
 * The review demo in the desktop app's shell, as `docs/tabs.md` lays it out.
 * The chrome runs behind everything:
 * - a titlebar with the sidebar toggle, back and forward, the tab strip, and
 *   at its end "⋯" and the workbench toggle;
 * - the app's sidebar: New Chat, Review, and the chats Nyte is working in.
 * The main area is a card set into the chrome. It holds one pane or a split of
 * two, each showing a place: a new chat, the Review page, a pull request's
 * chat, or its review. The pull requests are faked; see `pull-request.ts`.
 * The workbench beside it shows the focused review's diff.
 *
 * Everything inside the places is real: core sessions, git, Nyte's worktrees.
 * The shell keeps its window in a reducer and its toggles in state; nothing
 * here needs an effect.
 */
import { create, props } from "@stylexjs/stylex";
import { useReducer, useState, type MouseEvent, type ReactElement } from "react";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { FileTypeIconSprite } from "@nyte-ai/app/components/file-type-icon.tsx";
import { shell, sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { button, glyph, radius } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Toggle } from "@nyte-ai/ui/toggle";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { useLiveReview, useReviews } from "./api";
import { ChatPlace, targetOf } from "./chat-place";
import { DiffStack } from "./diff-stack";
import { NewChatPlace } from "./new-chat";
import { pullRequestNumber } from "./pull-request";
import { ReviewPlace } from "./review-place";
import { ReviewsPlace } from "./reviews-place";
import { ReviewStateProvider, useReviewState } from "./review-state";
import { useReviewFiles } from "./use-review-files";
import {
  activeTab,
  canGo,
  focusedPane,
  focusedPlace,
  focusedReview,
  initialWindow,
  placeOf,
  reduce,
  type OpenTarget,
  type Pane,
  type Place,
  type WindowAction,
} from "./window";
import type { ReviewDetail, ReviewSummary } from "./wire";

type Dispatch = (action: WindowAction) => void;

interface DiffSettings {
  readonly layout: "unified" | "split";
  readonly tree: boolean;
  /** A file to reveal, and a count that remounts the diff to reveal it. */
  readonly reveal: { readonly path: string | undefined; readonly count: number };
}

function titleOf(place: Place, reviews: readonly ReviewSummary[]): string {
  if (place.kind === "new-chat") return "New chat";

  if (place.kind === "reviews") return "Review";

  const title = reviews.find((review) => review.id === place.reviewId)?.title ?? "Pull request";

  return place.kind === "review" ? `${title} #${pullRequestNumber(place.reviewId)}` : title;
}

function markOf(review: ReviewSummary | undefined): "working" | "failed" | "idle" {
  if (review === undefined) return "idle";

  if (review.author === "working" || review.guide === "running") return "working";

  return review.author === "failed" || review.guide === "failed" ? "failed" : "idle";
}

function PlaceGlyph({
  place,
  reviews,
}: {
  readonly place: Place;
  readonly reviews: readonly ReviewSummary[];
}): ReactElement {
  if (place.kind === "new-chat") return <Icon name="new-chat" size={14} />;

  if (place.kind === "review" || place.kind === "reviews")
    return <Icon name="pull-request" size={14} />;

  return <StatusDot mark={markOf(reviews.find((review) => review.id === place.reviewId))} />;
}

function PlaceView({
  place,
  reviews,
  dispatch,
  onShowDiff,
}: {
  readonly place: Place;
  readonly reviews: { readonly list: readonly ReviewSummary[]; readonly loading: boolean };
  readonly dispatch: Dispatch;
  readonly onShowDiff: (path: string) => void;
}): ReactElement {
  const onOpen = (next: Place, target: OpenTarget): void =>
    dispatch({ kind: "open", place: next, target });

  switch (place.kind) {
    case "new-chat":
      return (
        <NewChatPlace
          onStarted={(reviewId) => dispatch({ kind: "replace", place: { kind: "chat", reviewId } })}
        />
      );
    case "reviews":
      return <ReviewsPlace reviews={reviews.list} loading={reviews.loading} onOpen={onOpen} />;
    case "chat":
      return <ChatPlace key={place.reviewId} reviewId={place.reviewId} onOpen={onOpen} />;
    case "review":
      return (
        <ReviewPlace
          key={place.reviewId}
          reviewId={place.reviewId}
          onOpen={onOpen}
          onShowDiff={onShowDiff}
        />
      );
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

/** The focused review's diff, in the workbench beside the main card. */
function Workbench({
  reviewId,
  settings,
}: {
  readonly reviewId: string;
  readonly settings: DiffSettings;
}): ReactElement {
  const { review } = useLiveReview(reviewId);

  return (
    <aside aria-label="Workbench" {...props(styles.card, styles.workbench)}>
      {review.data === undefined ? (
        <p role="status" {...props(styles.note)}>
          <Spinner /> Loading changes
        </p>
      ) : (
        <WorkbenchDiff key={settings.reveal.count} review={review.data} settings={settings} />
      )}
    </aside>
  );
}

function WorkbenchDiff({
  review,
  settings,
}: {
  readonly review: ReviewDetail;
  readonly settings: DiffSettings;
}): ReactElement {
  const data = useReviewFiles(review);
  const local = useReviewState(review.id, data.files);
  const [commit, setCommit] = useState<string | undefined>(undefined);

  if (data.empty) return <p {...props(styles.note)}>No commits yet.</p>;

  if (data.error !== null)
    return (
      <p role="alert" {...props(styles.note)}>
        {data.error.message}
      </p>
    );

  if (data.loading)
    return (
      <p role="status" {...props(styles.note)}>
        <Spinner /> Loading changes
      </p>
    );

  return (
    <DiffStack
      files={data.files}
      commits={review.commits.map((entry) => ({ oid: entry.short, subject: entry.subject }))}
      commit={commit}
      onCommit={setCommit}
      layout={settings.layout}
      treeVisible={settings.tree}
      reviewed={local.reviewed}
      onReviewed={local.setReviewed}
      collapsed={(path) => local.collapsed(path, local.reviewed(path) === "reviewed")}
      onToggle={(path) => local.toggle(path, local.reviewed(path) === "reviewed")}
      justUpdated={(path) => data.updated.has(path) && local.reviewed(path) !== "reviewed"}
      reveal={settings.reveal.path}
      onReference={local.addReference}
    />
  );
}

function Sidebar({
  reviews,
  focused,
  dispatch,
}: {
  readonly reviews: readonly ReviewSummary[];
  readonly focused: Place | undefined;
  readonly dispatch: Dispatch;
}): ReactElement {
  const open = (event: MouseEvent, place: Place): void => {
    event.preventDefault();
    dispatch({ kind: "open", place, target: targetOf(event) });
  };

  const onNewChat = focused?.kind === "new-chat";
  const onReview = focused?.kind === "reviews" || focused?.kind === "review";

  const waiting = reviews.filter(
    (review) => !review.approved && review.author !== "working" && review.commits > 0,
  );

  return (
    <aside aria-label="Sidebar" {...props(sidebarStyles.rail, styles.rail)}>
      <div {...props(sidebarStyles.primaryActions)}>
        <Row
          variant="nav"
          selected={onNewChat}
          aria-current={onNewChat ? "page" : undefined}
          xstyle={[sidebarStyles.navRow, onNewChat && sidebarStyles.navRowActive]}
          onClick={(event) => open(event, { kind: "new-chat" })}
        >
          <Row.Leading xstyle={sidebarStyles.navLeading}>
            <Icon name="new-chat" size={14} />
          </Row.Leading>
          <Row.Label>New Chat</Row.Label>
        </Row>
        <Row
          variant="nav"
          selected={onReview}
          aria-current={onReview ? "page" : undefined}
          xstyle={[sidebarStyles.navRow, onReview && sidebarStyles.navRowActive]}
          onClick={(event) => open(event, { kind: "reviews" })}
        >
          <Row.Leading xstyle={sidebarStyles.navLeading}>
            <Icon name="pull-request" size={14} />
          </Row.Leading>
          <Row.Label>Review</Row.Label>
          {waiting.length > 0 && (
            <Row.Meta xstyle={sidebarStyles.rowMeta} aria-label={`${waiting.length} waiting`}>
              {waiting.length}
            </Row.Meta>
          )}
        </Row>
      </div>
      <div {...props(sidebarStyles.scroll, styles.railScroll)}>
        <section aria-labelledby="sidebar-chats" {...props(sidebarStyles.section)}>
          <div {...props(sidebarStyles.sectionHeader)}>
            <span {...props(sidebarStyles.sectionToggle)}>
              <span id="sidebar-chats" {...props(sidebarStyles.sectionLabel)}>
                Chats
              </span>
            </span>
          </div>
          <div {...props(sidebarStyles.sessionList)}>
            {reviews.map((review) => {
              const selected = focused?.kind === "chat" && focused.reviewId === review.id;

              return (
                <Row
                  key={review.id}
                  selected={selected}
                  xstyle={[
                    sidebarStyles.rowSurface,
                    sidebarStyles.sessionRow,
                    selected && sidebarStyles.rowSelected,
                  ]}
                >
                  {selected && <Row.Backdrop xstyle={sidebarStyles.sessionSelection} />}
                  <Row.Primary
                    aria-current={selected ? "page" : undefined}
                    onClick={(event) => open(event, { kind: "chat", reviewId: review.id })}
                    onAuxClick={(event) => {
                      if (event.button === 1) open(event, { kind: "chat", reviewId: review.id });
                    }}
                  >
                    <Row.Leading xstyle={sidebarStyles.rowIcon}>
                      <StatusDot mark={markOf(review)} />
                    </Row.Leading>
                    <Row.Label>{review.title}</Row.Label>
                    {review.approved && (
                      <Row.Meta xstyle={sidebarStyles.rowMeta}>
                        <Icon name="checkmark" size={12} label="Approved" />
                      </Row.Meta>
                    )}
                  </Row.Primary>
                </Row>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
}

function TabStrip({
  state,
  reviews,
  dispatch,
}: {
  readonly state: ReturnType<typeof initialWindow>;
  readonly reviews: readonly ReviewSummary[];
  readonly dispatch: Dispatch;
}): ReactElement {
  return (
    <div {...props(styles.strip)}>
      <ul aria-label="Tabs" {...props(styles.tabs)}>
        {state.tabs.map((tab) => {
          const pane = focusedPane(tab);
          const place = pane === undefined ? { kind: "new-chat" as const } : placeOf(pane);
          const title = titleOf(place, reviews);
          const active = tab.id === state.active;

          return (
            <li key={tab.id} {...props(styles.slot)}>
              <div {...props(styles.tab, active && styles.tabActive)}>
                <button
                  type="button"
                  title={title}
                  aria-current={active ? "page" : undefined}
                  onClick={() => dispatch({ kind: "activate", tabId: tab.id })}
                  {...props(styles.tabButton)}
                >
                  <span aria-hidden="true" {...props(styles.tabGlyph)}>
                    <PlaceGlyph place={place} reviews={reviews} />
                  </span>
                  <span {...props(styles.tabLabel)}>{title}</span>
                  {tab.panes.length > 1 && (
                    <Icon name="split-right" size={12} label="Split" xstyle={styles.splitMark} />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${title}`}
                  onClick={() => dispatch({ kind: "close-tab", tabId: tab.id })}
                  {...props(styles.close, active && styles.closeActive)}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <Button
        iconOnly
        icon="plus"
        aria-label="New tab"
        onClick={() => dispatch({ kind: "new-tab" })}
      />
    </div>
  );
}

function Shell({ initialReview }: { readonly initialReview: string | undefined }): ReactElement {
  const [state, dispatch] = useReducer(reduce, initialReview, initialWindow);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);

  const [diff, setDiff] = useState<DiffSettings>({
    layout: "unified",
    tree: true,
    reveal: { path: undefined, count: 0 },
  });

  const focused = focusedPlace(state);
  const reviewId = focusedReview(state);
  const live = useLiveReview(reviewId);
  const reviewList = useReviews(live.version);
  const reviews = reviewList.data?.reviews ?? [];
  const tab = activeTab(state);
  const detail = live.review.data;
  const workbench = workbenchOpen && reviewId !== undefined;

  const showDiff = (path: string): void => {
    setWorkbenchOpen(true);
    setDiff({ ...diff, reveal: { path, count: diff.reveal.count + 1 } });
  };

  const paneView = (pane: Pane, split: boolean): ReactElement => {
    const place = placeOf(pane);
    const active = pane.id === tab?.focus;

    return (
      <div
        key={pane.id}
        onPointerDownCapture={() => {
          if (!active) dispatch({ kind: "focus-pane", paneId: pane.id });
        }}
        {...props(styles.pane)}
      >
        {split && (
          <div {...props(styles.paneHeader, active && styles.paneHeaderActive)}>
            <span aria-hidden="true" {...props(styles.tabGlyph)}>
              <PlaceGlyph place={place} reviews={reviews} />
            </span>
            <span {...props(styles.paneTitle)}>{titleOf(place, reviews)}</span>
            <Button
              iconOnly
              icon="x"
              aria-label={`Close ${titleOf(place, reviews)} pane`}
              onClick={() => dispatch({ kind: "close-pane", paneId: pane.id })}
            />
          </div>
        )}
        <div {...props(styles.paneBody)}>
          <PlaceView
            place={place}
            reviews={{ list: reviews, loading: reviewList.isPending }}
            dispatch={dispatch}
            onShowDiff={showDiff}
          />
        </div>
      </div>
    );
  };

  return (
    <div {...props(styles.window)}>
      <FileTypeIconSprite />
      <header {...props(styles.titlebar)}>
        <div {...props(styles.lane, sidebarOpen && styles.laneSidebar)}>
          <span aria-hidden="true" {...props(styles.lights)}>
            <span {...props(styles.light)} />
            <span {...props(styles.light)} />
            <span {...props(styles.light)} />
          </span>
          <span {...props(styles.fill)} />
          <Toggle
            iconOnly
            indicator="glyph"
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            pressed={sidebarOpen}
            onPressedChange={setSidebarOpen}
          >
            <PanelToggleIcon side="left" visible={sidebarOpen} />
          </Toggle>
        </div>
        <div {...props(styles.history)}>
          <Button
            iconOnly
            icon="arrow-left"
            aria-label="Back"
            disabled={!canGo(state, "back")}
            onClick={() => dispatch({ kind: "back" })}
          />
          <Button
            iconOnly
            icon="arrow-right"
            aria-label="Forward"
            disabled={!canGo(state, "forward")}
            onClick={() => dispatch({ kind: "forward" })}
          />
        </div>
        <TabStrip state={state} reviews={reviews} dispatch={dispatch} />
        <div {...props(styles.titlebarActions)}>
          <Menu>
            <MenuTrigger
              render={<Button iconOnly icon="more-horizontal" aria-label="More options" />}
            />
            <MenuContent align="end">
              {focused?.kind === "review" && (
                <MenuItem
                  icon="split-right"
                  onClick={() =>
                    dispatch({
                      kind: "open",
                      place: { kind: "chat", reviewId: focused.reviewId },
                      target: "beside",
                    })
                  }
                >
                  Open Chat Beside
                </MenuItem>
              )}
              {focused?.kind === "chat" && (
                <MenuItem
                  icon="split-right"
                  onClick={() =>
                    dispatch({
                      kind: "open",
                      place: { kind: "review", reviewId: focused.reviewId },
                      target: "beside",
                    })
                  }
                >
                  Open Review Beside
                </MenuItem>
              )}
              <MenuSub>
                <MenuSubTrigger
                  icon="split-right"
                  value={diff.layout === "split" ? "Split" : "Unified"}
                >
                  Diff Layout
                </MenuSubTrigger>
                <MenuSubContent>
                  <MenuRadioGroup
                    value={diff.layout}
                    onValueChange={(value) =>
                      setDiff({ ...diff, layout: value === "split" ? "split" : "unified" })
                    }
                  >
                    <MenuRadioItem value="unified">Unified</MenuRadioItem>
                    <MenuRadioItem value="split">Split</MenuRadioItem>
                  </MenuRadioGroup>
                </MenuSubContent>
              </MenuSub>
              <MenuCheckboxItem
                checked={diff.tree}
                closeOnClick={false}
                onCheckedChange={(tree) => setDiff({ ...diff, tree })}
              >
                Show File Tree
              </MenuCheckboxItem>
              {detail !== undefined && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon="copy"
                    onClick={() => void navigator.clipboard.writeText(detail.headRef)}
                  >
                    Copy Branch Name
                  </MenuItem>
                  {detail.author !== undefined && (
                    <MenuItem
                      icon="folder"
                      onClick={() =>
                        void navigator.clipboard.writeText(detail.author?.worktree ?? "")
                      }
                    >
                      Copy Worktree Path
                    </MenuItem>
                  )}
                </>
              )}
              {tab !== undefined && (
                <>
                  <MenuSeparator />
                  <MenuItem icon="x" onClick={() => dispatch({ kind: "close-tab", tabId: tab.id })}>
                    Close Tab
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
          <Toggle
            iconOnly
            indicator="glyph"
            aria-label={workbench ? "Close workbench" : "Open workbench"}
            pressed={workbench}
            disabled={reviewId === undefined}
            onPressedChange={setWorkbenchOpen}
          >
            <PanelToggleIcon side="right" visible={workbench} />
          </Toggle>
        </div>
      </header>
      <div {...props(styles.body)}>
        {sidebarOpen && <Sidebar reviews={reviews} focused={focused} dispatch={dispatch} />}
        <main {...props(styles.card, styles.main, !sidebarOpen && styles.mainAlone)}>
          {tab !== undefined && (
            <div {...props(styles.panes)}>
              {tab.panes.map((pane, index) => (
                <div key={pane.id} {...props(styles.paneSlot)}>
                  {index > 0 && <span aria-hidden="true" {...props(styles.divider)} />}
                  {paneView(pane, tab.panes.length > 1)}
                </div>
              ))}
            </div>
          )}
        </main>
        {workbench && reviewId !== undefined && <Workbench reviewId={reviewId} settings={diff} />}
      </div>
    </div>
  );
}

export function ReviewPage({
  initialReview,
}: {
  readonly initialReview: string | undefined;
}): ReactElement {
  return (
    <ReviewStateProvider>
      <Shell initialReview={initialReview} />
    </ReviewStateProvider>
  );
}

const styles = create({
  /** The chrome runs behind everything; the main area is a card set into it. */
  window: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    minHeight: 0,
    backgroundColor: role.sidebarMaterial,
    color: role.contentPrimary,
  },
  titlebar: {
    display: "flex",
    alignItems: "center",
    height: shell.titlebarHeight,
    flexShrink: 0,
  },
  lane: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: "100%",
    paddingInline: 8,
    flexShrink: 0,
  },
  laneSidebar: { width: sidebar.width },
  lights: { display: "flex", alignItems: "center", gap: 8, paddingInline: "6px 10px" },
  // Stand-ins for the macOS window controls the real titlebar leaves room for.
  light: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
  },
  fill: { flex: 1 },
  history: { display: "flex", alignItems: "center", gap: 2, paddingInline: 4, flexShrink: 0 },
  strip: { display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, height: "100%" },
  tabs: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flex: "0 1 auto",
    minWidth: 0,
    height: "100%",
    margin: 0,
    padding: 0,
    overflowX: "auto",
    listStyle: "none",
    scrollbarWidth: "none",
  },
  slot: { display: "flex", flex: "0 1 240px", minWidth: 72 },
  tab: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    height: button.heightMd,
    borderRadius: button.radiusMd,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
    color: role.contentSecondary,
  },
  tabActive: {
    backgroundColor: role.bgInteractiveSecondary,
    color: role.contentPrimary,
  },
  tabButton: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
    height: "100%",
    paddingInline: "10px 4px",
    borderStyle: "none",
    borderRadius: "inherit",
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textAlign: "start",
  },
  tabGlyph: {
    display: "inline-grid",
    placeItems: "center",
    width: glyph.box,
    height: glyph.box,
    flexShrink: 0,
  },
  tabLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  splitMark: { flexShrink: 0, color: role.contentSecondary },
  // The close button shows on hover, on focus, and on the active tab.
  close: {
    display: "inline-grid",
    placeItems: "center",
    width: glyph.box,
    height: glyph.box,
    marginInlineEnd: 4,
    borderStyle: "none",
    borderRadius: radius.indicator,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
    color: role.contentSecondary,
    opacity: { default: 0, ":focus-visible": 1 },
    flexShrink: 0,
  },
  closeActive: { opacity: 1 },
  titlebarActions: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    paddingInline: 8,
    flexShrink: 0,
  },
  body: { display: "flex", flex: 1, minHeight: 0 },
  rail: { width: sidebar.width, flexShrink: 0 },
  // The lab's page switcher floats over the bottom corner; the list scrolls clear of it.
  railScroll: { paddingBlockEnd: 56 },
  card: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    marginBlockEnd: 8,
    marginInlineEnd: 8,
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    overflow: "hidden",
  },
  main: { flex: 1 },
  mainAlone: { marginInlineStart: 8 },
  workbench: { width: "min(44%, 720px)", flexShrink: 0 },
  panes: { display: "flex", flex: 1, minHeight: 0 },
  paneSlot: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  pane: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  divider: { width: 1, flexShrink: 0, backgroundColor: role.borderSecondaryTranslucent },
  paneHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: button.heightLg,
    paddingInline: "12px 4px",
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  paneHeaderActive: { color: role.contentPrimary },
  paneTitle: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  paneBody: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  note: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    padding: 28,
    color: role.contentSecondary,
  },
});
