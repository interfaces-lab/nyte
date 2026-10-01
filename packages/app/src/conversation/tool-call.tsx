import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
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
import { focus, srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import type { ToolCallDensity } from "../theme/boot.ts";
import { DiffView } from "./diff-view.tsx";
import type { DiffFacts } from "./diff-view.tsx";
import { activityStyles, shellTokenStyles, toolCallStyles } from "./styles.stylex.ts";
import { SubagentCallView, SubagentLineView } from "./subagent-call.tsx";
import { tidyPath, toolDetail, toolVerb } from "./tool-copy.ts";
import { toolPhase } from "./transcript-presentation.ts";
import type { LiveWaits } from "./transcript-presentation.ts";

type ToolBody =
  | { readonly kind: "none" }
  /** A shell call's output carries its command, drawn as the prompt line. */
  | { readonly kind: "output"; readonly text: string; readonly command: string | undefined }
  | { readonly kind: "diff"; readonly path: string; readonly diff: DiffFacts };

type ShellTokenKind =
  | "program"
  | "flag"
  | "string"
  | "variable"
  | "operator"
  | "argument"
  | "space";

// Every character lands in one alternative, so the tokens rejoin into the command.
const SHELL_TOKEN = /\s+|"(?:[^"\\]|\\.)*"?|'[^']*'?|&&|\|\||[|;<>]|[^\s|;<>"']+/gu;

const SEPARATOR = /^(?:&&|\|\||[|;])$/u;

/** The first word after a separator is the program. */
function shellTokens(
  command: string,
): readonly { readonly kind: ShellTokenKind; readonly text: string }[] {
  let expectProgram = true;

  return Array.from(command.matchAll(SHELL_TOKEN), ([text]) => {
    const kind = shellTokenKind(text, expectProgram);

    if (kind !== "space") expectProgram = SEPARATOR.test(text);

    return { kind, text };
  });
}

function shellTokenKind(text: string, expectProgram: boolean): ShellTokenKind {
  if (/^\s/u.test(text)) return "space";
  if (text.startsWith('"') || text.startsWith("'")) return "string";
  if (text.startsWith("$")) return "variable";
  if (SEPARATOR.test(text) || text === "<" || text === ">") return "operator";
  if (/^-+\w/u.test(text)) return "flag";

  return expectProgram ? "program" : "argument";
}

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

function ToolOutput({
  command,
  text,
  open,
}: {
  command: string | undefined;
  text: string;
  open: boolean;
}): ReactElement {
  const [copiedTranscript, setCopiedTranscript] = useState<string>();
  const transcript = command === undefined ? text : `$ ${command}\n${text}`;
  const copied = copiedTranscript === transcript;
  const lines = (
    <>
      {command !== undefined && (
        <code {...props(toolCallStyles.command)}>
          <span {...props(toolCallStyles.prompt)}>$ </span>
          {shellTokens(command).map((token, index) =>
            token.kind === "space" ? (
              token.text
            ) : (
              <span
                key={index}
                {...props(
                  token.kind === "flag" && surfaceTheme.teal,
                  token.kind === "string" && surfaceTheme.green,
                  token.kind === "variable" && surfaceTheme.orange,
                  shellTokenStyles[token.kind],
                )}
              >
                {token.text}
              </span>
            ),
          )}
        </code>
      )}
      {text}
    </>
  );

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
                  aria-label={
                    command === undefined ? "Copy tool output" : `Copy output for ${command}`
                  }
                  onClick={() => {
                    navigator.clipboard
                      .writeText(transcript)
                      .then(() => setCopiedTranscript(transcript))
                      .catch(() => undefined);
                  }}
                />
              }
            />
            <TooltipContent>{copied ? "Copied" : "Copy output"}</TooltipContent>
          </Tooltip>
        </span>
      ) : (
        <OutputTail>{lines}</OutputTail>
      )}
      <Collapsible.Panel
        role="region"
        aria-label="Tool output"
        data-nyte-scrollport
        data-tool-body
        xstyle={[toolCallStyles.outputBody, toolCallStyles.outputScroll]}
      >
        <span {...props(toolCallStyles.outputContent)}>{lines}</span>
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
  waits,
}: {
  part: ToolTurnPart;
  progress: ToolProgress | undefined;
  cwd: string | undefined;
  active: boolean;
  density: ToolCallDensity;
  /** The run's live waits on its children; only the trailing turn has any. */
  waits?: LiveWaits;
}): ReactElement {
  const phase = toolPhase(part, active);

  // Hunks are parsed once per part; the counts beside them are the class's own.
  const facts = useMemo(
    () => (part.class.kind === "file_patch" ? parsePatchFacts(part.class.patch) : undefined),
    [part],
  );

  const { class: toolClass, result } = part;
  const text = result === undefined ? (progress?.text ?? "") : result.output;

  const body: ToolBody =
    toolClass.kind === "file_patch" && facts !== undefined
      ? {
          kind: "diff",
          path: tidyPath(toolClass.path, cwd),
          diff: { patch: facts.patch, added: toolClass.added, removed: toolClass.removed },
        }
      : text.trim() === ""
        ? { kind: "none" }
        : {
            kind: "output",
            text,
            command: toolClass.kind === "shell" ? toolClass.command : undefined,
          };

  // One card per child: its create. Every other call on it is a line.
  if (toolClass.kind === "delegate") {
    return toolClass.role === "create" ? (
      <SubagentCallView
        session={toolClass.target.session}
        title={toolClass.title}
        phase={phase}
        density={density}
        cwd={cwd}
      />
    ) : (
      <SubagentLineView
        toolClass={toolClass}
        phase={phase}
        density={density}
        until={waits?.deadlines.get(part.callId)}
      />
    );
  }

  const verb = toolVerb(toolClass, phase);
  const detail = toolDetail(toolClass, cwd);
  const expandable = body.kind !== "none";
  const editDiff = body.kind === "diff";

  const lineContent = (
    <>
      <span
        {...props(
          toolCallStyles.verb,
          toolClass.kind === "custom" && toolCallStyles.verbLong,
          toolClass.kind === "custom" && phase !== "running" && toolCallStyles.verbWrap,
          phase === "running" && activityStyles.shimmer,
        )}
      >
        {verb}
      </span>
      {/* A custom label is a name, not a verb; the phase words already say failed or stopped. */}
      {phase === "running" && toolClass.kind === "custom" && (
        <span {...props(srOnly)}>Running</span>
      )}
      {detail !== undefined && (
        <Tooltip>
          <TooltipTrigger render={<span {...props(toolCallStyles.detail)}>{detail.text}</span>} />
          <TooltipContent>{detail.title ?? detail.text}</TooltipContent>
        </Tooltip>
      )}
      {toolClass.kind === "file_patch" && (toolClass.added > 0 || toolClass.removed > 0) && (
        <span {...props(toolCallStyles.stats, editDiff && toolCallStyles.editStats)}>
          {toolClass.added > 0 && (
            <span {...props(intent.success, toolCallStyles.added)}>+{toolClass.added}</span>
          )}
          {toolClass.removed > 0 && (
            <span {...props(intent.danger, toolCallStyles.removed)}>-{toolClass.removed}</span>
          )}
        </span>
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
          {body.kind === "output" && (
            <ToolOutput command={body.command} text={body.text} open={state.open} />
          )}
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
