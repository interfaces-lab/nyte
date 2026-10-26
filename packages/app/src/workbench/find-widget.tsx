import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, Ref } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Toggle } from "@nyte-ai/ui/toggle";
import { floatingSurfaceStyles } from "@nyte-ai/ui/styles/floating-surface.stylex";
import { layer, space, target as targetSize } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";

export interface FindQuery {
  readonly text: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export interface FindTarget {
  readonly getSnapshot: () => {
    readonly total: number;
    readonly current: number | undefined;
    readonly invalid: boolean;
  };
  readonly subscribe: (listener: () => void) => () => void;
  setQuery(query: FindQuery | undefined): void;
  next(): void;
  previous(): void;
}

export interface ReplaceTarget {
  setReplaceText(text: string): void;
  replace(): void;
  replaceAll(): void;
}

export interface FindWidgetHandle {
  focus(): void;
}

const styles = create({
  widget: {
    position: "absolute",
    insetBlockStart: space.s2,
    insetInlineEnd: space.s4,
    zIndex: layer.workbench,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: space.s1,
    rowGap: space.s1,
    width: `min(440px, calc(100% - 2 * ${space.s4}))`,
    padding: space.s1,
  },
  plain: { gridTemplateColumns: "minmax(0, 1fr) auto" },
  options: {
    display: "flex",
    alignItems: "center",
    gap: space.px,
    marginInlineEnd: `calc(-1 * ${space.s1})`,
  },
  actions: { display: "flex", alignItems: "center", gap: space.px },
  count: {
    minWidth: `calc(${targetSize.min} * 2.5)`,
    paddingInline: space.s1,
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    textAlign: "end",
  },
  quiet: { color: role.contentTertiary },
  replaceSpacer: { gridColumn: 1 },
  replaceActions: { display: "flex", alignItems: "center", gap: space.px },
});

function countLabel(query: string, snapshot: ReturnType<FindTarget["getSnapshot"]>): string {
  if (query === "") return "";

  if (snapshot.invalid) return "Invalid pattern";

  if (snapshot.total === 0) return "No results";

  return `${snapshot.current === undefined ? "?" : String(snapshot.current + 1)} of ${String(snapshot.total)}`;
}

export function FindWidget({
  ref,
  label,
  target,
  replace,
  initialText = "",
  placement,
  onClose,
}: {
  readonly ref?: Ref<FindWidgetHandle>;
  readonly label: string;
  readonly target: FindTarget;
  readonly replace?: {
    readonly target: ReplaceTarget;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
  };
  readonly initialText?: string;
  readonly placement?: StyleXStyles<{ insetBlockStart?: string }>;
  readonly onClose: () => void;
}): ReactElement {
  const findInput = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState<FindQuery>({
    text: initialText,
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });

  const [replaceText, setReplaceText] = useState("");
  const snapshot = useSyncExternalStore(target.subscribe, target.getSnapshot);

  const focus = (): void => {
    findInput.current?.focus();
    findInput.current?.select();
  };

  useImperativeHandle(ref, () => ({ focus }));
  useMountEffect(focus);

  const search = (next: FindQuery): void => {
    setQuery(next);
    target.setQuery(next.text === "" ? undefined : next);
  };

  const count = countLabel(query.text, snapshot);
  const found = snapshot.total > 0;

  return (
    <div
      role="search"
      aria-label={label}
      {...props(
        text.sm,
        floatingSurfaceStyles.popup,
        styles.widget,
        replace === undefined && styles.plain,
        placement,
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      {replace !== undefined && (
        <Button
          iconOnly
          size="sm"
          icon={replace.open ? "chevron-down" : "chevron-right"}
          aria-label="Toggle replace"
          aria-expanded={replace.open}
          onClick={() => replace.onOpenChange(!replace.open)}
        />
      )}
      <InputGroup>
        <Input
          ref={findInput}
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          aria-invalid={snapshot.invalid}
          placeholder="Find"
          value={query.text}
          onValueChange={(value, details) => {
            if (details.event instanceof InputEvent && details.event.isComposing) {
              setQuery({ ...query, text: value });

              return;
            }

            search({ ...query, text: value });
          }}
          onCompositionEnd={(event) => search({ ...query, text: event.currentTarget.value })}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();

            if (event.shiftKey) target.previous();
            else target.next();
          }}
        />
        <div role="group" aria-label="Search options" {...props(styles.options)}>
          <Toggle
            iconOnly
            size="sm"
            aria-label="Match case"
            title="Match case"
            pressed={query.caseSensitive}
            onPressedChange={(caseSensitive) => search({ ...query, caseSensitive })}
          >
            Aa
          </Toggle>
          <Toggle
            iconOnly
            size="sm"
            aria-label="Match whole word"
            title="Match whole word"
            pressed={query.wholeWord}
            onPressedChange={(wholeWord) => search({ ...query, wholeWord })}
          >
            ab
          </Toggle>
          <Toggle
            iconOnly
            size="sm"
            aria-label="Use regular expression"
            title="Use regular expression"
            pressed={query.regex}
            onPressedChange={(regex) => search({ ...query, regex })}
          >
            .*
          </Toggle>
        </div>
      </InputGroup>
      <div {...props(styles.actions)}>
        <span aria-live="polite" {...props(styles.count, !found && styles.quiet)}>
          {count}
        </span>
        <Button
          iconOnly
          icon="arrow-up"
          size="sm"
          aria-label="Previous match"
          aria-keyshortcuts="Shift+Enter"
          disabled={!found}
          onClick={() => target.previous()}
        />
        <Button
          iconOnly
          icon="arrow-down"
          size="sm"
          aria-label="Next match"
          aria-keyshortcuts="Enter"
          disabled={!found}
          onClick={() => target.next()}
        />
        <Button
          iconOnly
          icon="x"
          size="sm"
          aria-label="Close find"
          aria-keyshortcuts="Escape"
          onClick={onClose}
        />
      </div>
      {replace?.open === true && (
        <>
          <span {...props(styles.replaceSpacer)} />
          <InputGroup>
            <Input
              type="text"
              autoComplete="off"
              spellCheck={false}
              aria-label="Replace"
              placeholder="Replace"
              value={replaceText}
              onValueChange={(value) => {
                setReplaceText(value);
                replace.target.setReplaceText(value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();

                if (event.metaKey || event.ctrlKey) replace.target.replaceAll();
                else replace.target.replace();
              }}
            />
          </InputGroup>
          <div {...props(styles.replaceActions)}>
            <Button size="sm" disabled={!found} onClick={() => replace.target.replace()}>
              Replace
            </Button>
            <Button size="sm" disabled={!found} onClick={() => replace.target.replaceAll()}>
              Replace All
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
