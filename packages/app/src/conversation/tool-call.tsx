import { intent } from "@nyte-ai/ui/surface-theme";
/**
 * One tool call: a quiet verb line that expands into its evidence. Ported from
 * the Honk design system's `tool-call.tsx` and recolored onto this palette.
 * Its locked law carries over: no status icons on tool calls. The running
 * state is the shimmer, failure is the red line, and the chevron is a
 * control, not a status. Neither shimmer nor red line survives a screen
 * reader or a colour-blind eye, so the same two states also ship as
 * visually hidden text.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/tool-call.tsx
 */
import { props } from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { parsePatchFacts } from "@nyte-ai/client";
import type { ToolProgress, ToolTurnPart } from "@nyte-ai/protocol";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import type { ToolCallDensity } from "../theme/boot.ts";
import { DiffView } from "./diff-view.tsx";
import type { DiffFacts } from "./diff-view.tsx";
import { EditCallView } from "./edit-call.tsx";
import { activityStyles, toolCallStyles } from "./styles.stylex.ts";
import { ShellCallView } from "./shell-call.tsx";
import { SubagentCallView, SubagentLineView } from "./subagent-call.tsx";
import { terminalText } from "./terminal-text.ts";
import { tidyPath, toolDetail, toolVerb } from "./tool-copy.ts";
import { ToolLineView } from "./tool-line.tsx";
import { toolPhase } from "./transcript-presentation.ts";

type ToolBody =
  | { readonly kind: "none" }
  | { readonly kind: "output"; readonly text: string }
  | { readonly kind: "diff"; readonly path: string; readonly diff: DiffFacts };

// Closed, the tail is a second trigger, so pressing it always opens.
function OutputTail({ children }: { children: ReactNode }): ReactElement {
  const rootRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;

    if (root === null || content === null) return undefined;

    const sync = (): void => {
      root.toggleAttribute("data-overflow", content.scrollHeight > root.clientHeight);
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    observer.observe(content);

    return () => observer.disconnect();
  }, []);

  return (
    <Collapsible.Trigger
      ref={rootRef}
      aria-label="Show full output"
      variant="plain"
      xstyle={[toolCallStyles.outputBody, toolCallStyles.outputTail, focus.ringInset]}
    >
      <span ref={contentRef} {...props(toolCallStyles.outputContent)}>
        {children}
      </span>
    </Collapsible.Trigger>
  );
}

function ToolOutput({ text, open }: { text: string; open: boolean }): ReactElement {
  const [copiedText, setCopiedText] = useState<string>();
  const copied = copiedText === text;

  return (
    <div {...props(toolCallStyles.output)}>
      {open ? (
        <span {...props(toolCallStyles.outputActions)}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  iconOnly
                  icon={copied ? "checkmark" : "copy"}
                  aria-label="Copy tool output"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(text)
                      .then(() => setCopiedText(text))
                      .catch(() => undefined);
                  }}
                />
              }
            />
            <TooltipContent>{copied ? "Copied" : "Copy output"}</TooltipContent>
          </Tooltip>
        </span>
      ) : (
        <OutputTail>{text}</OutputTail>
      )}
      <Collapsible.Panel
        role="region"
        aria-label="Tool output"
        data-nyte-scrollport
        data-tool-body
        xstyle={[toolCallStyles.outputBody, toolCallStyles.outputScroll]}
      >
        <span {...props(toolCallStyles.outputContent)}>{text}</span>
      </Collapsible.Panel>
    </div>
  );
}

/**
 * Open state lives in Base UI, not here: a controlled `open` would re-render
 * this component (and re-parse the patch) on every toggle. The preview reads
 * `state.open` through `render` instead, and the chevron follows the trigger.
 */
export const ToolCallView = memo(function ToolCallView({
  part,
  progress,
  cwd,
  active,
  density,
}: {
  part: ToolTurnPart;
  progress: ToolProgress | undefined;
  cwd: string | undefined;
  active: boolean;
  density: ToolCallDensity;
}): ReactElement {
  const phase = toolPhase(part, active);

  // Hunks are parsed once per part; the counts beside them are the class's own.
  const facts = useMemo(
    () => (part.class.kind === "file_patch" ? parsePatchFacts(part.class.patch) : undefined),
    [part],
  );

  const { class: toolClass, result } = part;
  const raw = result === undefined ? (progress?.text ?? "") : result.output;
  const text = useMemo(() => terminalText(raw), [raw]);

  const body: ToolBody =
    toolClass.kind === "file_patch" && facts !== undefined
      ? {
          kind: "diff",
          path: tidyPath(toolClass.path, cwd),
          diff: { patch: facts.patch, added: toolClass.added, removed: toolClass.removed },
        }
      : text.trim() === ""
        ? { kind: "none" }
        : { kind: "output", text };

  // One card per child: its create. Every other call on it is a line.
  if (toolClass.kind === "delegate") {
    return toolClass.role === "create" ? (
      <SubagentCallView
        session={toolClass.target.session}
        title={toolClass.title}
        phase={phase}
        cwd={cwd}
      />
    ) : (
      <SubagentLineView toolClass={toolClass} phase={phase} output={text} />
    );
  }

  if (toolClass.kind === "shell") {
    return (
      <ShellCallView
        part={part}
        toolClass={toolClass}
        progress={progress}
        cwd={cwd}
        active={active}
        density={density}
      />
    );
  }

  if (toolClass.kind === "file_read" || toolClass.kind === "list" || toolClass.kind === "custom") {
    return (
      <ToolLineView
        part={part}
        toolClass={toolClass}
        progress={progress}
        cwd={cwd}
        active={active}
      />
    );
  }

  if (
    toolClass.kind === "file_patch" ||
    ((toolClass.kind === "file_edit" || toolClass.kind === "file_write") && phase === "running")
  ) {
    return (
      <EditCallView part={part} toolClass={toolClass} cwd={cwd} active={active} density={density} />
    );
  }

  const verb = toolVerb(toolClass, phase);
  const detail = toolDetail(toolClass, cwd);
  const expandable = body.kind !== "none";
  const editDiff = body.kind === "diff";

  const lineContent = (
    <>
      <span {...props(toolCallStyles.verb, phase === "running" && activityStyles.shimmer)}>
        {verb}
      </span>
      {detail !== undefined && (
        <Tooltip>
          <TooltipTrigger render={<span {...props(toolCallStyles.detail)}>{detail.text}</span>} />
          <TooltipContent>{detail.title ?? detail.text}</TooltipContent>
        </Tooltip>
      )}
    </>
  );

  const line = expandable ? (
    <Collapsible.Trigger
      data-tool-status={phase}
      xstyle={[
        toolCallStyles.line,
        editDiff && toolCallStyles.editLine,
        density === "detailed" && toolCallStyles.lineDetailed,
        phase === "failed" && intent.danger,
        phase === "failed" && toolCallStyles.failed,
      ]}
    >
      {lineContent}
      <Collapsible.Chevron size={12} xstyle={toolCallStyles.chevron} />
    </Collapsible.Trigger>
  ) : (
    <div
      data-tool-status={phase}
      {...props(
        toolCallStyles.line,
        density === "detailed" && toolCallStyles.lineDetailed,
        toolCallStyles.lineStatic,
        phase === "failed" && intent.danger,
        phase === "failed" && toolCallStyles.failed,
      )}
    >
      {lineContent}
    </div>
  );

  return (
    <Collapsible.Root
      disabled={!expandable}
      xstyle={toolCallStyles.root}
      render={(componentProps, state) => (
        <div {...componentProps}>
          {line}
          {body.kind === "output" && <ToolOutput text={body.text} open={state.open} />}
          {body.kind === "diff" && (
            <Collapsible.Panel keepMounted data-tool-body>
              <DiffView path={body.path} diff={body.diff} variant="inline" />
            </Collapsible.Panel>
          )}
        </div>
      )}
    />
  );
});
