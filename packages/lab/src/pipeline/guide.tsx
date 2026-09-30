/**
 * Linear's Guide: one band per section. The left third says what the
 * section changes and why, and lists its files; the right two thirds hold
 * those files' diffs, top-aligned with the section. Core sections come first;
 * order is the only grouping.
 */
import * as stylex from "@stylexjs/stylex";
import type { SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useRef, type ReactElement } from "react";
import { FileTypeIcon, FileTypeIconSprite } from "@nyte-ai/app/components/file-type-icon.tsx";
import { PierreWorkerProvider } from "@nyte-ai/app/pierre-worker-provider.tsx";
import { Icon } from "@nyte-ai/ui/icon";
import { t } from "@nyte-ai/ui/vars.stylex";
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

export interface GuideSection {
  readonly title: string;
  readonly explanation: string;
  readonly paths: readonly string[];
}

export interface GuideProps {
  readonly heading: {
    readonly title: string;
    readonly author: string;
    readonly number: string;
    readonly base: string;
    readonly head: string;
  };
  readonly sections: readonly GuideSection[];
  readonly files: readonly ReviewFile[];
  readonly reviewed: (path: string) => ReviewedState;
  readonly onReviewed: (path: string, reviewed: boolean) => void;
  readonly collapsed: (path: string) => boolean;
  readonly onToggle: (path: string) => void;
  readonly justUpdated: (path: string) => boolean;
  readonly onOpenInDiff: (path: string) => void;
  readonly onReference: (reference: CodeReference) => void;
}

function GuideCard({
  file,
  props,
  register,
}: {
  readonly file: ReviewFile;
  readonly props: GuideProps;
  readonly register: (path: string, node: HTMLDivElement | null) => void;
}): ReactElement {
  const options = usePierreOptions("unified");
  const selection = useRef<SelectedLineRange | null>(null);
  const collapsed = props.collapsed(file.path);

  return (
    <div ref={(node) => register(file.path, node)} {...stylex.props(styles.card)}>
      <CodeFileHeader
        file={file}
        collapsed={collapsed}
        reviewed={props.reviewed(file.path)}
        justUpdated={props.justUpdated(file.path)}
        onToggle={() => props.onToggle(file.path)}
        onReviewed={(next) => props.onReviewed(file.path, next)}
        onOpenInDiff={() => props.onOpenInDiff(file.path)}
      />
      {!collapsed && file.metadata !== undefined && (
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

                if (range !== null) props.onReference(referenceOf(file, range));
              }}
            />
          )}
          {...stylex.props(pierreHost)}
        />
      )}
    </div>
  );
}

export function Guide(props: GuideProps): ReactElement {
  const cards = useRef(new Map<string, HTMLDivElement>());
  const register = (path: string, node: HTMLDivElement | null): void => {
    if (node === null) cards.current.delete(path);
    else cards.current.set(path, node);
  };
  const total = String(props.sections.length).padStart(2, "0");

  return (
    <PierreWorkerProvider>
      <div {...stylex.props(styles.scroll)}>
        <FileTypeIconSprite />
        <header {...stylex.props(styles.intro)}>
          <h1 {...stylex.props(styles.title)}>{props.heading.title}</h1>
          <p {...stylex.props(styles.meta)}>
            <span {...stylex.props(styles.author)}>{props.heading.author}</span>
            <span>·</span>
            <span>{props.heading.number}</span>
            <span>·</span>
            <span {...stylex.props(styles.mono)}>
              {props.heading.base} <span {...stylex.props(styles.arrow)}>←</span>{" "}
              {props.heading.head}
            </span>
          </p>
        </header>
        {props.sections.map((section, index) => {
          const files = section.paths.flatMap((path) =>
            props.files.filter((file) => file.path === path),
          );

          return (
            <section key={section.title} {...stylex.props(styles.band)}>
              <div {...stylex.props(styles.story)}>
                <span {...stylex.props(styles.counter)}>
                  <span {...stylex.props(styles.counterNow)}>
                    {String(index + 1).padStart(2, "0")}
                  </span>{" "}
                  / {total}
                </span>
                <h2 {...stylex.props(styles.sectionTitle)}>{section.title}</h2>
                <p {...stylex.props(styles.explanation)}>{section.explanation}</p>
                <div {...stylex.props(styles.fileList)}>
                  {files.map((file) => {
                    const name = file.path.split("/").at(-1) ?? file.path;

                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() =>
                          cards.current
                            .get(file.path)
                            ?.scrollIntoView({ block: "start", behavior: "smooth" })
                        }
                        {...stylex.props(styles.fileRow)}
                      >
                        <FileTypeIcon path={file.path} />
                        <span {...stylex.props(styles.fileName)}>{name}</span>
                        <Counts file={file} />
                        <span {...stylex.props(styles.check)}>
                          {props.reviewed(file.path) === "reviewed" && (
                            <Icon name="checkmark" size={14} />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div {...stylex.props(styles.cards)}>
                {files.map((file) => (
                  <GuideCard key={file.path} file={file} props={props} register={register} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </PierreWorkerProvider>
  );
}

const styles = stylex.create({
  scroll: { flex: 1, minHeight: 0, overflowY: "auto", paddingInline: 28, paddingBlockEnd: 96 },
  intro: { display: "flex", flexDirection: "column", gap: 8, paddingBlock: "20px 36px" },
  title: {
    margin: 0,
    color: t.contentPrimary,
    fontSize: t.font2xl,
    lineHeight: 1.25,
    fontWeight: 600,
    letterSpacing: t.letterLg,
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    margin: 0,
    color: t.contentSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  author: { color: t.contentSecondary, fontWeight: 500 },
  mono: { fontFamily: t.fontMono, fontSize: 11.5 },
  arrow: { color: t.contentDisabled },
  band: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 1fr) minmax(0, 2fr)",
    columnGap: 32,
    alignItems: "start",
    paddingBlockEnd: 72,
  },
  story: {
    position: "sticky",
    top: 16,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    paddingBlockStart: 12,
  },
  counter: { color: t.contentDisabled, fontSize: t.fontSm, fontVariantNumeric: "tabular-nums" },
  counterNow: { color: t.contentSecondary },
  sectionTitle: {
    marginBlock: "10px 0",
    color: t.contentPrimary,
    fontSize: t.fontLg,
    lineHeight: t.leadingLg,
    fontWeight: 600,
  },
  explanation: {
    marginBlock: "14px 0",
    color: t.contentSecondary,
    fontSize: t.fontBase,
    lineHeight: 1.6,
    userSelect: "text",
  },
  fileList: { display: "flex", flexDirection: "column", gap: 6, marginBlockStart: 24 },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingInline: 10,
    borderStyle: "none",
    borderRadius: t.radius8,
    backgroundColor: { default: t.bgMutedTranslucent, ":hover": t.bgHover },
    boxShadow: `inset 0 0 0 1px ${t.borderSecondaryTranslucent}`,
    color: t.contentPrimary,
    font: "inherit",
    fontSize: t.fontSm,
    textAlign: "start",
    cursor: t.cursorInteractive,
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
    width: 14,
    color: t.intentPrimaryContent,
    flexShrink: 0,
  },
  cards: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 },
  card: {
    overflow: "hidden",
    borderRadius: t.radius12,
    backgroundColor: t.bgBase,
    boxShadow: `0 0 0 1px ${t.borderSecondaryTranslucent}`,
    scrollMarginTop: 16,
  },
});
