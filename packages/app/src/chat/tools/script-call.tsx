import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { isJsonObject } from "@nyte-ai/schema";
import { codemodeParameters } from "@nyte-ai/plugin/codemode/schema";
import { readMcpCall } from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { Icon } from "@nyte-ai/ui/icon";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import {
  ToolCard,
  ToolMark,
  ToolSpinner,
  ToolVerb,
  brandName,
  toolCardStyles,
} from "./tool-card.tsx";
import { ToolOutcome } from "./tool-line.tsx";
import { toolFacts } from "./tool-facts.ts";

const styles = create({
  calls: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: space.s1,
    paddingInline: space.s2,
  },
  code: { paddingBlock: space.s2, paddingInline: space.s2, overflowX: "auto", whiteSpace: "pre" },
});

export function ScriptCallView({
  message,
  calls,
}: {
  readonly message: ToolMessage;
  readonly calls: readonly ToolMessage[];
}): ReactElement {
  const facts = toolFacts(message, message.state, undefined, "script");
  const status = facts.status;
  const running = facts.running;
  const checked = codemodeParameters["~standard"].validate(message.state.args);
  const code = checked instanceof Promise || checked.issues !== undefined ? "" : checked.value.code;

  const places = [...new Set(calls.map((call) => callName(call).place))].filter(
    (place) => place !== undefined,
  );

  return (
    <ToolCard
      label="Script"
      lead={
        <span aria-hidden="true" {...props(toolCardStyles.glyph)}>
          <Icon name="script" size="sm" />
        </span>
      }
      running={running}
      spins={false}
      title={
        <>
          <ToolVerb running={running}>{running ? "Running script" : "Ran script"}</ToolVerb>
          {calls.length > 0 && (
            <span {...props(toolCardStyles.muted)}>
              {calls.length} {calls.length === 1 ? "call" : "calls"}
              {places.length > 0 && ` in ${places.join(", ")}`}
            </span>
          )}
          <ToolOutcome status={status} />
        </>
      }
      preview={
        calls.length === 0 ? undefined : (
          <div {...props(styles.calls, hairline.blockStart)}>
            {calls.map((call) => (
              <ScriptCallRow key={call.id} call={call} />
            ))}
          </div>
        )
      }
    >
      <pre {...props(toolCardStyles.mono, styles.code)}>{code}</pre>
    </ToolCard>
  );
}

function ScriptCallRow({ call }: { readonly call: ToolMessage }): ReactElement {
  const facts = toolFacts(call, call.state, undefined, "script");
  const status = facts.status;
  const name = callName(call);
  const args = call.state.args;

  return (
    <div {...props(toolCardStyles.stack)}>
      <div {...props(toolCardStyles.line)}>
        {status.tense === "running" ? (
          <ToolSpinner />
        ) : (
          <ToolMark name={name.server ?? ""} fallback="mcp" />
        )}
        <span {...props(toolCardStyles.subject)}>{name.title}</span>
        {isJsonObject(args) && (
          <span {...props(toolCardStyles.muted)}>
            {Object.values(args)
              .map((value) => JSON.stringify(value))
              .join(" · ")}
          </span>
        )}
        <ToolOutcome status={status} />
      </div>
      {status.tone === "failure" && (
        <p {...props(text.sm, toolCardStyles.failure, toolCardStyles.hang)}>{facts.output}</p>
      )}
    </div>
  );
}

function callName(call: ToolMessage) {
  const mcp = readMcpCall(
    call.state.name,
    call.state.class.kind === "custom" ? call.state.class.label : "",
  );

  return mcp === null
    ? { title: call.state.name, server: undefined, place: undefined }
    : { title: mcp.title, server: mcp.server, place: brandName(mcp.server) };
}
