import { intent } from "@nyte-ai/ui/surface-theme";
import { glyph, row, shape } from "@nyte-ai/ui/schema.stylex";
/**
 * Linear's Guide: one band per section. The left third says what the
 * section changes and why, and lists its files; the right two thirds hold
 * those files' diffs, top-aligned with the section. Core sections come first;
 * order is the only grouping.
 */
import { create, props } from "@stylexjs/stylex";
import type { SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useRef, type ReactElement } from "react";
import { FileTypeIcon, FileTypeIconSprite } from "@nyte-ai/app/components/file-type-icon.tsx";
import { PierreWorkerProvider } from "@nyte-ai/app/pierre-worker-provider.tsx";
import { Icon } from "@nyte-ai/ui/icon";
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
  props: componentProps,
  register,
}: {
  readonly file: ReviewFile;
  readonly props: GuideProps;
  readonly register: (path: string, node: HTMLDivElement | null) => void;
}): ReactElement {
  const options = usePierreOptions("unified");
  const selection = useRef<SelectedLineRange | null>(null);
  const collapsed = componentProps.collapsed(file.path);

  return (
    <div ref={(node) => register(file.path, node)} {...props(styles.card)}>
      <CodeFileHeader
        file={file}
        collapsed={collapsed}
        reviewed={componentProps.reviewed(file.path)}
        justUpdated={componentProps.justUpdated(file.path)}
        onToggle={() => componentProps.onToggle(file.path)}
        onReviewed={(next) => componentProps.onReviewed(file.path, next)}
        onOpenInDiff={() => componentProps.onOpenInDiff(file.path)}
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

                if (range !== null) componentProps.onReference(referenceOf(file, range));
              }}
            />
          )}
          {...props(pierreHost)}
        />
      )}
    </div>
  );
}

export function Guide(componentProps2: GuideProps): ReactElement {
  const cards = useRef(new Map<string, HTMLDivElement>());
  const register = (path: string, node: HTMLDivElement | null): void => {
    if (node === null) cards.current.delete(path);
    else cards.current.set(path, node);
  };
  const total = String(componentProps2.sections.length).padStart(2, "0");

  return (
    <PierreWorkerProvider>
      <div {...props(styles.scroll)}>
        <FileTypeIconSprite />
        <header {...props(styles.intro)}>
          <h1 {...props(styles.title)}>{componentProps2.heading.title}</h1>
          <p {...props(styles.meta)}>
            <span {...props(styles.author)}>{componentProps2.heading.author}</span>
            <span>·</span>
            <span>{componentProps2.heading.number}</span>
            <span>·</span>
            <span {...props(styles.mono)}>
              {componentProps2.heading.base} <span {...props(styles.arrow)}>←</span>{" "}
              {componentProps2.heading.head}
            </span>
          </p>
        </header>
        {componentProps2.sections.map((section, index) => {
          const files = section.paths.flatMap((path) =>
            componentProps2.files.filter((file) => file.path === path),
          );

          return (
            <section key={section.title} {...props(styles.band)}>
              <div {...props(styles.story)}>
                <span {...props(styles.counter)}>
                  <span {...props(styles.counterNow)}>{String(index + 1).padStart(2, "0")}</span> /{" "}
                  {total}
                </span>
                <h2 {...props(styles.sectionTitle)}>{section.title}</h2>
                <p {...props(styles.explanation)}>{section.explanation}</p>
                <div {...props(styles.fileList)}>
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
                        {...props(styles.fileRow)}
                      >
                        <FileTypeIcon path={file.path} />
                        <span {...props(styles.fileName)}>{name}</span>
                        <Counts file={file} />
                        <span {...props(intent.primary, styles.check)}>
                          {componentProps2.reviewed(file.path) === "reviewed" && (
                            <Icon name="checkmark" size={14} />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div {...props(styles.cards)}>
                {files.map((file) => (
                  <GuideCard
                    key={file.path}
                    file={file}
                    props={componentProps2}
                    register={register}
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
  scroll: { flex: 1, minHeight: 0, overflowY: "auto", paddingInline: 28, paddingBlockEnd: 96 },
  intro: { display: "flex", flexDirection: "column", gap: 8, paddingBlock: "20px 36px" },
  title: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.font2xl,
    lineHeight: 1.25,
    fontWeight: 600,
    letterSpacing: type.letterLg,
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  author: { color: role.contentSecondary, fontWeight: 500 },
  mono: { fontFamily: type.fontMono, fontSize: 11.5 },
  arrow: { color: role.contentDisabled },
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
  counter: {
    color: role.contentDisabled,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
  },
  counterNow: { color: role.contentSecondary },
  sectionTitle: {
    marginBlock: "10px 0",
    color: role.contentPrimary,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    fontWeight: 600,
  },
  explanation: {
    marginBlock: "14px 0",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: 1.6,
    userSelect: "text",
  },
  fileList: { display: "flex", flexDirection: "column", gap: 6, marginBlockStart: 24 },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: row.heightLg,
    paddingInline: 10,
    borderStyle: "none",
    borderRadius: shape.control,
    backgroundColor: { default: role.bgMutedTranslucent, ":hover": role.bgHover },
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
  cards: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 },
  card: {
    overflow: "hidden",
    borderRadius: shape.card,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    scrollMarginTop: 16,
  },
});
