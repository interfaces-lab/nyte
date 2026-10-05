/**
 * The guide: the change told in the order a reviewer should read it. Each
 * section is a band. Its story stays put on the left while its code scrolls
 * past on the right, and code the story names links to the line that holds
 * it: pointing at the name lights the line, clicking scrolls to it.
 *
 * Files open as hunks. A deleted file, a long one and one you have reviewed
 * start folded to their header, so a section reads in one screen. While a
 * brief is written, the status line says so and core's own tool steps show
 * what the reviewer reads. A guide for an earlier head stays up while the
 * next one is written from the interdiff.
 */
import { create, props } from "@stylexjs/stylex";
import type { SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { FileTypeIcon } from "@nyte-ai/app/components/file-type-icon.tsx";
import { TurnView } from "@nyte-ai/app/conversation/turn-view.tsx";
import { PierreWorkerProvider } from "@nyte-ai/app/pierre-worker-provider.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { glyph, radius, row } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";
import {
  AddToChat,
  CodeFileHeader,
  Counts,
  pierreHost,
  referenceOf,
  usePierreOptions,
  type CodeReference,
  type ReviewedState,
  type ReviewFile,
} from "./code";
import { workspace } from "../shell/host-stub";
import { useHeadTurns, type ConversationTurn } from "./api";
import { plural, sectionFiles } from "./files";
import { linkProse, type LineTarget, type ProseSegment } from "./prose-links";
import type { Brief, Guide, ReviewDetail } from "./wire";

/** Files a section opens with; the rest start folded so a large section stays scannable. */
const OPEN_FILES = 3;

/** Past this many changed lines a file starts folded; its header still counts them. */
const LONG_DIFF = 240;

const NO_LIVE_TOOLS = new Map();

export interface GuideFiles {
  readonly files: readonly ReviewFile[];
  readonly reviewed: (path: string) => ReviewedState;
  readonly onReviewed: (path: string, reviewed: boolean) => void;
  readonly collapsed: (path: string, fallback: boolean) => boolean;
  readonly onToggle: (path: string, fallback: boolean) => void;
  readonly justUpdated: (path: string) => boolean;
  readonly onOpenInDiff: (path: string) => void;
  readonly onReference: (reference: CodeReference) => void;
}

/** How the page around the guide follows it. */
export interface GuideNavigation {
  /** The section in view, reported as the guide scrolls. */
  readonly onInView: (index: number) => void;
  /** Each band as it mounts and unmounts, for the toolbar and the Overview to scroll to. */
  readonly onBand: (index: number, node: HTMLElement | null) => void;
}

export const sectionNumber = (index: number): string => String(index + 1).padStart(2, "0");

function lastStep(turns: readonly ConversationTurn[]): string | undefined {
  const part = turns
    .flatMap((turn) => turn.parts)
    .findLast((candidate) => candidate.kind === "tool");

  if (part?.kind !== "tool") return undefined;

  if (part.class.kind === "file_read") return `Reading ${part.class.path}`;

  return part.class.kind === "custom" ? part.class.label : undefined;
}

/** Writing the guide: the page's one way to spend on it, and whether that request is in flight. */
export interface GuideWriting {
  readonly onWrite: () => void;
  readonly requesting: boolean;
}

export function StatusLine({
  review,
  current,
  shown,
  version,
  writing: request,
}: {
  readonly review: ReviewDetail;
  readonly current: Brief | undefined;
  readonly shown: Brief | undefined;
  readonly version: number;
  readonly writing: GuideWriting;
}): ReactElement {
  const writing = current?.status === "running" || (current === undefined && request.requesting);
  const turns = useHeadTurns(review.sessionId, writing ? current : undefined, version);
  const step = lastStep(turns);

  const behind =
    shown === undefined ? 0 : review.commits.findIndex((commit) => commit.oid === shown.head);

  if (review.revision.head === review.revision.base)
    return (
      <div role="status" {...props(styles.status)}>
        <span {...props(styles.statusIcon)}>
          {review.author?.status === "working" ? <Spinner /> : <Icon name="git-branch" size={14} />}
        </span>
        <span {...props(styles.statusText)}>
          {review.author?.status === "working"
            ? "Nyte is working on the task. The guide can be written once the branch has a commit."
            : "The guide can be written once the branch has a commit."}
        </span>
      </div>
    );

  if (current?.status === "failed")
    return (
      <div {...props(styles.status)}>
        <span {...props(styles.statusIcon)}>
          <StatusDot mark="failed" />
        </span>
        <span {...props(styles.statusText)}>
          The guide for {review.revision.head.slice(0, 7)} failed. {current.failure}
        </span>
        <Button variant="outline" loading={request.requesting} onClick={request.onWrite}>
          Try again
        </Button>
      </div>
    );

  // No guide yet: the page's one action, under the words that explain it, where the eye already is.
  if (current === undefined && !writing && shown === undefined)
    return (
      <div {...props(styles.empty)}>
        <Icon name="sparkle" size={20} xstyle={styles.emptyIcon} />
        <h2 {...props(styles.emptyTitle)}>No guide yet</h2>
        <p {...props(styles.emptyText)}>
          Nyte reads the change and walks you through it, part by part, beside its code.
        </p>
        <Button variant="solid" tone="primary" size="lg" onClick={request.onWrite}>
          Write Guide
        </Button>
      </div>
    );

  if (current === undefined && !writing)
    return (
      <div role="status" {...props(styles.status)}>
        <span {...props(styles.statusIcon)}>
          <Icon name="git-branch" size={14} />
        </span>
        <span {...props(styles.statusText)}>
          {plural(Math.max(behind, 1), "new commit", "new commits")} since this guide.
        </span>
        <Button variant="outline" onClick={request.onWrite}>
          Update Guide
        </Button>
      </div>
    );

  if (!writing) return <div role="status" {...props(styles.statusEmpty)} />;

  return (
    <div {...props(styles.writing)}>
      <div role="status" {...props(styles.status)}>
        <span {...props(styles.statusIcon)}>
          <Spinner />
        </span>
        <span {...props(styles.statusText)}>
          {shown !== undefined && shown.head !== review.revision.head
            ? `${plural(Math.max(behind, 1), "new commit", "new commits")} since this guide. Updating it from the interdiff.`
            : current?.from === undefined
              ? "Reading the change and writing the guide."
              : "Updating the guide from the interdiff."}
          {step !== undefined && <span {...props(styles.step)}> {step}</span>}
        </span>
      </div>
      {shown === undefined &&
        turns.map((turn) => (
          <div key={turn.id} {...props(styles.steps)}>
            <TurnView
              turn={{ ...turn, parts: turn.parts.filter((part) => part.kind !== "user") }}
              liveTools={NO_LIVE_TOOLS}
              cwd={workspace.path}
              onOpenChanges={() => {}}
              running
            />
          </div>
        ))}
    </div>
  );
}

const startsFolded = (file: ReviewFile, open: boolean, reviewed: boolean): boolean =>
  !open ||
  reviewed ||
  file.metadata === undefined ||
  file.metadata.type === "deleted" ||
  file.added + file.removed > LONG_DIFF;

/** Pierre draws each file in a shadow root; its rows carry the line number and the row type. */
function lineRow(card: HTMLElement | undefined, target: LineTarget): Element | undefined {
  const root = card?.querySelector("diffs-container")?.shadowRoot;

  return (
    root?.querySelector(`[data-line="${target.line}"][data-line-type="${target.row}"]`) ??
    root?.querySelector(`[data-line="${target.line}"]`) ??
    undefined
  );
}

function FileCard({
  file,
  fallback,
  input,
  lit,
  register,
  onDrawn,
}: {
  readonly file: ReviewFile;
  readonly fallback: boolean;
  readonly input: GuideFiles;
  readonly lit: LineTarget | undefined;
  readonly register: (path: string, node: HTMLDivElement | null) => void;
  /** Pierre finished drawing: a line waiting to be scrolled to can be found now. */
  readonly onDrawn: (path: string) => void;
}): ReactElement {
  const options = usePierreOptions("unified");
  const selection = useRef<SelectedLineRange | null>(null);
  const collapsed = input.collapsed(file.path, fallback);

  return (
    <div ref={(node) => register(file.path, node)} {...props(styles.card)}>
      <CodeFileHeader
        file={file}
        collapsed={collapsed}
        reviewed={input.reviewed(file.path)}
        justUpdated={input.justUpdated(file.path)}
        onToggle={() => input.onToggle(file.path, fallback)}
        onReviewed={(next) => input.onReviewed(file.path, next)}
        onOpenInDiff={() => input.onOpenInDiff(file.path)}
      />
      {!collapsed &&
        (file.metadata === undefined ? (
          <p {...props(styles.undrawn)}>
            This diff is too large to draw here. <Counts file={file} />
          </p>
        ) : (
          <FileDiff
            fileDiff={file.metadata}
            selectedLines={
              lit?.path === file.path ? { start: lit.line, end: lit.line, side: lit.side } : null
            }
            options={{
              ...options,
              disableFileHeader: true,
              onLineSelectionEnd: (range) => {
                selection.current = range;
              },
              onPostRender: () => onDrawn(file.path),
            }}
            renderGutterUtility={(hovered) => (
              <AddToChat
                onAdd={() => {
                  const line = hovered();

                  const range =
                    selection.current ??
                    (line === undefined
                      ? null
                      : { start: line.lineNumber, end: line.lineNumber, side: line.side });

                  if (range !== null) input.onReference(referenceOf(file, range));
                }}
              />
            )}
            {...props(pierreHost)}
          />
        ))}
    </div>
  );
}

/** One run of a section's story: words, or a name that points into the code beside it. */
function Segment({
  segment,
  lit,
  onPoint,
  onShowLine,
  onShowFile,
}: {
  readonly segment: ProseSegment;
  readonly lit: LineTarget | undefined;
  readonly onPoint: (target: LineTarget | undefined) => void;
  readonly onShowLine: (target: LineTarget) => void;
  readonly onShowFile: (path: string) => void;
}): ReactNode {
  if (segment.kind === "text") return segment.text;

  if (segment.kind === "file")
    return (
      <button
        type="button"
        title={segment.path}
        onClick={() => onShowFile(segment.path)}
        {...props(styles.link)}
      >
        {segment.text}
      </button>
    );

  const { target } = segment;

  if (target === undefined) return <code {...props(styles.code)}>{segment.text}</code>;

  const on =
    lit !== undefined &&
    lit.path === target.path &&
    lit.line === target.line &&
    lit.side === target.side;

  return (
    <button
      type="button"
      title={`${target.path}:${target.line}`}
      aria-pressed={on}
      onPointerEnter={() => onPoint(target)}
      onPointerLeave={() => onPoint(undefined)}
      onFocus={() => onPoint(target)}
      onBlur={() => onPoint(undefined)}
      onClick={() => onShowLine(target)}
      {...props(styles.link, styles.code, on && styles.linkLit)}
    >
      {segment.text}
    </button>
  );
}

export function ReviewGuide({
  review,
  current,
  shown,
  version,
  input,
  header,
  navigation,
  writing,
  onAsk,
}: {
  readonly review: ReviewDetail;
  readonly current: Brief | undefined;
  readonly shown: (Brief & { readonly guide: Guide }) | undefined;
  readonly version: number;
  readonly input: GuideFiles;
  /** The pull request's title block, above the guide's status. */
  readonly header: ReactNode;
  readonly navigation: GuideNavigation;
  readonly writing: GuideWriting;
  readonly onAsk: (section: string) => void;
}): ReactElement {
  const scroller = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const bands = useRef(new Map<number, HTMLElement>());
  const waiting = useRef<LineTarget | undefined>(undefined);
  const inView = useRef(0);
  const [pointed, setPointed] = useState<LineTarget | undefined>(undefined);
  const [pinned, setPinned] = useState<LineTarget | undefined>(undefined);
  const lit = pointed ?? pinned;

  const sections = (shown?.guide.sections ?? []).map((section, index) => ({
    section,
    index,
    id: `${review.id}-section-${index + 1}`,
    files: sectionFiles(section, input.files),
  }));

  const fallbacks = new Map(
    sections.flatMap(({ files }) =>
      files.map((file, position): [string, boolean] => [
        file.path,
        startsFolded(file, position < OPEN_FILES, input.reviewed(file.path) === "reviewed"),
      ]),
    ),
  );

  const unfold = (path: string): boolean => {
    const fallback = fallbacks.get(path) ?? false;

    if (!input.collapsed(path, fallback)) return false;

    input.onToggle(path, fallback);

    return true;
  };

  // Only the guide scrolls: a row's own scrollIntoView would also slide Pierre's code sideways under its sticky gutter.
  const center = (row: Element): void => {
    const box = scroller.current?.getBoundingClientRect();

    if (box === undefined) return;

    const top = row.getBoundingClientRect().top - box.top - box.height / 2;

    scroller.current?.scrollBy({ top, behavior: "smooth" });
  };

  const showFile = (path: string): void => {
    unfold(path);
    cards.current.get(path)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const showLine = (target: LineTarget): void => {
    setPinned(target);

    const row = unfold(target.path) ? undefined : lineRow(cards.current.get(target.path), target);

    if (row !== undefined) {
      center(row);

      return;
    }

    // Folded or still drawing: Pierre's next draw scrolls to it.
    waiting.current = target;
    cards.current.get(target.path)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const drawn = (path: string): void => {
    const target = waiting.current;

    if (target?.path !== path) return;

    const found = lineRow(cards.current.get(path), target);

    if (found === undefined) return;

    waiting.current = undefined;
    center(found);
  };

  /** The section in view is the last band whose top has passed the upper third. */
  const follow = (scroller: HTMLElement): void => {
    const box = scroller.getBoundingClientRect();
    const line = box.top + box.height / 3;
    let reached = 0;

    for (const [index, node] of bands.current)
      if (node.getBoundingClientRect().top <= line) reached = Math.max(reached, index);

    if (reached === inView.current) return;

    inView.current = reached;
    navigation.onInView(reached);
  };

  return (
    <PierreWorkerProvider>
      <div
        ref={scroller}
        onScroll={(event) => follow(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setPinned(undefined);
        }}
        {...props(styles.scroll)}
      >
        <div {...props(styles.top)}>
          {header}
          <StatusLine
            review={review}
            current={current}
            shown={shown}
            version={version}
            writing={writing}
          />
        </div>
        {sections.map(({ section, index, id, files }) => {
          const done = files.filter((file) => input.reviewed(file.path) === "reviewed").length;

          return (
            <section
              key={id}
              id={id}
              ref={(node) => {
                if (node === null) bands.current.delete(index);
                else bands.current.set(index, node);

                navigation.onBand(index, node);
              }}
              aria-labelledby={`${id}-title`}
              {...props(styles.band)}
            >
              <div {...props(styles.story)}>
                <p {...props(styles.eyebrow)}>
                  <span {...props(styles.eyebrowNumber)}>{sectionNumber(index)}</span>
                  <span>of {sectionNumber(sections.length - 1)}</span>
                  {done === files.length && (
                    <span {...props(styles.eyebrowDone)}>
                      <Icon name="checkmark" size={12} /> Reviewed
                    </span>
                  )}
                </p>
                <h2 id={`${id}-title`} {...props(styles.sectionTitle)}>
                  {section.title}
                </h2>
                <p {...props(styles.explanation)}>
                  {linkProse(section.explanation, files).map((segment, position) => (
                    <Segment
                      key={`${position}:${segment.text}`}
                      segment={segment}
                      lit={lit}
                      onPoint={setPointed}
                      onShowLine={showLine}
                      onShowFile={showFile}
                    />
                  ))}
                </p>
                <ul aria-label={`Files in ${section.title}`} {...props(styles.fileList)}>
                  {files.map((file) => {
                    const name = file.path.split("/").at(-1) ?? file.path;

                    return (
                      <li key={file.path}>
                        <button
                          type="button"
                          title={file.path}
                          onClick={() => showFile(file.path)}
                          {...props(styles.fileRow)}
                        >
                          <FileTypeIcon path={file.path} />
                          <span {...props(styles.fileName)}>{name}</span>
                          <span {...props(styles.fileDirectory)}>
                            {file.path.slice(0, file.path.length - name.length)}
                          </span>
                          <Counts file={file} />
                          <span {...props(intent.primary, styles.check)}>
                            {input.reviewed(file.path) === "reviewed" && (
                              <Icon name="checkmark" size={14} label="Reviewed" />
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <Button
                  variant="ghost"
                  icon="bubble-question"
                  xstyle={styles.ask}
                  onClick={() => onAsk(section.title)}
                >
                  Ask about this section
                </Button>
              </div>
              <div {...props(styles.cards)}>
                {files.map((file) => (
                  <FileCard
                    key={file.path}
                    file={file}
                    fallback={fallbacks.get(file.path) ?? false}
                    input={input}
                    lit={lit}
                    register={(path, node) => {
                      if (node === null) cards.current.delete(path);
                      else cards.current.set(path, node);
                    }}
                    onDrawn={drawn}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </PierreWorkerProvider>
  );
}

const styles = create({
  scroll: {
    containerType: "inline-size",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingInline: 32,
    paddingBlockEnd: 96,
  },
  top: { display: "flex", flexDirection: "column", gap: 4, paddingBlock: "28px 8px" },
  writing: { display: "flex", flexDirection: "column", gap: 8 },
  status: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBlockStart: 8,
    padding: "8px 12px",
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  statusEmpty: { display: "contents" },
  statusIcon: { display: "inline-grid", placeItems: "center", width: glyph.sm, flexShrink: 0 },
  // The button follows the sentence it answers instead of waiting at the far edge of a wide row.
  statusText: { flex: "0 1 auto", minWidth: 0, textWrap: "pretty" },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    marginInline: "auto",
    maxWidth: 420,
    paddingBlock: "72px 24px",
    textAlign: "center",
  },
  emptyIcon: { marginBlockEnd: 4, color: role.contentSecondary },
  emptyTitle: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    fontWeight: 600,
  },
  emptyText: {
    margin: "0 0 12px",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    textWrap: "pretty",
  },
  step: {
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    overflowWrap: "anywhere",
  },
  steps: { paddingInline: 12 },
  band: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 5fr) minmax(0, 8fr)",
    columnGap: 40,
    alignItems: "start",
    paddingBlock: "32px 48px",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
    scrollMarginBlockStart: 8,
    "@container (max-width: 820px)": { gridTemplateColumns: "minmax(0, 1fr)", rowGap: 20 },
  },
  // The story stays beside its code while the code scrolls.
  story: {
    position: { default: "sticky", "@container (max-width: 820px)": "static" },
    top: 24,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    minWidth: 0,
  },
  eyebrow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontVariantNumeric: "tabular-nums",
  },
  eyebrowNumber: { color: role.contentPrimary, fontWeight: 500 },
  eyebrowDone: { display: "inline-flex", alignItems: "center", gap: 4, marginInlineStart: 6 },
  sectionTitle: {
    marginBlock: "8px 0",
    color: role.contentPrimary,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    fontWeight: 600,
    letterSpacing: type.letterLg,
    textWrap: "balance",
  },
  // The story is the page's reading text: the size and colour of prose, not of a caption.
  explanation: {
    marginBlock: "6px 0",
    maxWidth: "62ch",
    color: role.contentPrimary,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    letterSpacing: type.letterLg,
    textWrap: "pretty",
  },
  code: {
    fontFamily: type.fontMono,
    fontSize: type.fontBase,
    overflowWrap: "anywhere",
  },
  link: {
    display: "inline",
    margin: 0,
    paddingInline: 2,
    marginInline: -2,
    borderStyle: "none",
    borderRadius: radius.indicator,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
      ":focus-visible": role.bgHover,
    },
    color: "inherit",
    font: "inherit",
    textAlign: "inherit",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: role.contentSecondary,
    textDecorationThickness: 1,
    textUnderlineOffset: 3,
    cursor: appearance.cursorInteractive,
  },
  linkLit: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    textDecorationColor: role.contentPrimary,
  },
  fileList: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    gap: 4,
    margin: "20px 0 0",
    padding: 0,
    listStyle: "none",
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    height: row.heightLg,
    paddingInline: 10,
    borderStyle: "none",
    borderRadius: radius.control,
    backgroundColor: {
      default: role.bgMutedTranslucent,
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
    color: role.contentPrimary,
    font: "inherit",
    fontSize: type.fontSm,
    textAlign: "start",
    cursor: appearance.cursorInteractive,
  },
  fileName: {
    flexShrink: 0,
    maxWidth: "60%",
    overflow: "hidden",
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileDirectory: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  check: {
    display: "inline-grid",
    placeItems: "center",
    width: glyph.sm,
    color: role.contentSecondary,
    flexShrink: 0,
  },
  ask: { marginBlockStart: 12, marginInlineStart: -8 },
  cards: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 },
  card: {
    overflow: "hidden",
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    scrollMarginBlockStart: 16,
  },
  undrawn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    padding: "12px 14px",
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
});
