import { create, props } from "@stylexjs/stylex";
import { useContext, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireTitle,
} from "@nyte-ai/ui/questionnaire";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { Tray, trayParts, useTrayRoot } from "./tray.tsx";
import { QuestionDockContext } from "./questions-state.ts";
import type { QuestionDock } from "./questions-state.ts";

const styles = create({
  list: { gap: space.s3, paddingTop: space.s1_5, paddingBottom: space.s1_5 },
  cardHeight: (height: number) => ({ maxHeight: height }),
  header: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: space.s2,
    paddingInlineEnd: space.s1_5,
  },
  summary: { flex: 1 },
  progress: { display: "flex", alignItems: "center", gap: space.px },
  choices: { flex: "1 1 auto", overflowY: "auto", overscrollBehavior: "contain" },
  footer: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    paddingInline: space.s1_5,
    paddingBottom: space.s1_5,
  },
  actions: { display: "flex", alignItems: "center", gap: space.s2 },
});

function QuestionCard({
  dock,
  disabled,
  availableHeight,
}: {
  readonly dock: QuestionDock;
  readonly disabled: boolean;
  readonly availableHeight: number;
}): ReactElement {
  const id = useId();
  const [collapsed, setCollapsed] = useState(false);
  const blocked = disabled || dock.pending || dock.settled;
  const multiple = dock.field.multiple === true;
  const fieldName = `${dock.request.part}:${dock.current}`;
  const form = useRef<HTMLFormElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    const element = form.current;

    if (restoreFocus.current)
      element
        ?.querySelector<HTMLInputElement>("input:not(:disabled)")
        ?.focus({ preventScroll: true });

    return () => {
      restoreFocus.current = element?.contains(document.activeElement) ?? false;
    };
  }, [fieldName]);

  return (
    <Questionnaire
      key={fieldName}
      ref={form}
      aria-labelledby={`${id}-title`}
      item={fieldName}
      items={[
        {
          name: fieldName,
          required: false,
          choices: dock.field.options.map((_, index) => ({
            value: String(index),
            disabled: blocked,
          })),
        },
      ]}
      shortcuts={collapsed ? undefined : "numbers"}
      onSubmit={(event) => {
        event.preventDefault();

        if (!blocked) void dock.advance().catch(() => undefined);
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || blocked || event.repeat || event.nativeEvent.isComposing)
          return;

        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "Enter") {
          event.preventDefault();
          void dock.advance().catch(() => undefined);
        } else if (event.key === "Escape") {
          event.preventDefault();
          void dock.dismiss().catch(() => undefined);
        }
      }}
      xstyle={styles.cardHeight(availableHeight)}
    >
      <QuestionnaireItem
        name={fieldName}
        multiple={multiple}
        required={false}
        aria-labelledby={`${id}-title`}
      >
        <div {...props(styles.header)}>
          <QuestionnaireDescription render={<span />} xstyle={styles.summary}>
            {dock.total === 1 ? "Question" : `${dock.current + 1} of ${dock.total} questions`}
          </QuestionnaireDescription>
          {dock.total > 1 && (
            <div {...props(styles.progress)}>
              {dock.request.questions.map((field, index) => (
                <Button
                  key={index}
                  size="2xs"
                  iconOnly
                  icon={dock.answered[index] ? "checkmark" : undefined}
                  variant={index === dock.current ? "outline" : "plain"}
                  aria-label={`${field.header}, question ${index + 1}`}
                  aria-current={index === dock.current ? "step" : undefined}
                  disabled={blocked}
                  onClick={() => dock.jump(index)}
                >
                  {dock.answered[index] ? undefined : index + 1}
                </Button>
              ))}
            </div>
          )}
          <Button
            size="2xs"
            iconOnly
            icon={collapsed ? "chevron-right" : "chevron-down"}
            aria-label={collapsed ? "Show choices" : "Hide choices"}
            aria-expanded={!collapsed}
            disabled={blocked}
            onClick={() => setCollapsed(!collapsed)}
          />
        </div>
        <QuestionnaireTitle render={<h2 />} id={`${id}-title`} aria-live="polite" aria-atomic>
          {dock.field.question}
        </QuestionnaireTitle>
        {dock.origin !== undefined && (
          <QuestionnaireDescription>Asked by {dock.origin}</QuestionnaireDescription>
        )}
        <QuestionnaireChoices
          hidden={collapsed || dock.field.options.length === 0}
          role={multiple ? "group" : "radiogroup"}
          aria-labelledby={`${id}-title`}
          aria-busy={dock.pending}
          xstyle={styles.choices}
        >
          {dock.field.options.map((option, index) => (
            <QuestionnaireChoice
              key={option.label}
              value={String(index)}
              checked={dock.isSelected(option.label)}
              disabled={blocked}
              onChange={() => dock.select(option.label)}
            >
              <span>{option.label}</span>
              {option.description !== "" && (
                <QuestionnaireChoiceDescription>
                  {option.description}
                </QuestionnaireChoiceDescription>
              )}
            </QuestionnaireChoice>
          ))}
        </QuestionnaireChoices>
        <div {...props(styles.footer)}>
          <Button
            size="sm"
            disabled={blocked}
            onClick={() => void dock.dismiss().catch(() => undefined)}
          >
            Dismiss
          </Button>
          <div {...props(styles.actions)}>
            {dock.current > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={blocked}
                onClick={() => dock.jump(dock.current - 1)}
              >
                Back
              </Button>
            )}
            <Button
              size="sm"
              variant={dock.last ? "solid" : "outline"}
              type="button"
              onClick={() => void dock.advance().catch(() => undefined)}
              disabled={blocked}
              aria-keyshortcuts="Meta+Enter Control+Enter"
            >
              {dock.last ? "Submit" : "Next"}
            </Button>
          </div>
        </div>
        {dock.pending && (
          <QuestionnaireDescription role="status">Sending answers…</QuestionnaireDescription>
        )}
        {dock.settled && (
          <QuestionnaireDescription role="status">Answers sent.</QuestionnaireDescription>
        )}
        {dock.error !== undefined && (
          <QuestionnaireError hidden={false} render={<div />} role="alert">
            {dock.error}
          </QuestionnaireError>
        )}
      </QuestionnaireItem>
    </Questionnaire>
  );
}

export function QuestionTray({
  disabled,
  viewport,
}: {
  readonly disabled: boolean;
  readonly viewport: HTMLElement | null;
}): ReactElement {
  const dock = useContext(QuestionDockContext);
  const { ref, availableHeight } = useTrayRoot(viewport);

  return (
    <div ref={ref} {...props(trayParts.root)}>
      <Tray open={dock !== undefined} label="Questions">
        <div data-nyte-scrollport {...props(trayStyles.list, styles.list)}>
          {dock !== undefined && (
            <QuestionCard
              key={dock.request.part}
              dock={dock}
              disabled={disabled}
              availableHeight={availableHeight}
            />
          )}
        </div>
      </Tray>
    </div>
  );
}
