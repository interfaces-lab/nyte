/**
 * One tool call: a quiet verb line that expands into its evidence. Ported from
 * the Honk design system's `tool-call.tsx` and recolored onto this palette.
 * Its locked law carries over: no status icons on tool calls. The running
 * state is the shimmer, the outcome is a word after the subject, and the
 * chevron is a control, not a status.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/tool-call.tsx
 */
import { props } from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { toolOutput, toolStatus } from "../view-helpers.ts";
import type { ToolMessage } from "../view-helpers.ts";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import type { ToolCallDensity } from "../preferences/index.ts";
import { EditCallView } from "./edit-call.tsx";
import { activityStyles, toolCallStyles } from "./styles.stylex.ts";
import { ShellCallView } from "./shell-call.tsx";
import { SubagentCallView, SubagentLineView } from "./subagent-call.tsx";
import { terminalText } from "./terminal-text.ts";
import { toolDetail, toolNoun, toolVerbs } from "./tool-copy.ts";
import { ToolLineView, ToolOutcome } from "./tool-line.tsx";

type ToolBody = { readonly kind: "none" } | { readonly kind: "output"; readonly text: string };

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
 * this component on every toggle. The preview reads `state.open` through
 * `render` instead, and the chevron follows the trigger.
 */
export const ToolCallView = memo(function ToolCallView({
  message,
  cwd,
  density,
}: {
  message: ToolMessage;
  cwd: string | undefined;
  density: ToolCallDensity;
}): ReactElement {
  const status = toolStatus(message);
  const running = status.tense === "running";
  const { state } = message;
  const toolClass = state.class;
  const raw = running
    ? state.phase === "running"
      ? (state.progress?.text ?? "")
      : ""
    : toolOutput(state);
  const text = useMemo(() => terminalText(raw), [raw]);
  const body: ToolBody = text.trim() === "" ? { kind: "none" } : { kind: "output", text };

  if (toolClass.kind === "delegate") {
    return toolClass.role === "create" && toolClass.child !== null ? (
      <SubagentCallView
        session={toolClass.child}
        title={toolClass.title ?? "Subagent"}
        message={message}
        cwd={cwd}
      />
    ) : (
      <SubagentLineView toolClass={toolClass} message={message} output={text} />
    );
  }

  if (toolClass.kind === "shell") {
    return <ShellCallView message={message} toolClass={toolClass} cwd={cwd} density={density} />;
  }

  if (toolClass.kind === "read" || toolClass.kind === "list" || toolClass.kind === "custom") {
    return <ToolLineView message={message} toolClass={toolClass} cwd={cwd} />;
  }

  if (toolClass.kind === "edit") {
    return <EditCallView message={message} toolClass={toolClass} cwd={cwd} density={density} />;
  }

  const verb = status.tense === "none" ? undefined : toolVerbs(toolClass)[status.tense];
  const detail = toolDetail(toolClass, cwd);
  const expandable = body.kind !== "none";
  const dimmed = status.tone === "stopped" && toolCallStyles.lineDimmed;

  const lineContent = (
    <>
      {verb !== undefined && (
        <span {...props(toolCallStyles.verb, running && activityStyles.shimmer)}>{verb}</span>
      )}
      {detail !== undefined && (
        <Tooltip>
          <TooltipTrigger render={<span {...props(toolCallStyles.detail)}>{detail.text}</span>} />
          <TooltipContent>{detail.title ?? detail.text}</TooltipContent>
        </Tooltip>
      )}
      {verb === undefined && <span {...props(toolCallStyles.verb)}>{toolNoun(toolClass)}</span>}
      <ToolOutcome status={status} />
    </>
  );

  const line = expandable ? (
    <Collapsible.Trigger
      xstyle={[toolCallStyles.line, density === "detailed" && toolCallStyles.lineDetailed, dimmed]}
    >
      {lineContent}
      <Collapsible.Chevron size={12} xstyle={toolCallStyles.chevron} />
    </Collapsible.Trigger>
  ) : (
    <div
      {...props(
        toolCallStyles.line,
        density === "detailed" && toolCallStyles.lineDetailed,
        toolCallStyles.lineStatic,
        dimmed,
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
        </div>
      )}
    />
  );
});
