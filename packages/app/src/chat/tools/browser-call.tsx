import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import type { BrowserStep } from "@nyte-ai/plugin/browser/schema";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import type { IconName } from "@nyte-ai/ui/icon";
import { Icon } from "@nyte-ai/ui/icon";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { BlobImage } from "../transcript/message-content.tsx";
import { ToolCard, ToolSpinner, ToolVerb, toolCardStyles } from "./tool-card.tsx";
import { ToolOutcome } from "./tool-line.tsx";
import { toolFacts } from "./tool-facts.ts";
import type { ToolFacts } from "./tool-facts.ts";

export interface BrowserCall {
  readonly message: ToolMessage;
  readonly step: BrowserStep;
}

interface StepCopy {
  readonly icon: IconName;
  readonly running: string;
  readonly done: string;
  readonly subject?: string;
  readonly muted?: string;
}

const styles = create({
  steps: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: space.s1,
    paddingInline: space.s2,
  },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    minWidth: 0,
    paddingBlockEnd: space.s1_5,
  },
  preview: { display: "flex", flexDirection: "column", padding: space.s2 },
});

export function BrowserCallsView({
  calls,
}: {
  readonly calls: readonly BrowserCall[];
}): ReactElement {
  const [only] = calls;

  if (calls.length === 1 && only !== undefined)
    return (
      <div {...props(toolCardStyles.stack)}>
        <BrowserStepRow call={only} shot />
      </div>
    );

  const last = calls.at(-1);

  const facts =
    last === undefined
      ? undefined
      : toolFacts(last.message, last.message.state, undefined, "browser");

  const status = facts?.status;
  const running = facts?.running === true;

  const page = calls.flatMap((call) =>
    call.step.tool === "browser_open" ? [call.step.args.url.replace(/^https?:\/\//u, "")] : [],
  )[0];

  return (
    <ToolCard
      label="Browser"
      lead={
        <span aria-hidden="true" {...props(toolCardStyles.glyph)}>
          <Icon name="browser" size="sm" />
        </span>
      }
      running={running}
      title={
        <>
          <ToolVerb running={running}>
            {running && last !== undefined ? browserCopy(last.step).running : "Browser"}
          </ToolVerb>
          {page !== undefined && <span {...props(toolCardStyles.muted)}>{page}</span>}
          {status !== undefined && <ToolOutcome status={status} />}
        </>
      }
      aside={`${String(calls.length)} steps`}
      preview={running || last === undefined ? undefined : <BrowserPreview calls={calls} />}
    >
      <div {...props(styles.steps)}>
        {calls.map((call) => (
          <BrowserStepRow key={call.message.id} call={call} shot={false} />
        ))}
      </div>
    </ToolCard>
  );
}

function BrowserPreview({ calls }: { readonly calls: readonly BrowserCall[] }): ReactNode {
  const last = calls.at(-1);

  const facts =
    last === undefined
      ? undefined
      : toolFacts(last.message, last.message.state, undefined, "browser");

  const failed = facts?.status.tone === "failure";
  const file = calls.map((call) => screenshot(call.message)).findLast((shot) => shot !== undefined);

  if (!failed && file === undefined) return null;

  return (
    <div {...props(styles.preview, hairline.blockStart)}>
      {failed ? (
        <p {...props(text.sm, toolCardStyles.failure)}>{facts.output}</p>
      ) : (
        file !== undefined && <BlobImage file={file} compact />
      )}
    </div>
  );
}

function BrowserStepRow({
  call,
  shot,
}: {
  readonly call: BrowserCall;
  readonly shot: boolean;
}): ReactElement {
  const message = call.message;
  const copy = browserCopy(call.step);
  const facts = toolFacts(message, message.state, undefined, "browser");
  const status = facts.status;
  const running = facts.running;
  const detail = stepDetail(message, facts, shot);

  return (
    <div {...props(toolCardStyles.stack)}>
      <div {...props(toolCardStyles.line)}>
        {running ? (
          <ToolSpinner />
        ) : (
          <span aria-hidden="true" {...props(toolCardStyles.glyph)}>
            <Icon name={copy.icon} size="sm" />
          </span>
        )}
        <ToolVerb running={running}>{running ? copy.running : copy.done}</ToolVerb>
        {copy.subject !== undefined && (
          <span {...props(toolCardStyles.subject)}>{copy.subject}</span>
        )}
        {copy.muted !== undefined && <span {...props(toolCardStyles.muted)}>{copy.muted}</span>}
        <ToolOutcome status={status} />
      </div>
      {detail !== null && <div {...props(styles.detail, toolCardStyles.hang)}>{detail}</div>}
    </div>
  );
}

function stepDetail(message: ToolMessage, facts: ToolFacts, shot: boolean): ReactNode {
  if (facts.running) return null;

  if (facts.status.tone === "failure")
    return <p {...props(text.sm, toolCardStyles.failure)}>{facts.output}</p>;

  const name = message.state.name;

  if (name === "browser_console" || name === "browser_evaluate")
    return facts.output === "" ? null : <pre {...props(toolCardStyles.mono)}>{facts.output}</pre>;

  const file = shot ? screenshot(message) : undefined;

  return file === undefined ? null : <BlobImage file={file} compact />;
}

function screenshot(message: ToolMessage) {
  const state = message.state;

  if (state.phase !== "settled" || state.outcome.kind !== "ok") return undefined;

  return state.outcome.content.flatMap((content) =>
    content.kind === "file" && content.mime.startsWith("image/")
      ? [{ ...content, name: content.name ?? "Screenshot" }]
      : [],
  )[0];
}

function browserCopy(step: BrowserStep): StepCopy {
  switch (step.tool) {
    case "browser_open":
      return {
        icon: "globe",
        running: "Opening",
        done: "Opened",
        subject: step.args.url.replace(/^https?:\/\//u, ""),
      };
    case "browser_snapshot":
      return { icon: "eye", running: "Reading page", done: "Read page", muted: step.args.ref };
    case "browser_click":
      return {
        icon: "cursor-click",
        running: "Clicking",
        done:
          step.args.double === true
            ? "Double-clicked"
            : step.args.button === "right"
              ? "Right-clicked"
              : "Clicked",
        muted: step.args.ref,
      };
    case "browser_type":
      return {
        icon: "keyboard",
        running: "Typing",
        done: step.args.submit === true ? "Typed and submitted" : "Typed",
        subject: `“${step.args.text}”`,
        muted: step.args.ref,
      };
    case "browser_press":
      return { icon: "return", running: "Pressing", done: "Pressed", subject: step.args.key };
    case "browser_scroll":
      return {
        icon:
          step.args.direction === "up" || step.args.direction === "top"
            ? "mouse-scroll-up"
            : "mouse-scroll-down",
        running: "Scrolling",
        done: "Scrolled",
        subject: step.args.direction,
      };
    case "browser_wait":
      return {
        icon: "hourglass",
        running: "Waiting for",
        done: "Waited for",
        subject:
          step.args.for === "text"
            ? `“${step.args.text ?? ""}”`
            : step.args.for === "delay"
              ? `${String((step.args.ms ?? 1000) / 1000)} s`
              : "page load",
      };
    case "browser_console":
      return { icon: "console", running: "Reading console", done: "Read console" };
    case "browser_capture":
      return { icon: "camera", running: "Taking screenshot", done: "Took screenshot" };
    case "browser_evaluate":
      return {
        icon: "code-brackets",
        running: "Running JS",
        done: "Ran JS",
        muted: step.args.expression,
      };
    default: {
      const _exhaustive: never = step;

      return _exhaustive;
    }
  }
}
