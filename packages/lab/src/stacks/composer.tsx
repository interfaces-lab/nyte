import { create, props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { menu, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { describePlan, firstName, readRequest } from "./delegate.ts";
import type { Request } from "./delegate.ts";
import { MODELS } from "./model.ts";
import { propose } from "./staffing.ts";
import type { PullRequest, Stack } from "./model.ts";

const NARROW = "@container stacks (max-width: 639px)";

const styles = create({
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.surface,
    backgroundColor: role.bgElevated,
    boxShadow: {
      default: shadow.shadowMdOutline,
      ":focus-within": `${shadow.shadowMdOutline}, 0 0 0 1px ${role.borderStrongTranslucent}`,
    },
    transitionProperty: "box-shadow",
    transitionDuration: motion.durationFast,
  },
  cardDragging: {
    boxShadow: `${shadow.shadowMdOutline}, 0 0 0 2px ${role.borderInteractivePrimary}`,
  },
  input: {
    fieldSizing: "content",
    minHeight: 64,
    maxHeight: 240,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    resize: "none",
    outline: "none",
    "::placeholder": { color: role.contentTertiary },
  },
  options: {
    display: "flex",
    flexDirection: "column",
    gap: space.px,
    marginInline: space.s2,
    marginBlockEnd: space.s1,
    padding: space.s1,
    listStyle: "none",
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: menu.itemHeight,
    paddingInline: space.s2,
    borderRadius: radius.control,
    color: role.contentPrimary,
    cursor: "pointer",
  },
  optionActive: { backgroundColor: role.bgHover },
  optionGlyph: { display: "inline-flex", flexShrink: 0, color: role.contentSecondary },
  optionLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  optionMeta: { flexShrink: 0, color: role.contentTertiary },
  thumbs: { display: "flex", flexWrap: "wrap", gap: space.s2, paddingInline: space.s3 },
  thumb: { position: "relative", display: "block" },
  thumbImage: {
    display: "block",
    width: 64,
    height: 48,
    borderRadius: radius.control,
    objectFit: "cover",
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  thumbRemove: { position: "absolute", insetBlockStart: -6, insetInlineEnd: -6 },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s2,
    paddingInline: space.s2,
  },
  plan: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    flex: 1,
    minWidth: 0,
    color: role.contentSecondary,
  },
  planText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  planGlyph: { display: "inline-flex", flexShrink: 0, color: role.contentTertiary },
  keyHint: { display: { default: "inline-flex", [NARROW]: "none" } },
});

interface Option {
  readonly id: string;
  readonly insert: string;
  readonly label: string;
  readonly meta: string;
  readonly glyph: ReactElement;
}

/** The `#` or `@` word the caret sits at the end of, if any. */
function tokenAt(
  draft: string,
  caret: number,
): { start: number; mark: string; query: string } | null {
  const match = /(^|\s)([#@])([\w-]*)$/.exec(draft.slice(0, caret));

  if (match === null) return null;
  const query = match[3] ?? "";

  return { start: caret - query.length - 1, mark: match[2] ?? "", query: query.toLowerCase() };
}

/**
 * The only way to start work on a stack: write it. `#` offers open pull requests and `@` the
 * stack's agents; the line under the text says who will do it before you send.
 */
export function Composer({
  stack,
  pulls,
  onSend,
}: {
  readonly stack: Stack;
  readonly pulls: readonly PullRequest[];
  readonly onSend: (request: Request) => void;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [images, setImages] = useState<readonly string[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const read = readRequest(draft, stack, pulls);

  const request: Request | null =
    read ??
    (images.length > 0
      ? {
          kind: "fix",
          text: "Fix what's in the screenshot.",
          pull: null,
          staff: propose(stack, "fix"),
        }
      : null);

  const token = tokenAt(draft, caret);

  const options =
    token === null || token.start === dismissed ? [] : optionsFor(token, stack, pulls);

  const highlighted = options[Math.min(active, options.length - 1)];

  useMountEffect(() => {
    const focusOnSlash = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || editable(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };

    window.addEventListener("keydown", focusOnSlash);

    return () => window.removeEventListener("keydown", focusOnSlash);
  });

  const attach = (files: readonly File[]): void => {
    const added = files.flatMap((file) =>
      file.type.startsWith("image/") ? [URL.createObjectURL(file)] : [],
    );

    if (added.length > 0) setImages((current) => [...current, ...added]);
  };

  const pick = (option: Option): void => {
    if (token === null) return;
    const next = `${draft.slice(0, token.start)}${option.insert} ${draft.slice(caret)}`;
    const at = token.start + option.insert.length + 1;

    setDraft(next);
    setCaret(at);
    setActive(0);
    requestAnimationFrame(() => input.current?.setSelectionRange(at, at));
  };

  const send = (): void => {
    if (request === null) return;
    onSend({ ...request, images });
    setDraft("");
    setCaret(0);
    setImages([]);
  };

  const follow = (element: HTMLTextAreaElement): void => {
    setCaret(element.selectionStart);
    setActive(0);
  };

  return (
    <form
      aria-label={`Delegate to ${stack.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        setDragging(false);
        attach([...event.dataTransfer.files]);
      }}
      {...props(styles.card, dragging && styles.cardDragging)}
    >
      <textarea
        ref={input}
        role="combobox"
        aria-label={`Tell ${stack.name} what to do`}
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          highlighted === undefined ? undefined : `${listId}-${highlighted.id}`
        }
        placeholder={
          dragging
            ? "Drop to attach"
            : `Tell ${stack.name} what to do. # for a pull request, @ for an agent`
        }
        value={draft}
        rows={2}
        onChange={(event) => {
          setDraft(event.target.value);
          setDismissed(null);
          follow(event.target);
        }}
        onSelect={(event) => follow(event.currentTarget)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files];

          if (files.length === 0) return;
          event.preventDefault();
          attach(files);
        }}
        onKeyDown={(event) => {
          if (options.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setActive(
              (current) =>
                (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length,
            );

            return;
          }

          if (highlighted !== undefined && (event.key === "Enter" || event.key === "Tab")) {
            event.preventDefault();
            pick(highlighted);

            return;
          }

          if (event.key === "Escape") {
            if (token !== null && options.length > 0) setDismissed(token.start);
            else event.currentTarget.blur();

            return;
          }

          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          send();
        }}
        {...props(text.base, styles.input)}
      />
      {options.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Suggestions" {...props(styles.options)}>
          {options.map((option) => (
            <li
              key={option.id}
              id={`${listId}-${option.id}`}
              role="option"
              aria-selected={option === highlighted}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
              {...props(text.base, styles.option, option === highlighted && styles.optionActive)}
            >
              <span {...props(styles.optionGlyph)}>{option.glyph}</span>
              <span {...props(styles.optionLabel)}>{option.label}</span>
              <span {...props(text.sm, styles.optionMeta)}>{option.meta}</span>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <div {...props(styles.thumbs)}>
          {images.map((image, index) => (
            <span key={image} {...props(styles.thumb)}>
              <img
                src={image}
                alt={`Attachment ${String(index + 1)}`}
                {...props(styles.thumbImage)}
              />
              <span {...props(styles.thumbRemove)}>
                <Button
                  size="2xs"
                  variant="solid"
                  iconOnly
                  icon="x"
                  aria-label={`Remove attachment ${String(index + 1)}`}
                  onClick={() => setImages((current) => current.filter((entry) => entry !== image))}
                />
              </span>
            </span>
          ))}
        </div>
      )}
      <div {...props(styles.footer)}>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            attach([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
        />
        <Button
          size="sm"
          iconOnly
          icon="paperclip"
          aria-label="Attach a Screenshot"
          onClick={() => picker.current?.click()}
        />
        <span {...props(text.sm, styles.plan)}>
          {request !== null && (
            <>
              <span {...props(styles.planGlyph)}>
                <Icon name="arrow-right" size={12} />
              </span>
              <span {...props(styles.planText)}>{describePlan(request, stack)}</span>
            </>
          )}
        </span>
        <span {...props(styles.keyHint)}>
          <Kbd keys={[request === null ? "/" : "↵"]} />
        </span>
        <Button
          type="submit"
          variant="solid"
          tone="primary"
          size="sm"
          icon="arrow-up"
          iconOnly
          aria-label="Send"
          disabled={request === null}
        />
      </div>
    </form>
  );
}

function optionsFor(
  token: { readonly mark: string; readonly query: string },
  stack: Stack,
  pulls: readonly PullRequest[],
): readonly Option[] {
  if (token.mark === "@")
    return stack.agents
      .filter((agent) => agent.name.toLowerCase().startsWith(token.query))
      .map((agent) => ({
        id: `agent-${agent.id}`,
        insert: `@${agent.name}`,
        label: agent.name,
        meta: `${MODELS[agent.model].name} · ${agent.does}`,
        glyph: <Icon name={MODELS[agent.model].icon} size={14} />,
      }));

  return pulls.flatMap((pull) =>
    String(pull.number).startsWith(token.query) || pull.title.toLowerCase().includes(token.query)
      ? [
          {
            id: `pull-${String(pull.number)}`,
            insert: `#${String(pull.number)}`,
            label: `#${String(pull.number)} ${pull.title}`,
            meta: `${firstName(pull.author.name)} · ${pull.opened}`,
            glyph: (
              <Avatar size="xs" tone={pull.author.tone}>
                <AvatarFallback>{pull.author.initials}</AvatarFallback>
              </Avatar>
            ),
          },
        ]
      : [],
  );
}

export function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}
