import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Hint, HoverPreview } from "@nyte-ai/ui/tooltip";
import { Button } from "@nyte-ai/ui/button";
import { isFolder, referenceLabel, referenceTitle } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import { useReferenceOpener } from "./reference-opener.tsx";
import { composerStyles } from "./styles.stylex.ts";

function referenceIcon(reference: MessageReference): IconName {
  switch (reference.kind) {
    case "file":
      return isFolder(reference.file) ? "folder" : "file";
    case "skill":
      return "skills";
    case "mention":
      return "more";
    case "clipboard":
      return "copy";
    default: {
      const exhaustive: never = reference;

      return exhaustive;
    }
  }
}

/** One chip, the same in the editor, the queue strip, the transcript, and a message edit. */
export function ComposerChipView({
  reference,
  onRemove,
}: {
  readonly reference: MessageReference;
  /** Present only inside an editor; read-only surfaces draw the chip without controls. */
  readonly onRemove?: () => void;
}): ReactElement {
  const label = referenceLabel(reference);
  const open = useReferenceOpener()?.(reference);
  const inEditor = onRemove !== undefined;

  const chip = (
    <span
      data-composer-chip={reference.kind}
      data-openable={open !== undefined}
      role={open === undefined ? undefined : "link"}
      // The editor moves through chips with its own selection; only read-only
      // surfaces need a tab stop.
      tabIndex={open === undefined || inEditor ? undefined : 0}
      onClick={
        open === undefined
          ? undefined
          : (event) => {
              event.stopPropagation();
              open();
            }
      }
      onKeyDown={
        open === undefined || inEditor
          ? undefined
          : (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              open();
            }
      }
      {...props(
        composerStyles.mentionChip,
        reference.kind === "skill" && composerStyles.mentionChipSkill,
        open !== undefined && focus.ring,
      )}
    >
      <span aria-hidden="true" {...props(composerStyles.mentionChipLeading)}>
        <Icon name={referenceIcon(reference)} size={12} />
      </span>
      {onRemove !== undefined && (
        <Hint
          content={`Remove ${label}`}
          trigger={
            <Button
              size="icon-xs"
              icon="x"
              aria-label={`Remove ${label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              xstyle={composerStyles.mentionChipRemove}
            />
          }
        />
      )}
      {label}
    </span>
  );

  if (reference.kind === "clipboard") {
    return <HoverPreview content={reference.body} trigger={chip} side="top" />;
  }

  const title = referenceTitle(reference);

  return title === undefined ? chip : <Hint content={title} trigger={chip} side="top" />;
}
