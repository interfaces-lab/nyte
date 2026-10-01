import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
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
  const content = (
    <>
      <span aria-hidden="true" {...props(composerStyles.mentionChipLeading)}>
        <Icon name={referenceIcon(reference)} size={12} />
      </span>
      {label}
    </>
  );

  const chip = (
    <span
      data-composer-chip={reference.kind}
      {...props(
        reference.kind === "skill" ? intent.warning : intent.primary,
        composerStyles.mentionChip,
      )}
    >
      {open === undefined ? (
        <span {...props(composerStyles.mentionChipLabel)}>{content}</span>
      ) : (
        <Button
          size="sm"
          variant="plain"
          onMouseDown={onRemove === undefined ? undefined : (event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
        >
          {content}
        </Button>
      )}
      {onRemove !== undefined && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="2xs"
                iconOnly
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
          <TooltipContent>{`Remove ${label}`}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );

  if (reference.kind === "clipboard") {
    return (
      <Tooltip>
        <TooltipTrigger render={chip} />
        <TooltipContent side="top" xstyle={composerStyles.clipboardPreview}>
          {reference.body}
        </TooltipContent>
      </Tooltip>
    );
  }

  const title = referenceTitle(reference);

  return title === undefined ? (
    chip
  ) : (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  );
}
