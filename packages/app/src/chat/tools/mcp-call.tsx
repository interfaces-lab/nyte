import { create, props } from "@stylexjs/stylex";
import { Fragment, useState } from "react";
import type { ReactElement } from "react";
import { isJsonObject } from "@nyte-ai/schema";
import { formatDuration, toolOutput, toolStatus } from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { ToolCard, ToolMark, ToolVerb, brandName, toolCardStyles } from "./tool-card.tsx";
import { ToolOutcome } from "./tool-line.tsx";
import { ToolOutputText, outputExcerpt } from "./tool-output.tsx";
import { useWholeToolState } from "./whole-tool-state.ts";

const styles = create({
  sections: { display: "flex", flexDirection: "column", gap: space.s2, padding: space.s2 },
  section: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  heading: { margin: 0, color: role.contentTertiary },
  fields: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    columnGap: space.s3,
    rowGap: space.s0_5,
    margin: 0,
  },
  key: { color: role.contentTertiary },
  value: { margin: 0 },
  output: {
    maxHeight: 160,
    paddingBlock: space.s1_5,
    paddingInline: space.s2,
    overflowY: "auto",
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
  },
  fact: { color: role.contentTertiary, fontVariantNumeric: "tabular-nums" },
});

export function McpCallView({
  message,
  server,
  title,
}: {
  readonly message: ToolMessage;
  readonly server: string;
  readonly title: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const state = useWholeToolState(message, open);
  const status = toolStatus(message);
  const running = status.tense === "running";
  const output = toolOutput(state).trimEnd();
  const args = message.state.args;

  const durationMs =
    message.status.kind === "settled" ? message.status.endedAt - message.at : undefined;

  return (
    <ToolCard
      label={`${title} in ${brandName(server)}`}
      lead={<ToolMark name={server} fallback="mcp" />}
      running={running}
      onOpenChange={setOpen}
      title={
        <>
          <ToolVerb running={running}>{running ? "Running" : "Ran"}</ToolVerb>
          <span {...props(toolCardStyles.subject)}>{title}</span>
          <span {...props(toolCardStyles.muted)}>in {brandName(server)}</span>
          <ToolOutcome status={status} />
        </>
      }
    >
      <div {...props(styles.sections)}>
        <section {...props(styles.section)}>
          <h4 {...props(text.sm, styles.heading)}>Input</h4>
          {isJsonObject(args) ? (
            <dl {...props(text.sm, styles.fields)}>
              {Object.entries(args).map(([key, value]) => (
                <Fragment key={key}>
                  <dt {...props(toolCardStyles.mono, styles.key)}>{key}</dt>
                  <dd {...props(toolCardStyles.mono, styles.value)}>{JSON.stringify(value)}</dd>
                </Fragment>
              ))}
            </dl>
          ) : (
            <pre {...props(toolCardStyles.mono)}>{JSON.stringify(args)}</pre>
          )}
        </section>
        {output !== "" && (
          <section {...props(styles.section)}>
            <h4 {...props(text.sm, styles.heading)}>
              {status.tone === "failure" ? "Error" : "Output"}
            </h4>
            <div
              role="region"
              aria-label="Tool output"
              data-nyte-scrollport
              {...props(toolCardStyles.mono, styles.output)}
            >
              <ToolOutputText raw={output} excerpt={outputExcerpt(output)} />
            </div>
            {durationMs !== undefined && (
              <span {...props(text.xs, styles.fact)}>{formatDuration(durationMs)}</span>
            )}
          </section>
        )}
      </div>
    </ToolCard>
  );
}
