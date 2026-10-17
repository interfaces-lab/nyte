import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Button } from "@nyte-ai/ui/button";
import { mentionsFolder, referenceLabel, referenceTitle } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import { useReferenceOpener } from "./reference-opener.tsx";
import { FileTypeIcon } from "../components/file-type-icon.tsx";
import { composerStyles } from "./composer.stylex.ts";

function referenceIcon(reference: MessageReference): IconName {
  switch (reference.kind) {
    case "file":
      return mentionsFolder(reference.file) ? "folder" : "file";
    case "skill":
      return "skills";
    case "mention":
      return "more";
    case "clipboard":
      return "copy";
    case "excerpt":
      return reference.source.kind === "diff"
        ? "diff"
        : reference.source.kind === "terminal"
          ? "console"
          : "code-brackets";
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
    <span {...props(composerStyles.mentionChipLabel)}>
      <span aria-hidden="true" {...props(composerStyles.mentionChipLeading)}>
        {reference.kind === "file" && !mentionsFolder(reference.file) ? (
          <FileTypeIcon path={reference.file.path} />
        ) : (
          <Icon name={referenceIcon(reference)} size={12} />
        )}
      </span>
      {label}
    </span>
  );

  const chip = (
    <span
      data-composer-chip={reference.kind}
      {...props(
        reference.kind === "skill" ? intent.warning : intent.primary,
        composerStyles.mentionChip,
        onRemove !== undefined && composerStyles.mentionChipRemovable,
      )}
    >
      {open === undefined ? (
        content
      ) : (
        <Button
          variant="inline"
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
        <span {...props(composerStyles.mentionChipRemove)}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="plain"
                  size="2xs"
                  iconOnly
                  icon="x"
                  aria-label={`Remove ${label}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove();
                  }}
                />
              }
            />
            <TooltipContent>{`Remove ${label}`}</TooltipContent>
          </Tooltip>
        </span>
      )}
    </span>
  );

  const title = referenceTitle(reference);

  if (reference.kind === "clipboard" || reference.kind === "excerpt") {
    return (
      <PreviewCard>
        <PreviewCardTrigger render={chip} />
        <PreviewCardContent side="top" aria-label={title} xstyle={composerStyles.clipboardPreview}>
          <div {...props(text.xs, composerStyles.clipboardText)}>
            {reference.kind === "clipboard" ? reference.body : reference.text}
          </div>
        </PreviewCardContent>
      </PreviewCard>
    );
  }

  return title === undefined ? (
    chip
  ) : (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  );
}
