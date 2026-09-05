import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
import type { ComposerChip } from "./composer.tsx";
import { composerStyles, inlineTextStyles } from "./styles.stylex.ts";

/** An atomic inline editor component, not a shortened URL painted over a textarea. */
export function ComposerChipView({
  chip,
  disabled,
  onRemove,
}: {
  readonly chip: ComposerChip;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}): ReactElement {
  if (chip.kind === "command" || chip.kind === "skill") {
    return (
      <span
        data-composer-chip={chip.kind}
        title={`Remove ${chip.label} with Backspace`}
        {...props(inlineTextStyles.skill)}
      >
        {chip.kind === "skill" ? `/${chip.label}` : chip.label}
      </span>
    );
  }
  const icon = chip.kind === "file" ? (chip.file.label.endsWith("/") ? "folder" : "file") : "more";
  return (
    <span
      data-composer-chip={chip.kind}
      data-has-remove-button="true"
      title={chip.kind === "file" ? chip.file.path : chip.label}
      {...props(composerStyles.mentionChip, chip.kind === "file" && composerStyles.fileChip)}
    >
      <span aria-hidden="true" {...props(composerStyles.mentionChipLeading)}>
        <Icon name={icon} size={12} />
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Remove ${chip.label}`}
        title={`Remove ${chip.label}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
        {...props(composerStyles.mentionChipRemove, focus.ring)}
      >
        <Icon name="x" size={11} />
      </button>
      <span {...props(composerStyles.fileChipLabel)}>{chip.label}</span>
    </span>
  );
}
