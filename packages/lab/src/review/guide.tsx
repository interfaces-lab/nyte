/**
 * The guide for one head: what the change does, in the order a reviewer
 * should read it. One band per section: the left third says what the part
 * does and lists its files; the right two thirds hold their diffs.
 *
 * A sticky index names every section with how much of it you have reviewed
 * and marks the one in view. While a brief is written, the status line says
 * so and core's own tool steps show what the reviewer is reading. A guide for
 * an earlier head stays up while the next one is written by interdiff.
 */
import { create, props } from "@stylexjs/stylex";
import type { SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useRef, useState, type ReactElement } from "react";
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
import { useHeadTurns, useRetry, type ConversationTurn } from "./api";
import { plural, sectionFiles } from "./files";
import type { Brief, Guide, ReviewDetail } from "./wire";

/** Files a section opens with; the rest start collapsed so a large section stays scannable. */
const OPEN_FILES = 3;

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

function lastStep(turns: readonly ConversationTurn[]): string | undefined {
  const part = turns
    .flatMap((turn) => turn.parts)
    .findLast((candidate) => candidate.kind === "tool");

  if (part?.kind !== "tool") return undefined;

  if (part.class.kind === "file_read") return `Reading ${part.class.path}`;

  return part.class.kind === "custom" ? part.class.label : undefined;
}

function StatusLine({
  review,
  current,
  shown,
  version,
}: {
  readonly review: ReviewDetail;
  readonly current: Brief | undefined;
  readonly shown: Brief | undefined;
  readonly version: number;
}): ReactElement {
  const retry = useRetry(review.id);
  const writing = current === undefined || current.status === "running";
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
            ? "Nyte is working on the task. The guide is written once the branch has a commit."
            : "The guide is written once the branch has a commit."}
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
        <Button
          variant="outline"
          loading={retry.isPending}
          onClick={() => retry.mutate({ head: review.revision.head })}
        >
          Try again
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

function FileCard({
  file,
  open,
  input,
  register,
}: {
  readonly file: ReviewFile;
  readonly open: boolean;
  readonly input: GuideFiles;
  readonly register: (path: string, node: HTMLDivElement | null) => void;
}): ReactElement {
  const options = usePierreOptions("unified");
  const selection = useRef<SelectedLineRange | null>(null);
  const fallback = !open || file.metadata === undefined || input.reviewed(file.path) === "reviewed";
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
            options={{
              ...options,
              disableFileHeader: true,
              onLineSelectionEnd: (range) => {
                selection.current = range;
              },
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

export function ReviewGuide({
  review,
  current,
  shown,
  version,
  input,
  onAsk,
}: {
  readonly review: ReviewDetail;
  readonly current: Brief | undefined;
  readonly shown: (Brief & { readonly guide: Guide }) | undefined;
  readonly version: number;
  readonly input: GuideFiles;
  readonly onAsk: (section: string) => void;
}): ReactElement {
  const cards = useRef(new Map<string, HTMLDivElement>());
  const bands = useRef(new Map<number, HTMLElement>());
  const [inView, setInView] = useState(0);

  const register = (path: string, node: HTMLDivElement | null): void => {
    if (node === null) cards.current.delete(path);
    else cards.current.set(path, node);
  };

  const reveal = (path: string): void =>
    cards.current.get(path)?.scrollIntoView({ block: "start", behavior: "smooth" });

  const sections = (shown?.guide.sections ?? []).map((section, index) => ({
    section,
    index,
    id: `section-${index + 1}`,
    files: sectionFiles(section, input.files),
  }));

  const total = String(sections.length).padStart(2, "0");
  const added = input.files.reduce((sum, file) => sum + file.added, 0);
  const removed = input.files.reduce((sum, file) => sum + file.removed, 0);

  /** The section in view is the last one whose band has reached the line under the sticky index. */
  const follow = (scroller: HTMLElement): void => {
    const line = scroller.getBoundingClientRect().top + 96;
    let current = 0;

    for (const [index, node] of bands.current)
      if (node.getBoundingClientRect().top <= line) current = Math.max(current, index);

    if (current !== inView) setInView(current);
  };

  return (
    <PierreWorkerProvider>
      <div onScroll={(event) => follow(event.currentTarget)} {...props(styles.scroll)}>
        <header {...props(styles.intro)}>
          <h1 {...props(styles.title)}>{review.title}</h1>
          <p {...props(styles.meta)}>
            <span {...props(styles.refs)}>
              <span translate="no">{review.baseRef}</span>
              <span aria-hidden="true" {...props(styles.arrow)}>
                ←
              </span>
              <span translate="no">{review.headRef}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span>{plural(review.commits.length, "commit", "commits")}</span>
            <span aria-hidden="true">·</span>
            <span>{plural(review.files.length, "file", "files")}</span>
            <span {...props(styles.counts)}>
              <span {...props([intent.success, styles.added])}>+{added}</span>
              <span {...props([intent.danger, styles.removed])}>−{removed}</span>
            </span>
          </p>
          <StatusLine review={review} current={current} shown={shown} version={version} />
        </header>
        {sections.length > 0 && (
          <nav aria-label="Guide sections" {...props(styles.index)}>
            <ol {...props(styles.indexList)}>
              {sections.map(({ section, index, id, files }) => {
                const done = files.filter(
                  (file) => input.reviewed(file.path) === "reviewed",
                ).length;

                return (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      aria-current={index === inView ? "location" : undefined}
                      {...props(styles.indexLink)}
                    >
                      <span {...props(styles.indexNumber)}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span {...props(styles.indexTitle)}>{section.title}</span>
                      <span
                        aria-label={`${done} of ${files.length} files reviewed`}
                        {...props(styles.indexCount, done === files.length && styles.indexDone)}
                      >
                        {done === files.length ? (
                          <Icon name="checkmark" size={12} />
                        ) : (
                          `${done}/${files.length}`
                        )}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        {sections.map(({ section, index, id, files }) => (
          <section
            key={id}
            id={id}
            ref={(node) => {
              if (node === null) bands.current.delete(index);
              else bands.current.set(index, node);
            }}
            aria-labelledby={`${id}-title`}
            {...props(styles.band)}
          >
            <div {...props(styles.story)}>
              <span {...props(styles.counter)}>
                <span {...props(styles.counterNow)}>{String(index + 1).padStart(2, "0")}</span> /{" "}
                {total}
              </span>
              <h2 id={`${id}-title`} {...props(styles.sectionTitle)}>
                {section.title}
              </h2>
              <p {...props(styles.explanation)}>{section.explanation}</p>
              <ul aria-label={`Files in ${section.title}`} {...props(styles.fileList)}>
                {files.map((file) => {
                  const name = file.path.split("/").at(-1) ?? file.path;

                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        title={file.path}
                        onClick={() => reveal(file.path)}
                        {...props(styles.fileRow)}
                      >
                        <FileTypeIcon path={file.path} />
                        <span {...props(styles.fileName)}>{name}</span>
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
              {files.map((file, position) => (
                <FileCard
                  key={file.path}
                  file={file}
                  open={position < OPEN_FILES}
                  input={input}
                  register={register}
                />
              ))}
            </div>
          </section>
        ))}
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
    paddingInline: 28,
    paddingBlockEnd: 96,
    scrollPaddingBlockStart: 64,
  },
  intro: { display: "flex", flexDirection: "column", gap: 8, paddingBlock: "20px 24px" },
  title: {
    margin: 0,
    maxWidth: "56ch",
    color: role.contentPrimary,
    fontSize: type.font2xl,
    lineHeight: 1.2,
    fontWeight: 600,
    letterSpacing: type.letterLg,
    textWrap: "balance",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 6,
    rowGap: 2,
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  refs: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
  },
  arrow: { color: role.contentDisabled },
  counts: {
    display: "inline-flex",
    gap: 6,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: role.contentSecondary },
  removed: { color: role.contentSecondary },
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
  statusText: { flex: 1, minWidth: 0, textWrap: "pretty" },
  step: {
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    overflowWrap: "anywhere",
  },
  steps: { paddingInline: 12 },
  index: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    marginInline: -28,
    paddingInline: 28,
    paddingBlock: 8,
    marginBlockEnd: 24,
    backgroundColor: role.bgBase,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  indexList: {
    display: "flex",
    gap: 4,
    margin: 0,
    padding: 0,
    overflowX: "auto",
    listStyle: "none",
    scrollbarWidth: "none",
  },
  indexLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    height: row.heightMd,
    paddingInline: 10,
    borderRadius: radius.control,
    color: {
      default: role.contentSecondary,
      ":hover": role.contentPrimary,
      "[aria-current]": role.contentPrimary,
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
      "[aria-current]": role.bgInteractiveSecondaryTranslucent,
    },
    boxShadow: { default: "none", "[aria-current]": `inset 0 0 0 1px ${role.borderPrimary}` },
    fontSize: type.fontSm,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  indexNumber: {
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  indexTitle: { color: "inherit", fontWeight: 500 },
  indexCount: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: glyph.md,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  indexDone: { color: role.contentSecondary },
  band: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 1fr) minmax(0, 2fr)",
    columnGap: 32,
    alignItems: "start",
    paddingBlockEnd: 72,
    scrollMarginBlockStart: 64,
    "@container (max-width: 760px)": { gridTemplateColumns: "minmax(0, 1fr)", rowGap: 16 },
  },
  story: {
    position: "sticky",
    top: 64,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    minWidth: 0,
    paddingBlockStart: 12,
  },
  counter: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
  },
  counterNow: { color: role.contentPrimary },
  sectionTitle: {
    marginBlock: "10px 0",
    color: role.contentPrimary,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    fontWeight: 600,
    textWrap: "balance",
  },
  explanation: {
    marginBlock: "12px 0",
    maxWidth: "60ch",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: 1.6,
    textWrap: "pretty",
  },
  fileList: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    gap: 6,
    margin: "24px 0 0",
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
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
    font: "inherit",
    fontSize: type.fontSm,
    textAlign: "start",
    cursor: appearance.cursorInteractive,
  },
  fileName: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    fontWeight: 500,
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
    scrollMarginBlockStart: 64,
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
