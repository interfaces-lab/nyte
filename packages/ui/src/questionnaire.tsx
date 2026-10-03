import { Questionnaire } from "@shadcn/react/questionnaire";
import { props } from "@stylexjs/stylex";
import type { ComponentProps } from "react";

import { srOnly } from "./a11y.stylex.ts";
import { ChatButton } from "./chat-button.tsx";

export type QuestionnaireProps = ComponentProps<typeof Questionnaire.Root>;

export type QuestionnaireProgressProps = ComponentProps<typeof Questionnaire.Progress>;

export type QuestionnaireItemProps = ComponentProps<typeof Questionnaire.Item>;

export type QuestionnaireTitleProps = ComponentProps<typeof Questionnaire.Title>;

export type QuestionnaireDescriptionProps = ComponentProps<typeof Questionnaire.Description>;

export type QuestionnaireChoicesProps = ComponentProps<typeof Questionnaire.Choices>;

export type QuestionnaireChoiceProps = ComponentProps<typeof Questionnaire.Choice>;

export type QuestionnaireChoiceDescriptionProps = ComponentProps<"span">;

export type QuestionnaireInputProps = ComponentProps<typeof Questionnaire.Input>;

export type QuestionnaireErrorProps = ComponentProps<typeof Questionnaire.Error>;

export type QuestionnaireActionsProps = ComponentProps<"div">;

export type QuestionnairePreviousProps = ComponentProps<typeof Questionnaire.Previous> &
  Pick<ComponentProps<typeof ChatButton>, "size" | "variant">;

export type QuestionnaireSkipProps = ComponentProps<typeof Questionnaire.Skip> &
  Pick<ComponentProps<typeof ChatButton>, "size" | "variant">;

export type QuestionnaireNextProps = ComponentProps<typeof Questionnaire.Next> &
  Pick<ComponentProps<typeof ChatButton>, "size" | "variant">;

export type QuestionnaireSubmitProps = ComponentProps<typeof Questionnaire.Submit> &
  Pick<ComponentProps<typeof ChatButton>, "size" | "variant">;

function QuestionnaireRoot(componentProps: QuestionnaireProps) {
  return <Questionnaire.Root data-slot="questionnaire" {...componentProps} />;
}

export function QuestionnaireProgress(componentProps: QuestionnaireProgressProps) {
  return <Questionnaire.Progress data-slot="questionnaire-progress" {...componentProps} />;
}

export function QuestionnaireItem(componentProps: QuestionnaireItemProps) {
  return <Questionnaire.Item data-slot="questionnaire-item" {...componentProps} />;
}

export function QuestionnaireTitle(componentProps: QuestionnaireTitleProps) {
  return <Questionnaire.Title data-slot="questionnaire-title" {...componentProps} />;
}

export function QuestionnaireDescription(componentProps: QuestionnaireDescriptionProps) {
  return <Questionnaire.Description data-slot="questionnaire-description" {...componentProps} />;
}

export function QuestionnaireChoices(componentProps: QuestionnaireChoicesProps) {
  return <Questionnaire.Choices data-slot="questionnaire-choices" {...componentProps} />;
}

export function QuestionnaireChoice({ children, ...componentProps }: QuestionnaireChoiceProps) {
  return (
    <Questionnaire.Choice data-slot="questionnaire-choice" {...componentProps}>
      <Questionnaire.ChoiceInput data-slot="questionnaire-choice-input" {...props(srOnly)} />
      <Questionnaire.ChoiceLabel data-slot="questionnaire-choice-label">
        {children}
      </Questionnaire.ChoiceLabel>
      <Questionnaire.ChoiceShortcut data-slot="questionnaire-choice-shortcut" {...props(srOnly)} />
    </Questionnaire.Choice>
  );
}

export function QuestionnaireChoiceDescription(
  componentProps: QuestionnaireChoiceDescriptionProps,
) {
  return <span data-slot="questionnaire-choice-description" {...componentProps} />;
}

export function QuestionnaireInput(componentProps: QuestionnaireInputProps) {
  return <Questionnaire.Input data-slot="questionnaire-input" {...componentProps} />;
}

export function QuestionnaireError(componentProps: QuestionnaireErrorProps) {
  return <Questionnaire.Error data-slot="questionnaire-error" {...componentProps} />;
}

export function QuestionnaireActions(componentProps: QuestionnaireActionsProps) {
  return <div data-slot="questionnaire-actions" {...componentProps} />;
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
