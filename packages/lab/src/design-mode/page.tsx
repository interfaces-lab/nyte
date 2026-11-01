import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { glyph, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { DISPLAY_MODES, useDisplayMode, type DisplayMode } from "../shell/display-mode";
import { agentText, labelParts, recordComment, splitLabel } from "./picker";
import type { CommentRecord, Target } from "./picker";
import { BrowserPanel } from "./browser";
import { design } from "./design.stylex";
import type { Draft, Placement, QueuedComment } from "./layer";
import { SITE_URL } from "./site";

const PLACEMENTS = [
  { value: "page", label: "On the Page" },
  { value: "chat", label: "In the Chat" },
] as const satisfies readonly { readonly value: Placement; readonly label: string }[];

/** How much of an element's text a comment quotes after its chip. */
const QUOTE_CHARS = 80;

interface Message {
  readonly id: number;
  readonly records: readonly CommentRecord[];
  readonly text: string;
  readonly agent: string;
}

/** Comments join the chat composer and wait there; only Send sends. */
export function DesignModePage(): ReactElement {
  const [scheme, setScheme] = useState<DisplayMode>("light");
  const [placement, setPlacement] = useState<Placement>("page");
  const [active, setActive] = useState(false);
  const [comments, setComments] = useState<readonly QueuedComment[]>([]);
  const [composer, setComposer] = useState("");
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  useDisplayMode(scheme);

  const id = (): number => {
    nextId.current += 1;

    return nextId.current;
  };

  const send = (
    items: readonly {
      readonly number: number;
      readonly target: Target;
      readonly comment: string;
    }[],
    text: string,
  ): void => {
    const root = rootRef.current;

    if (root === null) return;
    const records = items.map((item) => recordComment({ ...item, url: SITE_URL }, root));

    setMessages([...messages, { id: id(), records, text, agent: agentText(records, text) }]);
  };

  const addToChat = (target: Target, comment: string): void => {
    const number = Math.max(0, ...comments.map((queued) => queued.number)) + 1;

    setComments([...comments, { id: id(), number, target, comment }]);
  };

  const save = (draft: Draft): void => {
    const commentId = draft.commentId;

    if (commentId === undefined) {
      addToChat(draft.target, draft.comment);

      return;
    }

    setComments(
      comments.map((comment) =>
        comment.id === commentId
          ? { ...comment, target: draft.target, comment: draft.comment }
          : comment,
      ),
    );
  };

  const sendComposer = (): void => {
    const text = composer.trim();

    if (text === "" && comments.length === 0) return;
    send(comments, text);
    setComments([]);
    setComposer("");
  };

  return (
    <main {...props(styles.page)}>
      <div {...props(styles.column)}>
        <header {...props(styles.header)}>
          <h1 {...props(styles.title)}>Design Mode</h1>
          <p {...props(styles.lede)}>
            Point at something on a page and tell the agent what to change. Turn on Design Mode,
            click an element or drag an area, and write a comment. Return adds it to the chat
            composer; Send sends everything there. Each comment reaches the agent with the
            element&apos;s facts, your words, and a screenshot of the spot. The selection, label and
            comment field follow react-grab.
          </p>
        </header>

        <div {...props(styles.toolbar)}>
          <Choice label="Appearance">
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
          </Choice>
          <Choice label="Write the comment">
            <ToggleGroup
              aria-label="Write the comment"
              value={[placement]}
              onValueChange={(values) => {
                const next = PLACEMENTS.find((entry) => entry.value === values.at(-1));

                if (next !== undefined) setPlacement(next.value);
              }}
            >
              {PLACEMENTS.map((entry) => (
                <Toggle key={entry.value} value={entry.value} size="sm">
                  {entry.label}
                </Toggle>
              ))}
            </ToggleGroup>
          </Choice>
        </div>

        <div {...props(styles.window)}>
          <BrowserPanel
            rootRef={rootRef}
            active={active}
            onActiveChange={setActive}
            placement={placement}
            comments={comments}
            onSave={save}
            onRemove={(removed) =>
              setComments(comments.filter((comment) => comment.id !== removed))
            }
            onAttach={(target) => {
              addToChat(target, "");
              requestAnimationFrame(() => composerRef.current?.focus());
            }}
          />

          <aside aria-label="Chat" {...props(styles.chat)}>
            <div {...props(styles.messages)}>
              {messages.length === 0 ? (
                <p {...props(styles.empty)}>
                  Comments you send land here, with what the agent would read under each one.
                </p>
              ) : (
                messages.map((message) => <SentMessage key={message.id} message={message} />)
              )}
            </div>
            <div {...props(styles.composer)}>
              {comments.length > 0 && (
                <ol aria-label="Comments" {...props(styles.rows)}>
                  {comments.map((comment) => (
                    <ComposerRow
                      key={comment.id}
                      comment={comment}
                      numbered={comments.length > 1}
                      onRemove={() =>
                        setComments(comments.filter((other) => other.id !== comment.id))
                      }
                    />
                  ))}
                </ol>
              )}
              <textarea
                ref={composerRef}
                aria-label="Message"
                placeholder={
                  comments.length > 0 ? "Add a message, or send as is" : "Ask, or point at the page"
                }
                rows={2}
                value={composer}
                {...props(styles.input)}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                    return;
                  }

                  event.preventDefault();
                  sendComposer();
                }}
              />
              <div {...props(styles.composerActions)}>
                <Button
                  size="sm"
                  variant="solid"
                  disabled={composer.trim() === "" && comments.length === 0}
                  onClick={sendComposer}
                >
                  Send
                </Button>
              </div>
            </div>
          </aside>
        </div>

        <section {...props(styles.notes)}>
          <h2 {...props(styles.notesTitle)}>Design notes</h2>
          <ul {...props(styles.list)}>
            <Note title="Where the overlay lives">
              Nyte&apos;s page is a native view painted above the app, so nothing in the app can
              draw over it, and the overlay has to live inside the page. The canvas, the label, the
              comment field and the markers all go in a closed shadow root inside the page, built by
              the page preload. Here the page is plain DOM and the overlay sits over it, taking
              every pointer event as the in-page one would, so links and buttons never fire while
              Design Mode is on.
            </Note>
            <Note title="Selection, after react-grab">
              Boxes are drawn on one canvas: 1 px strokes inset half a pixel, the element&apos;s own
              corner radius, and react-grab&apos;s alphas (0.5 stroke and 0.08 fill on hover, 0.4
              and 0.05 while dragging). The hover box glides to the next element, closing 95% of the
              gap per 60 Hz frame, scaled to the real frame time. While a comment is open, a 50 px
              inner glow marks the page as held. The colour is Nyte&apos;s blue, not
              react-grab&apos;s magenta.
            </Note>
            <Note title="The label">
              A surface that hangs under the element by an 8 px arrow, centred on the cursor, pushed
              back inside the page 8 px from its edges, and flipped above when there is no room
              below. The arrow keeps pointing at the cursor when the label is pushed. The tag reads
              first in 13 px medium, with the class or id dimmed after it.
            </Note>
            <Note title="X-ray">
              React-grab has no X-ray; this one is built from its drawing. It outlines every element
              in view at a quarter of the hover stroke, on the same canvas, so hundreds of boxes
              cost one layer and never touch the page&apos;s CSS. While dragging, the elements the
              area wholly covers light up at hover strength.
            </Note>
            <Note title="Picking">
              A hit skips up to five SVG parts and inline text tags (span, strong, em…) to the
              element it stands for, unless that element is interactive or has an id. ↑ climbs to
              the next such ancestor and ↓ steps back down the same path, never into an unrelated
              child. Moving to a new element resets the path. Shift-click adds or removes elements
              from the comment.
            </Note>
            <Note title="Areas">
              A press becomes a drag after 5 px. An area under 12 × 12 px is dropped, not turned
              into a click. An area carries its rectangle, the element at its centre as an anchor,
              and a screenshot; it doesn&apos;t list everything inside.
            </Note>
            <Note title="Writing the comment">
              On the page, the label grows into the field, as in react-grab: the tag stays on top, a
              hairline, then a 13 px field that grows to 95 px and a 16 px round button. Return, or
              the button, adds the comment to the chat; nothing is sent from the page, so several
              comments can go out together. Esc lets go. In the chat, a pick skips the field and
              lands in the composer with the cursor, and you write there.
            </Note>
            <Note title="The composer is the queue">
              Each comment is a line in the composer: the element&apos;s chip, a quote of its first
              80 characters of text, then what you asked for. Several elements join with +; an area
              reads as a screenshot region; several comments are numbered, matching the markers on
              the page. Remove a line and its marker goes; click a marker to edit the line. Send
              sends them all, with whatever you typed under them. Here the chips are rows above a
              plain field, not inline in a rich text editor.
            </Note>
            <Note title="Surviving a reload">
              A comment holds each element as an anchor: the live node, and its facts from when it
              was picked. A reload replaces every node, so the anchor finds its element again by
              selector, and the match only counts if it still reads as the same tag and class. A
              selector that now lands on something else counts as gone. Comments whose elements are
              all gone stay in the queue without a marker, and the tray says how many weren&apos;t
              found. Sent anyway, they carry the facts from when they were written, marked as not on
              the page now. An open comment on a lost element lets go. Area comments always survive:
              their rectangle is in page coordinates. Try it: comment on Accept All Cookies, close
              the banner, then reload.
            </Note>
            <Note title="What the agent reads">
              Each element becomes an excerpt with its label, a unique selector, visible text,
              bounds, the first six attributes and up to 600 characters of HTML. That is less than
              the 4,000 characters the current picker sends. Elements crop with 48 px padding, at
              least 120 × 120. Area screenshots crop to the area. Here the image is only named; the
              product attaches a capturePage crop.
            </Note>
            <Note title="Responsive mode">
              Presets, rotate and Fit size the page frame. In Nyte that frame would come from
              webContents.enableDeviceEmulation, which VS Code uses because the CDP metrics override
              crashes Electron. Agent clicks then need scaling into the emulated viewport.
            </Note>
          </ul>
        </section>
      </div>
    </main>
  );
}

interface ChipSpec {
  readonly key: string;
  readonly name: string;
  readonly detail: string;
  readonly title: string;
  readonly missing: boolean;
}

/**
 * One comment as it reads in the composer: the element's chip, then what you asked
 * for. Several elements sit side by side, an area reads as a screenshot region, and several
 * comments carry the numbers of their markers on the page.
 */
function CommentLine({
  number,
  chips,
  comment,
}: {
  readonly number: number | undefined;
  readonly chips: readonly ChipSpec[];
  readonly comment: string;
}): ReactElement {
  return (
    <span {...props(styles.line)}>
      {number !== undefined && <span {...props(styles.number)}>{number}</span>}
      <span {...props(styles.lineText)}>
        {chips.map((chip) => (
          <span
            key={chip.key}
            title={chip.title}
            {...props(styles.chip, chip.missing && styles.chipMissing)}
          >
            <span {...props(styles.chipIcon)}>
              <Icon name="bezier-pointer" size="xs" />
            </span>
            {chip.name}
            {chip.detail !== "" && <span {...props(styles.chipDetail)}>{chip.detail}</span>}
          </span>
        ))}
        {comment}
      </span>
    </span>
  );
}

function ComposerRow({
  comment,
  numbered,
  onRemove,
}: {
  readonly comment: QueuedComment;
  readonly numbered: boolean;
  readonly onRemove: () => void;
}): ReactElement {
  const target = comment.target;

  const chips: readonly ChipSpec[] =
    target.kind === "region"
      ? [
          {
            key: "region",
            name: "Screenshot region",
            detail: labelParts(target).detail,
            title: "An area of the page",
            missing: false,
          },
        ]
      : target.anchors.map((anchor, index) => ({
          key: String(index),
          ...labelParts({ kind: "element", anchors: [anchor] }),
          title: anchor.facts.text.slice(0, QUOTE_CHARS),
          missing: false,
        }));

  return (
    <li {...props(styles.row)}>
      <CommentLine
        number={numbered ? comment.number : undefined}
        chips={chips}
        comment={comment.comment}
      />
      <Button
        iconOnly
        size="2xs"
        icon="x"
        aria-label={`Remove Comment ${String(comment.number)}`}
        onClick={onRemove}
      />
    </li>
  );
}

function SentMessage({ message }: { readonly message: Message }): ReactElement {
  return (
    <article {...props(styles.message)}>
      <div {...props(styles.bubble)}>
        {message.records.map((record) => (
          <CommentLine
            key={record.number}
            number={message.records.length > 1 ? record.number : undefined}
            chips={recordChips(record)}
            comment={record.comment}
          />
        ))}
        {message.text !== "" && <p {...props(styles.bubbleText)}>{message.text}</p>}
      </div>
      <details {...props(styles.details)}>
        <summary {...props(styles.summary)}>What the agent reads</summary>
        <pre {...props(styles.pre)}>{message.agent}</pre>
      </details>
    </article>
  );
}

function recordChips(record: CommentRecord): readonly ChipSpec[] {
  if (record.target.kind === "region") {
    return [
      {
        key: "region",
        name: "Screenshot region",
        detail: `${String(Math.round(record.target.rect.width))} × ${String(Math.round(record.target.rect.height))}`,
        title: "An area of the page",
        missing: false,
      },
    ];
  }

  return record.target.elements.map((facts, index) => ({
    key: String(index),
    ...splitLabel(facts.label),
    title: facts.found ? facts.text.slice(0, QUOTE_CHARS) : "Not on the page now",
    missing: !facts.found,
  }));
}

function Choice({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <div {...props(styles.choice)}>
      <span {...props(styles.choiceLabel)}>{label}</span>
      {children}
    </div>
  );
}

function Note({
  title,
  children,
}: {
  readonly title: string;
  readonly children: string | readonly (string | ReactElement)[];
}): ReactElement {
  return (
    <li {...props(styles.note)}>
      <span {...props(styles.noteTitle)}>{title}</span>
      <span>{children}</span>
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
  window: {
    display: "flex",
    gap: 8,
    height: 760,
    padding: 8,
    borderRadius: radius.card,
    backgroundColor: role.sidebarMaterial,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  chat: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    width: 360,
    minHeight: 0,
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  messages: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 16,
  },
  empty: {
    margin: "auto 0",
    color: role.contentTertiary,
    fontSize: type.fontSm,
    textAlign: "center",
    textWrap: "balance",
  },
  message: { display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" },
  bubble: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    maxWidth: "92%",
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  bubbleText: { margin: 0 },
  details: { alignSelf: "stretch" },
  summary: {
    color: role.contentTertiary,
    fontSize: type.fontXs,
    textAlign: "end",
    cursor: "pointer",
  },
  pre: {
    margin: 0,
    marginBlockStart: 6,
    maxHeight: 280,
    overflow: "auto",
    padding: 10,
    borderRadius: radius.control,
    backgroundColor: role.bgMuted,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: 11,
    lineHeight: "16px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  composer: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: 8,
    padding: 8,
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimary}`,
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: 0,
    paddingBlockEnd: 6,
    paddingInline: 0,
    listStyle: "none",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  row: { display: "flex", alignItems: "flex-start", gap: 4 },
  line: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    flex: 1,
    minWidth: 0,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  lineText: { flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  number: {
    display: "inline-grid",
    placeItems: "center",
    width: glyph.md,
    height: glyph.md,
    flexShrink: 0,
    marginBlockStart: 1,
    borderRadius: "50%",
    backgroundColor: design.accent,
    color: "white",
    fontSize: 10,
    fontWeight: type.weightSemibold,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    marginInlineEnd: 6,
    paddingBlock: 1,
    paddingInline: 6,
    borderRadius: radius.indicator,
    backgroundColor: `color-mix(in srgb, ${role.contentPrimary} 5%, transparent)`,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: type.weightMedium,
    whiteSpace: "nowrap",
  },
  chipIcon: { display: "inline-flex", color: design.accent },
  chipDetail: { color: role.contentTertiary, fontWeight: type.weightRegular },
  chipMissing: { opacity: 0.55, textDecorationLine: "line-through" },
  input: {
    width: "100%",
    padding: 0,
    borderStyle: "none",
    outline: "none",
    resize: "none",
    backgroundColor: "transparent",
    color: "inherit",
    fontFamily: "inherit",
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  composerActions: { display: "flex", justifyContent: "flex-end" },
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
  note: { display: "flex", flexDirection: "column", gap: 4 },
  noteTitle: { color: role.contentPrimary, fontWeight: type.weightSemibold },
});
