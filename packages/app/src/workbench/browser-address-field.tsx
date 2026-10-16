import { layer, menu, space } from "@nyte-ai/ui/styles/schema.stylex";
import { floatingSurfaceStyles } from "@nyte-ai/ui/styles/floating-surface.stylex";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useId, useImperativeHandle, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactElement, ReactNode, Ref } from "react";
import { flushSync } from "react-dom";
import type { BrowserHistoryEntry } from "../bridge.ts";
import { displayAddress, resolveBrowserAddress } from "./browser-address.ts";
import { browserSuggestions } from "./browser-suggestions.ts";
import type { BrowserCompletion, BrowserSuggestion } from "./browser-suggestions.ts";

const styles = create({
  form: {
    position: "relative",
    display: "flex",
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    marginInline: space.s1,
  },
  wrap: { flex: 1, paddingInline: space.s2 },
  list: {
    position: "absolute",
    insetInline: 0,
    top: "100%",
    zIndex: layer.menu,
    display: "flex",
    flexDirection: "column",
    marginTop: space.s1,
    padding: menu.padding,
    borderRadius: menu.radius,
    color: role.contentPrimary,
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: menu.itemGap,
    minWidth: 0,
    minHeight: menu.itemHeight,
    paddingBlock: menu.itemPaddingBlock,
    paddingInline: menu.itemPaddingInline,
    borderRadius: menu.itemRadius,
    backgroundColor: {
      default: "transparent",
      ":hover": role.bgHover,
      "[aria-selected=true]": role.bgHover,
    },
    cursor: "default",
    userSelect: "none",
  },
  icon: { display: "inline-flex", flexShrink: 0, color: role.contentSecondary },
  label: {
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail: {
    flexShrink: 2,
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

const ICONS = { go: "globe", search: "search", history: "clock", bookmark: "pin" } as const;

function optionLabel(row: BrowserSuggestion): string {
  if (row.kind === "go") return `Go to ${row.label}`;

  if (row.kind === "search") return `Search for ${row.label}`;

  return row.label || displayAddress(row.url);
}

function optionAddress(row: BrowserSuggestion): string {
  return row.kind === "search" ? row.label : displayAddress(row.url);
}

export interface AddressFieldHandle {
  focus(): void;
}

export function AddressField({
  ref,
  currentUrl,
  draft,
  onDraftChange,
  history,
  bookmarks,
  onOpen,
  onForget,
  onDismiss,
  children,
}: {
  readonly ref: Ref<AddressFieldHandle>;
  readonly currentUrl: string;
  readonly draft: string | undefined;
  readonly onDraftChange: (draft: string | undefined) => void;
  readonly history: readonly BrowserHistoryEntry[];
  readonly bookmarks: readonly { readonly url: string; readonly title: string }[];
  readonly onOpen: (url: string) => void;
  readonly onForget: (url: string) => void;
  readonly onDismiss: () => void;
  readonly children?: ReactNode;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [edited, setEdited] = useState(false);
  const [complete, setComplete] = useState(false);
  const [active, setActive] = useState(-1);
  const [previewing, setPreviewing] = useState(false);
  const [now, setNow] = useState(0);
  const [accepted, setAccepted] = useState<BrowserCompletion>();

  const typed = draft !== undefined && edited ? draft : "";

  const { rows, completion } = browserSuggestions({
    text: typed,
    complete,
    accepted,
    current: currentUrl,
    history,
    bookmarks,
    now,
  });

  const shown = open && draft !== undefined && rows.length > 0;
  const selected = shown ? rows[active] : undefined;
  const preview = previewing ? selected : undefined;

  const value =
    preview !== undefined
      ? optionAddress(preview)
      : draft === undefined
        ? displayAddress(currentUrl)
        : (completion?.text ?? draft);

  const selectCompletion = (typedText: string): void => {
    const field = inputRef.current;

    if (field === null || field.value.length <= typedText.length) return;

    if (field.value.toLowerCase().startsWith(typedText.toLowerCase()))
      field.setSelectionRange(typedText.length, field.value.length);
  };

  const close = (): void => {
    setOpen(false);
    setActive(-1);
    setPreviewing(false);
    setComplete(false);
  };

  const go = (url: string): void => {
    inputRef.current?.blur();
    onOpen(url);
  };

  const accept = (taken: BrowserCompletion): void => {
    onDraftChange(taken.text);
    setAccepted(taken);
    setComplete(false);
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
      setOpen(true);
    },
  }));

  const move = (step: number): void => {
    const floor = typed === "" ? -1 : 0;
    const next = Math.min(rows.length - 1, Math.max(floor, active + step));
    flushSync(() => {
      setActive(next);
      setPreviewing(next >= 0 && (typed === "" || next > 0));
    });

    if (next <= 0 && typed !== "") selectCompletion(typed);
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (draft === undefined) return;
        event.preventDefault();

        if (shown) move(event.key === "ArrowDown" ? 1 : -1);
        else setOpen(true);

        return;
      case "Enter":
        if (selected === undefined) return;
        event.preventDefault();
        go(selected.url);

        return;
      case "Tab":
      case "ArrowRight":
        if (preview !== undefined || completion === undefined || event.shiftKey) return;

        if (event.key === "Tab") event.preventDefault();
        accept(completion);

        return;
      case "Delete":
        if (!event.shiftKey || preview?.kind !== "history") return;
        event.preventDefault();
        onForget(preview.url);
        setPreviewing(false);
        setActive(typed === "" ? -1 : 0);

        return;
      case "Escape":
        event.preventDefault();

        if (shown) {
          close();

          return;
        }

        onDraftChange(undefined);
        event.currentTarget.blur();
        onDismiss();

        return;
      default:
    }
  };

  const change = (next: string, event: Event): void => {
    const field = inputRef.current;

    const inserted =
      event instanceof InputEvent &&
      !event.isComposing &&
      event.inputType.startsWith("insert") &&
      field !== null &&
      field.selectionEnd === next.length;

    flushSync(() => {
      onDraftChange(next);
      setEdited(true);
      setComplete(inserted);
      setOpen(true);
      setActive(next.trim() === "" ? -1 : 0);
      setPreviewing(false);
    });

    if (inserted) selectCompletion(next);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const target =
      accepted !== undefined && accepted.text === draft
        ? accepted.url
        : resolveBrowserAddress(draft ?? "");

    if (target !== undefined) go(target);
  };

  return (
    <form {...props(styles.form)} onSubmit={submit}>
      <InputGroup xstyle={styles.wrap}>
        {children}
        <Input
          ref={inputRef}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-label="Address"
          aria-autocomplete="both"
          aria-expanded={shown}
          aria-controls={shown ? listId : undefined}
          aria-activedescendant={selected === undefined ? undefined : `${listId}-${active}`}
          placeholder="Search or enter address"
          value={value}
          onFocus={(event) => {
            flushSync(() => {
              onDraftChange(currentUrl);
              setEdited(false);
              setComplete(false);
              setOpen(true);
              setActive(-1);
              setPreviewing(false);
              setNow(Date.now());
              setAccepted(undefined);
            });
            event.currentTarget.select();
          }}
          onBlur={() => {
            onDraftChange(undefined);
            close();
          }}
          onClick={() => setOpen(true)}
          onValueChange={(next, details) => change(next, details.event)}
          onCompositionEnd={(event) => {
            const field = event.currentTarget;
            const text = field.value;

            if (event.data === "" || field.selectionEnd !== text.length) return;
            flushSync(() => setComplete(true));
            selectCompletion(text);
          }}
          onKeyDown={keyDown}
        />
      </InputGroup>
      {shown && (
        <div
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          data-slot="browser-suggestions"
          {...props(floatingSurfaceStyles.popup, styles.list)}
        >
          {rows.map((row, index) => (
            <div
              key={`${row.kind} ${row.url}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              title={row.url}
              {...props(text.base, styles.option)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(row.url)}
            >
              <span {...props(styles.icon)}>
                <Icon name={ICONS[row.kind]} size={13} />
              </span>
              <span {...props(styles.label)}>{optionLabel(row)}</span>
              {(row.kind === "history" || row.kind === "bookmark") && row.label !== "" && (
                <span {...props(text.sm, styles.detail)}>{displayAddress(row.url)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
