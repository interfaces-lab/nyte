import { toolStatus } from "@nyte-ai/client";
import type { ToolStatus, ToolTense } from "@nyte-ai/client";
import { create, props } from "@stylexjs/stylex";
import type { ToolClass, ToolProgress, ToolTurnPart } from "@nyte-ai/protocol";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { appearance, motion, role, type } from "@nyte-ai/ui/vars.stylex";
import { memo, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { fileFromUrl } from "./message-references.ts";
import { useReferenceOpener } from "./reference-opener.tsx";
import { activityStyles } from "./styles.stylex.ts";
import { terminalText } from "./terminal-text.ts";
import { customTool, placeName, toolNoun, toolVerbs } from "./tool-copy.ts";
import type { CustomTool } from "./tool-copy.ts";

export type LineToolClass = Extract<ToolClass, { readonly kind: "file_read" | "list" | "custom" }>;

const COLOR_TRANSITION = {
  transitionProperty: "color",
  transitionDuration: {
    default: motion.durationFast,
    "@media (prefers-reduced-motion: reduce)": "0s",
  },
  transitionTimingFunction: "ease-in-out",
} as const;

const DIMMED = `color-mix(in oklab, ${role.contentSecondary} 55%, ${role.contentTertiary})`;

export const toolLineStyles = create({
  root: { display: "flex", flexDirection: "column", minWidth: 0 },
  line: {
    appearance: "none",
    display: "flex",
    alignItems: "center",
    gap: 4,
    width: "100%",
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: "inherit",
    textDecoration: "none",
    fontFamily: "inherit",
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    letterSpacing: type.letterLg,
    textAlign: "start",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    userSelect: "none",
    cursor: "default",
    "--_action": role.contentSecondary,
    "--_details": role.contentSecondary,
    "--_chevron": "0",
  },
  clickable: {
    cursor: appearance.cursorInteractive,
    "--_action": {
      default: role.contentSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.contentPrimary },
    },
    "--_details": {
      default: role.contentSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.contentPrimary },
    },
    "--_chevron": {
      default: "0",
      ":hover": { "@media (hover: hover) and (pointer: fine)": "1" },
      ":focus-visible": "1",
      "[data-panel-open]": "1",
    },
  },
  dimmed: { "--_action": DIMMED, "--_details": DIMMED },
  dimmedText: { color: DIMMED },
  icon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    lineHeight: 0,
    color: "var(--_action)",
    ...COLOR_TRANSITION,
  },
  action: { flexShrink: 0, color: "var(--_action)", ...COLOR_TRANSITION },
  actionOnly: { flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  details: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: "var(--_details)",
    fontVariantNumeric: "tabular-nums",
    ...COLOR_TRANSITION,
  },
  strong: { color: "var(--_action)", ...COLOR_TRANSITION },
  outcome: { flexShrink: 0, color: role.contentSecondary },
  chevron: {
    color: role.contentTertiary,
    opacity: "var(--_chevron)",
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  output: {
    boxSizing: "border-box",
    maxHeight: 280,
    marginBlock: 2,
    paddingBlock: 4,
    paddingInline: 8,
    overflowY: "auto",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    userSelect: "text",
  },
  card: {
    boxSizing: "border-box",
    width: 360,
    maxWidth: "var(--available-width)",
    maxHeight: 280,
    padding: 4,
    overflowY: "auto",
  },
  cardText: {
    paddingBlock: 0,
    paddingInline: 4,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
});

/** Without a verb the subject names the tool itself: "x.ts read", or a custom tool's own name. */
function lineCopy(toolClass: LineToolClass, cwd: string | undefined, tense: ToolTense): CustomTool {
  switch (toolClass.kind) {
    case "file_read":
    case "list": {
      const place = placeName(toolClass.path, cwd);

      return {
        verbs: toolVerbs(toolClass),
        detail: tense === "none" ? `${place} ${toolNoun(toolClass) ?? ""}` : place,
      };
    }

    case "custom": {
      const tool = customTool(toolClass.label);

      return tense === "none" && tool.name === undefined
        ? { ...tool, detail: toolClass.label }
        : tool;
    }

    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

/** The word the outcome adds after the subject; a failure takes the danger tone, a stop stays quiet. */
export function ToolOutcome({ status }: { readonly status: ToolStatus }): ReactElement | null {
  if (status.word === undefined) return null;

  return (
    <span
      {...props(
        status.tone === "failure" && intent.danger,
        status.tone === "attention" && intent.warning,
        toolLineStyles.outcome,
        status.tone === "stopped" && toolLineStyles.dimmedText,
      )}
    >
      · {status.word}
    </span>
  );
}

function fileUrl(path: string, cwd: string | undefined): string | undefined {
  const absolute = path.startsWith("/") ? path : cwd === undefined ? undefined : `${cwd}/${path}`;

  if (absolute === undefined) return undefined;

  const url = new URL("file:///");
  url.pathname = absolute;

  return url.href;
}

export const ToolLineView = memo(function ToolLineView({
  part,
  toolClass,
  progress,
  cwd,
}: {
  part: ToolTurnPart;
  toolClass: LineToolClass;
  progress: ToolProgress | undefined;
  cwd: string | undefined;
}): ReactElement {
  const status = toolStatus(part.state);
  const running = status.tense === "running";
  const opener = useReferenceOpener();
  const raw = part.output ?? (running ? (progress?.text ?? "") : "");
  const output = useMemo(() => terminalText(raw).trimEnd(), [raw]);
  const copy = lineCopy(toolClass, cwd, status.tense);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const file =
    toolClass.kind === "file_read" && status.tone === "success"
      ? fileFromUrl(fileUrl(toolClass.path, cwd) ?? "")
      : undefined;

  const open = file === undefined ? undefined : opener?.({ kind: "file", file });
  const expandable = open === undefined && output.trim() !== "";
  const hasDetails = copy.name !== undefined || copy.detail !== undefined;

  const content: ReactNode = (
    <>
      {copy.server !== undefined && (
        <span {...props(toolLineStyles.icon)}>
          <Icon name="mcp" size={14} />
        </span>
      )}
      {status.tense !== "none" && (
        <span
          {...props(
            toolLineStyles.action,
            !hasDetails && toolLineStyles.actionOnly,
            running && activityStyles.shimmer,
          )}
        >
          {copy.verbs[status.tense]}
        </span>
      )}
      {hasDetails && (
        <span {...props(toolLineStyles.details)}>
          {copy.name !== undefined && <span {...props(toolLineStyles.strong)}>{copy.name}</span>}
          {copy.server !== undefined && ` in ${copy.server}`}
          {copy.name === undefined && copy.detail}
        </span>
      )}
      <ToolOutcome status={status} />
    </>
  );

  const dimmed = status.tone === "stopped" && toolLineStyles.dimmed;

  if (open !== undefined) {
    return (
      <a
        href={file?.url}
        onClick={(event) => {
          event.preventDefault();
          open();
        }}
        {...props(toolLineStyles.line, toolLineStyles.clickable, dimmed, focus.ringInset)}
      >
        {content}
      </a>
    );
  }

  if (!expandable) {
    return <div {...props(toolLineStyles.line, dimmed)}>{content}</div>;
  }

  return (
    <Collapsible.Root
      xstyle={toolLineStyles.root}
      open={expanded}
      onOpenChange={(next) => {
        setExpanded(next);
        setHovered(false);
      }}
    >
      <PreviewCard
        open={hovered && !expanded && !running}
        onOpenChange={(next, details) => {
          if (details.reason === "trigger-press" || details.reason === "outside-press") return;

          if (next && details.reason !== "trigger-hover") return;

          setHovered(next);
        }}
      >
        <PreviewCardTrigger
          render={
            <Collapsible.Trigger
              variant="plain"
              xstyle={[toolLineStyles.line, toolLineStyles.clickable, dimmed, focus.ringInset]}
            />
          }
        >
          {content}
          <Collapsible.Chevron size={12} xstyle={toolLineStyles.chevron} />
        </PreviewCardTrigger>
        <PreviewCardContent side="bottom" align="start" sideOffset={8} xstyle={toolLineStyles.card}>
          <div {...props(toolLineStyles.cardText)}>{output}</div>
        </PreviewCardContent>
      </PreviewCard>
      <Collapsible.Panel data-tool-body role="region" aria-label="Tool output">
        <div data-nyte-scrollport {...props(toolLineStyles.output)}>
          {output}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
});
