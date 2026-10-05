/**
 * The review demo in the desktop app's shell, as `docs/tabs.md` lays it out.
 * The chrome runs behind everything:
 * - a titlebar with the sidebar toggle, back and forward, the tab strip, and
 *   at its end "⋯" and the workbench toggle;
 * - the app's sidebar: New Chat and Review.
 * The main area is a card set into the chrome, showing a place: a new chat,
 * the Review page, or a pull request. Questions about a pull request go to its
 * side chat, which belongs to the page and is never a place or a chat of its
 * own. The pull requests are faked; see `pull-request.ts`. The workbench
 * beside the card shows the focused pull request's diff.
 *
 * Everything inside the places is real: core sessions, git, Nyte's worktrees.
 * The shell keeps its window in a reducer and its toggles in state; nothing
 * here needs an effect.
 */
import { create, props } from "@stylexjs/stylex";
import { useReducer, useState, type MouseEvent, type ReactElement } from "react";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
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
import { NewChatPlace } from "./new-chat";
import { pullRequestNumber } from "./pull-request";
import { ReviewDiff, ReviewPlace, type DiffSettings } from "./review-place";
import { ReviewsPlace } from "./reviews-place";
import { ReviewStateProvider } from "./review-state";
import {
  activeTab,
  canGo,
  focusedPlace,
  focusedReview,
  initialWindow,
  placeOf,
  reduce,
  targetOf,
  type OpenTarget,
  type Place,
  type WindowAction,
} from "./window";
import type { ReviewSummary } from "./wire";

type Dispatch = (action: WindowAction) => void;

function titleOf(place: Place, reviews: readonly ReviewSummary[]): string {
  if (place.kind === "new-chat") return "New chat";

  if (place.kind === "reviews") return "Review";

  const title = reviews.find((review) => review.id === place.reviewId)?.title ?? "Pull request";

  return `${title} #${pullRequestNumber(place.reviewId)}`;
}

function PlaceGlyph({ place }: { readonly place: Place }): ReactElement {
  return <Icon name={place.kind === "new-chat" ? "new-chat" : "pull-request"} size={14} />;
}

function PlaceView({
  place,
  reviews,
  diff,
  dispatch,
}: {
  readonly place: Place;
  readonly reviews: { readonly list: readonly ReviewSummary[]; readonly loading: boolean };
  readonly diff: DiffSettings;
  readonly dispatch: Dispatch;
}): ReactElement {
  const onOpen = (next: Place, target: OpenTarget): void =>
    dispatch({ kind: "open", place: next, target });

  switch (place.kind) {
    case "new-chat":
      return (
        <NewChatPlace
          onStarted={(reviewId) =>
            dispatch({ kind: "replace", place: { kind: "review", reviewId } })
          }
        />
      );
    case "reviews":
      return <ReviewsPlace reviews={reviews.list} loading={reviews.loading} onOpen={onOpen} />;
    case "review":
      return (
        <ReviewPlace
          key={place.reviewId}
          reviewId={place.reviewId}
          view={place.view ?? "overview"}
          diff={diff}
          onView={(view) =>
            dispatch({ kind: "replace", place: { kind: "review", reviewId: place.reviewId, view } })
          }
        />
      );
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

/** The focused pull request's diff, in the workbench beside the main card. */
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
        <ReviewDiff review={review.data} settings={settings} reveal={undefined} />
      )}
    </aside>
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
          const place = placeOf(tab);
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
                    <PlaceGlyph place={place} />
                  </span>
                  <span {...props(styles.tabLabel)}>{title}</span>
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

  const [diff, setDiff] = useState<DiffSettings>({ layout: "unified", tree: true });

  const focused = focusedPlace(state);
  const reviewId = focusedReview(state);
  const live = useLiveReview(reviewId);
  const reviewList = useReviews(live.version);
  const reviews = reviewList.data?.reviews ?? [];
  const tab = activeTab(state);
  const detail = live.review.data;
  const workbench = workbenchOpen && reviewId !== undefined;

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
          {focused !== undefined && (
            <PlaceView
              key={tab?.id}
              place={focused}
              reviews={{ list: reviews, loading: reviewList.isPending }}
              diff={diff}
              dispatch={dispatch}
            />
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
  note: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    padding: 28,
    color: role.contentSecondary,
  },
});
