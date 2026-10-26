import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { avatar, radius, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { describePlan, firstName, readRequest } from "./delegate.ts";
import type { Request } from "./delegate.ts";
import type { PullRequest, Stack } from "./model.ts";
import { styles as parts } from "./parts.tsx";

const NARROW = "@container stacks (max-width: 639px)";

const styles = create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s3 },
  card: {
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
  pull: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    marginInline: space.s3,
    paddingBlock: space.s1_5,
    paddingInline: space.s2,
    borderRadius: radius.control,
    backgroundColor: role.bgMuted,
    color: role.contentSecondary,
    minWidth: 0,
  },
  pullTitle: {
    color: role.contentPrimary,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
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
  suggestions: { display: "flex", flexDirection: "column", gap: space.s1 },
  suggestion: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s2,
    rowGap: space.s1_5,
    minHeight: row.heightLg,
    paddingInline: space.s2,
    paddingBlock: { default: 0, [NARROW]: space.s1_5 },
    borderRadius: radius.control,
    color: role.contentSecondary,
  },
  suggestionText: {
    flex: "1 1 0",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: { default: "nowrap", [NARROW]: "normal" },
  },
  suggestionActions: {
    display: "flex",
    gap: space.s1_5,
    flexBasis: { default: "auto", [NARROW]: "100%" },
    paddingInlineStart: { default: 0, [NARROW]: `calc(${avatar.xs} + ${space.s2})` },
  },
  keyHint: { display: { default: "inline-flex", [NARROW]: "none" } },
  strong: { color: role.contentPrimary },
});

export function Composer({
  stack,
  pulls,
  receipt,
  onSend,
}: {
  readonly stack: Stack;
  readonly pulls: readonly PullRequest[];
  readonly receipt: ReactNode;
  readonly onSend: (request: Request) => void;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<readonly string[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const read = readRequest(draft, pulls);

  const request =
    read ??
    (images.length > 0 ? { kind: "fix" as const, text: "Fix what's in the screenshot." } : null);

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

  const send = (): void => {
    if (request === null) return;
    onSend({ ...request, images });
    setDraft("");
    setImages([]);
  };

  return (
    <div {...props(styles.wrap)}>
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
          event.preventDefault();
          setDragging(false);
          attach([...event.dataTransfer.files]);
        }}
        {...props(styles.card, dragging && styles.cardDragging)}
      >
        <textarea
          ref={input}
          aria-label={`Tell ${stack.name} what to do`}
          placeholder={
            dragging ? "Drop to attach" : `Tell ${stack.name} what to fix, or paste a pull request`
          }
          value={draft}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];

            if (files.length === 0) return;
            event.preventDefault();
            attach(files);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.blur();

              return;
            }

            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
          {...props(text.base, styles.input)}
        />
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
                    onClick={() =>
                      setImages((current) => current.filter((entry) => entry !== image))
                    }
                  />
                </span>
              </span>
            ))}
          </div>
        )}
        {read !== null && read.kind !== "fix" && <PullLine pull={read.pull} />}
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
            aria-label="Attach a screenshot"
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
      {receipt}
      {draft === "" && pulls.length > 0 && (
        <div {...props(styles.suggestions)}>
          <span {...props(parts.group)}>Opened by your team</span>
          {pulls.map((pull) => (
            <div key={pull.number} {...props(text.base, styles.suggestion)}>
              <Avatar size="xs" tone={pull.author.tone}>
                <AvatarFallback>{pull.author.initials}</AvatarFallback>
              </Avatar>
              <span {...props(styles.suggestionText)}>
                {firstName(pull.author.name)} opened{" "}
                <span {...props(styles.strong)}>
                  #{pull.number} {pull.title}
                </span>{" "}
                · {pull.opened}
              </span>
              <span {...props(styles.suggestionActions)}>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    onSend({ kind: "review", text: `Review #${String(pull.number)} for UI`, pull })
                  }
                >
                  Review UI
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  icon="eye"
                  onClick={() =>
                    onSend({
                      kind: "babysit",
                      text: `Babysit #${String(pull.number)} until it merges`,
                      pull,
                    })
                  }
                >
                  Babysit
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function PullLine({ pull }: { readonly pull: PullRequest }): ReactElement {
  return (
    <div {...props(text.sm, styles.pull)}>
      <Icon name="pull-request" size={14} />
      <span {...props(styles.pullTitle)}>
        #{pull.number} {pull.title}
      </span>
      <span>· {pull.author.name}</span>
    </div>
  );
}
