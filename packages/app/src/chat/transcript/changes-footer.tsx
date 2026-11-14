import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import type { SessionView } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { FileTypeIcon } from "@nyte-ai/ui/file-type-icon";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { ChangeStats } from "../../components/change-stats.tsx";
import { CHANGES_VISIBLE_FILES, filesChangedLabel } from "../../diff/change-tree.ts";
import { useReferenceOpener } from "../../references/reference-opener.tsx";
import { turnStyles } from "./turn.stylex.ts";

function ChangesCard({
  files,
  onOpenChanges,
}: {
  readonly files: SessionView["changes"];
  readonly onOpenChanges: (path: string | null) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const title = filesChangedLabel(files.length);
  const collapsed = !expanded && files.length > CHANGES_VISIBLE_FILES;
  const shown = collapsed ? files.slice(0, CHANGES_VISIBLE_FILES - 1) : files;

  return (
    <section aria-label={title} {...props(turnStyles.changesCard)}>
      <div {...props(turnStyles.changesHeader)}>
        <span {...props(turnStyles.changesTitle)}>{title}</span>
        <Button
          variant="plain"
          size="sm"
          onClick={() => onOpenChanges(null)}
          xstyle={turnStyles.changesReview}
        >
          Review
        </Button>
      </div>
      <ul {...props(turnStyles.changesList)}>
        {shown.map((file) => (
          <Row
            key={file.path}
            render={<li />}
            interactive
            data-change-stats-control=""
            xstyle={turnStyles.changesFile}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Row.Primary
                    aria-label={`Open ${file.path} in Changes`}
                    onClick={() => onOpenChanges(file.path)}
                  >
                    <Row.Leading xstyle={turnStyles.changesFileIcon}>
                      <FileTypeIcon path={file.path} />
                    </Row.Leading>
                    <Row.Label>{file.path.split("/").at(-1) ?? file.path}</Row.Label>
                    <ChangeStats added={file.added} removed={file.removed} />
                  </Row.Primary>
                }
              />
              <TooltipContent side="top">{file.path}</TooltipContent>
            </Tooltip>
          </Row>
        ))}
        {collapsed && (
          <Row render={<li />} interactive xstyle={turnStyles.changesFile}>
            <Row.Primary aria-expanded={false} onClick={() => setExpanded(true)}>
              <Row.Leading xstyle={turnStyles.changesFileIcon}>
                <Icon name="more-horizontal" size="sm" />
              </Row.Leading>
              <Row.Label>{`Show ${String(files.length - shown.length)} more`}</Row.Label>
            </Row.Primary>
          </Row>
        )}
      </ul>
    </section>
  );
}

export function ChangesFooter({
  state,
  files,
}: {
  readonly state: "pending" | "ready";
  readonly files: SessionView["changes"];
}): ReactElement {
  const opener = useReferenceOpener();

  return (
    <div {...props(turnStyles.changesFooter(CHANGES_VISIBLE_FILES))}>
      {state === "ready" && files.length > 0 && (
        <ChangesCard
          files={files}
          onOpenChanges={(path) => opener?.({ kind: "changes", path })?.()}
        />
      )}
    </div>
  );
}
