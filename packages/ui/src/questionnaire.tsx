import { Questionnaire } from "@shadcn/react/questionnaire";
import { create, props, when } from "@stylexjs/stylex";
import type { ComponentProps } from "react";

import { srOnly } from "./styles/a11y.stylex.ts";
import { ChatButton } from "./chat-button.tsx";
import { Icon } from "./icon.tsx";
import { Input } from "./input.tsx";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { choiceInput } from "./styles/questionnaire.stylex.ts";
import { checkbox, radius, row, space } from "./styles/schema.stylex.ts";
import { text } from "./styles/text.stylex.ts";
import { appearance, role, type } from "./styles/vars.stylex.ts";
import { intent } from "./surface-theme.ts";

const styles = create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
    minHeight: 0,
    color: role.contentPrimary,
  },
  item: { display: "contents" },
  progress: { color: role.contentSecondary },
  title: {
    flexShrink: 0,
    minWidth: 0,
    margin: 0,
    paddingInline: space.s1_5,
    fontWeight: type.weightSemibold,
    textWrap: "pretty",
  },
  description: {
    margin: 0,
    paddingInline: space.s1_5,
    color: role.contentSecondary,
    overflowWrap: "anywhere",
  },
  choices: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
    minWidth: 0,
    minHeight: 0,
  },
  choice: {
    "--_question-description-color": {
      default: role.contentSecondary,
      "[data-disabled]": role.contentDisabled,
    },
    "--_question-control-radius": {
      default: checkbox.radius,
      ':has(input[type="radio"])': radius.pill,
    },
    "--_question-dot-display": {
      default: "none",
      ':has(input[type="radio"]:checked)': "block",
    },
    "--_question-check-display": {
      default: "none",
      ':has(input[type="checkbox"]:checked)': "flex",
    },
    display: "flex",
    alignItems: "flex-start",
    gap: space.s2,
    flexShrink: 0,
    minHeight: row.heightMd,
    paddingBlock: space.s2,
    paddingInline: space.s2,
    borderRadius: radius.control,
    color: { default: role.contentPrimary, "[data-disabled]": role.contentDisabled },
    backgroundColor: {
      default: role.bgMutedTranslucent,
      ":hover:not([data-disabled])": {
        "@media (hover: hover) and (pointer: fine)": role.bgHover,
      },
      "[data-checked]": role.bgInteractiveSecondaryTranslucent,
    },
    cursor: { default: appearance.cursorInteractive, "[data-disabled]": "default" },
    boxShadow: {
      default: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
      "[data-checked]": `inset 0 0 0 1px ${role.borderPrimary}`,
    },
    outlineStyle: { default: "none", ":has(input:focus-visible)": "solid" },
    outlineWidth: space.s0_5,
    outlineColor: appearance.focusRing,
    outlineOffset: space.px,
  },
  copy: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  choiceDescription: { color: "var(--_question-description-color)", textWrap: "pretty" },
  mark: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: checkbox.sizeMd,
    height: checkbox.sizeMd,
    marginTop: space.px,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: {
      default: role.borderControlTranslucent,
      [when.siblingBefore(":checked", choiceInput)]: role.bgControlSelected,
    },
    borderRadius: "var(--_question-control-radius)",
    backgroundColor: {
      default: "transparent",
      [when.siblingBefore(":checked", choiceInput)]: role.bgControlSelected,
    },
    color: role.contentOnControl,
  },
  dot: {
    display: "var(--_question-dot-display)",
    width: space.s1_5,
    height: space.s1_5,
    borderRadius: radius.pill,
    backgroundColor: "currentColor",
  },
  check: { display: "var(--_question-check-display)" },
  error: { margin: 0, paddingInline: space.s1_5, color: role.contentInteractiveTertiary },
  actions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: space.s2 },
});

export type QuestionnaireProps = StyledProps<
  ComponentProps<typeof Questionnaire.Root>,
  Restyle<"Questionnaire">
>;

export type QuestionnaireProgressProps = StyledProps<
  ComponentProps<typeof Questionnaire.Progress>,
  Restyle<"QuestionnaireProgress">
>;

export type QuestionnaireItemProps = StyledProps<
  ComponentProps<typeof Questionnaire.Item>,
  Restyle<"QuestionnaireItem">
>;

export type QuestionnaireTitleProps = StyledProps<
  ComponentProps<typeof Questionnaire.Title>,
  Restyle<"QuestionnaireTitle">
>;

export type QuestionnaireDescriptionProps = StyledProps<
  ComponentProps<typeof Questionnaire.Description>,
  Restyle<"QuestionnaireDescription">
>;

export type QuestionnaireChoicesProps = StyledProps<
  ComponentProps<typeof Questionnaire.Choices>,
  Restyle<"QuestionnaireChoices">
>;

export type QuestionnaireChoiceProps = StyledProps<
  ComponentProps<typeof Questionnaire.Choice>,
  Restyle<"QuestionnaireChoice">
>;

export type QuestionnaireChoiceDescriptionProps = StyledProps<
  ComponentProps<"span">,
  Restyle<"QuestionnaireChoiceDescription">
>;

export type QuestionnaireInputProps = ComponentProps<typeof Questionnaire.Input>;

export type QuestionnaireErrorProps = StyledProps<
  ComponentProps<typeof Questionnaire.Error>,
  Restyle<"QuestionnaireError">
>;

export type QuestionnaireActionsProps = StyledProps<
  ComponentProps<"div">,
  Restyle<"QuestionnaireActions">
>;

export type QuestionnairePreviousProps = ComponentProps<typeof Questionnaire.Previous> &
  Pick<ComponentProps<typeof ChatButton>, "size" | "variant">;

export type QuestionnaireSkipProps = ComponentProps<typeof Questionnaire.Skip> &
  Pick<ComponentProps<typeof ChatButton>, "size" | "variant">;

export type QuestionnaireNextProps = ComponentProps<typeof Questionnaire.Next> &
  Pick<ComponentProps<typeof ChatButton>, "size" | "variant">;

export type QuestionnaireSubmitProps = ComponentProps<typeof Questionnaire.Submit> &
  Pick<ComponentProps<typeof ChatButton>, "size" | "variant">;

function QuestionnaireRoot({ xstyle, className, style, ...componentProps }: QuestionnaireProps) {
  return (
    <Questionnaire.Root
      data-slot="questionnaire"
      {...componentProps}
      {...mergeStyleProps(props(text.base, styles.root, xstyle), className, style)}
    />
  );
}

export function QuestionnaireProgress({
  xstyle,
  className,
  style,
  ...componentProps
}: QuestionnaireProgressProps) {
  return (
    <Questionnaire.Progress
      data-slot="questionnaire-progress"
      {...componentProps}
      {...mergeStyleProps(props(text.sm, styles.progress, xstyle), className, style)}
    />
  );
}

export function QuestionnaireItem({
  xstyle,
  className,
  style,
  ...componentProps
}: QuestionnaireItemProps) {
  return (
    <Questionnaire.Item
      data-slot="questionnaire-item"
      {...componentProps}
      {...mergeStyleProps(props(styles.item, xstyle), className, style)}
    />
  );
}

export function QuestionnaireTitle({
  xstyle,
  className,
  style,
  ...componentProps
}: QuestionnaireTitleProps) {
  return (
    <Questionnaire.Title
      data-slot="questionnaire-title"
      {...componentProps}
      {...mergeStyleProps(props(text.base, styles.title, xstyle), className, style)}
    />
  );
}

export function QuestionnaireDescription({
  xstyle,
  className,
  style,
  ...componentProps
}: QuestionnaireDescriptionProps) {
  return (
    <Questionnaire.Description
      data-slot="questionnaire-description"
      {...componentProps}
      {...mergeStyleProps(props(text.sm, styles.description, xstyle), className, style)}
    />
  );
}

export function QuestionnaireChoices({
  xstyle,
  className,
  style,
  ...componentProps
}: QuestionnaireChoicesProps) {
  return (
    <Questionnaire.Choices
      data-slot="questionnaire-choices"
      {...componentProps}
      {...mergeStyleProps(props(styles.choices, xstyle), className, style)}
    />
  );
}

export function QuestionnaireChoice({
  children,
  xstyle,
  className,
  style,
  ...componentProps
}: QuestionnaireChoiceProps) {
  return (
    <Questionnaire.Choice
      data-slot="questionnaire-choice"
      {...componentProps}
      {...mergeStyleProps(props(text.base, styles.choice, xstyle), className, style)}
    >
      <Questionnaire.ChoiceInput
        data-slot="questionnaire-choice-input"
        {...props(srOnly, choiceInput)}
      />
      <span
        data-slot="questionnaire-choice-indicator"
        aria-hidden="true"
        {...props(intent.primary, styles.mark)}
      >
        <span {...props(styles.dot)} />
        <span {...props(styles.check)}>
          <Icon name="checkmark" size={12} />
        </span>
      </span>
      <Questionnaire.ChoiceLabel data-slot="questionnaire-choice-label" {...props(styles.copy)}>
        {children}
      </Questionnaire.ChoiceLabel>
      <Questionnaire.ChoiceShortcut data-slot="questionnaire-choice-shortcut" {...props(srOnly)} />
    </Questionnaire.Choice>
  );
}

export function QuestionnaireChoiceDescription({
  xstyle,
  className,
  style,
  ...componentProps
}: QuestionnaireChoiceDescriptionProps) {
  return (
    <span
      data-slot="questionnaire-choice-description"
      {...componentProps}
      {...mergeStyleProps(props(text.sm, styles.choiceDescription, xstyle), className, style)}
    />
  );
}

export function QuestionnaireInput({ render, ...componentProps }: QuestionnaireInputProps) {
  return (
    <Questionnaire.Input
      data-slot="questionnaire-input"
      render={render ?? <Input />}
      {...componentProps}
    />
  );
}

export function QuestionnaireError({
  xstyle,
  className,
  style,
  ...componentProps
}: QuestionnaireErrorProps) {
  return (
    <Questionnaire.Error
      data-slot="questionnaire-error"
      {...componentProps}
      {...mergeStyleProps(props(intent.danger, text.sm, styles.error, xstyle), className, style)}
    />
  );
}

export function QuestionnaireActions({
  xstyle,
  className,
  style,
  ...componentProps
}: QuestionnaireActionsProps) {
  return (
    <div
      data-slot="questionnaire-actions"
      {...componentProps}
      {...mergeStyleProps(props(styles.actions, xstyle), className, style)}
    />
  );
}

export function QuestionnairePrevious({
  children,
  size = "default",
  variant = "outline",
  render,
  ...componentProps
}: QuestionnairePreviousProps) {
  return (
    <Questionnaire.Previous
      data-slot="questionnaire-previous"
      data-size={size}
      data-variant={variant}
      render={render ?? <ChatButton size={size} variant={variant} />}
      {...componentProps}
    >
      {children ?? "Previous"}
    </Questionnaire.Previous>
  );
}

export function QuestionnaireSkip({
  children,
  size = "default",
  variant = "outline",
  render,
  ...componentProps
}: QuestionnaireSkipProps) {
  return (
    <Questionnaire.Skip
      data-slot="questionnaire-skip"
      data-size={size}
      data-variant={variant}
      render={render ?? <ChatButton size={size} variant={variant} />}
      {...componentProps}
    >
      {children ?? "Skip"}
    </Questionnaire.Skip>
  );
}

export function QuestionnaireNext({
  children,
  size = "default",
  variant = "default",
  render,
  ...componentProps
}: QuestionnaireNextProps) {
  return (
    <Questionnaire.Next
      data-slot="questionnaire-next"
      data-size={size}
      data-variant={variant}
      render={render ?? <ChatButton size={size} variant={variant} />}
      {...componentProps}
    >
      {children ?? "Next"}
    </Questionnaire.Next>
  );
}

export function QuestionnaireSubmit({
  children,
  size = "default",
  variant = "default",
  render,
  ...componentProps
}: QuestionnaireSubmitProps) {
  return (
    <Questionnaire.Submit
      data-slot="questionnaire-submit"
      data-size={size}
      data-variant={variant}
      render={render ?? <ChatButton size={size} variant={variant} />}
      {...componentProps}
    >
      {children ?? "Submit"}
    </Questionnaire.Submit>
  );
}

export { QuestionnaireRoot as Questionnaire };
