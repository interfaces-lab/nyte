import { branchSummary, compaction, isPart } from "@nyte-ai/plugin/client";
import type { JSX } from "@opentui/solid";
import { createMemo, Match, Show, Switch } from "solid-js";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import { useApp } from "../../app/context.tsx";
import { omittedLabel, previewLines } from "../../lib/format.ts";
import { Spinner } from "../chrome/spinner.tsx";
import { Markdown } from "./markdown.tsx";

type MarkerProps =
  | { readonly variant: "default" | "live"; readonly content: string }
  | { readonly variant: "border"; readonly content: string; readonly summary: string };

const SUMMARY_LINES = 40;

function markerProps(message: PartMessage): MarkerProps {
  if (isPart(message, compaction))
    return message.status.kind === "live"
      ? { variant: "live", content: "compacting context…" }
      : {
          variant: "border",
          content: `context compacted · ${String(message.state.tokensBefore)} tokens before`,
          summary: message.state.summary ?? "",
        };

  if (isPart(message, branchSummary))
    return { variant: "border", content: "branch summary", summary: message.state.markdown };

  return { variant: "default", content: `[${message.partKind}]` };
}

export function Marker(props: { readonly message: PartMessage }): JSX.Element {
  const { kit } = useApp();
  const marker = createMemo(() => markerProps(props.message));

  const summary = createMemo(() => {
    const current = marker();

    if (current.variant !== "border") return "";
    const preview = previewLines(current.summary, { kind: "head", max: SUMMARY_LINES });

    return preview.omitted === 0
      ? preview.text
      : `${preview.text}\n${omittedLabel(preview.omitted)}`;
  });

  return (
    <Switch>
      <Match when={marker().variant === "default"}>
        <text id={`note:${props.message.id}`} fg={kit.theme().dim} wrapMode="word">
          {marker().content}
        </text>
      </Match>
      <Match when={marker().variant === "live"}>
        <box id={`note:${props.message.id}`} flexDirection="row" width="100%" height={1}>
          <Spinner />
          <text fg={kit.theme().dim} wrapMode="none" selectable={false}>
            {` ${marker().content}`}
          </text>
        </box>
      </Match>
      <Match when={marker().variant === "border"}>
        <box
          id={`note:${props.message.id}`}
          flexDirection="column"
          width="100%"
          border
          borderStyle="rounded"
          borderColor={kit.theme().promptBorder}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={kit.theme().dim} wrapMode="word">
            {marker().content}
          </text>
          <Show when={summary() !== ""}>
            <Markdown messageId={props.message.id} content={summary()} streaming={false} subtle />
          </Show>
        </box>
      </Match>
    </Switch>
  );
}
