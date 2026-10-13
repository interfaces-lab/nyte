/**
 * The status row: spinner + "Working · <activity>" / "Thinking…" / "Retrying",
 * "• Waiting for your answer", or settled "Worked for 12s" (from the turn's
 * own startedAt/endedAt) / the failure notice / "! Stopped".
 */
import type { JSX } from "@opentui/solid";
import { createMemo, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import {
  ACTIVITY_RETRY_LABEL,
  ACTIVITY_THINKING_LABEL,
  ACTIVITY_WAITING_LABEL,
  ACTIVITY_WORKED_LABEL,
  ACTIVITY_WORKING_LABEL,
  GLYPHS,
} from "../../lib/constants.ts";
import { formatDuration } from "../../lib/format.ts";
import type { CliTheme } from "../../lib/theme.ts";
import { failureNotice } from "../../lib/tool-copy.ts";
import type { TurnStatus } from "../../model/transcript.ts";
import { Spinner } from "../chrome/spinner.tsx";

interface Line {
  readonly text: string;
  readonly color: string;
  readonly spinner: string | null;
}

function lineOf(status: TurnStatus, theme: CliTheme): Line {
  switch (status.kind) {
    case "unanswered":
      return { text: "", color: theme.dim, spinner: null };
    case "working":
      return {
        text: status.activity === null ? ACTIVITY_WORKING_LABEL : ` ${status.activity}`,
        color: theme.dim,
        spinner: theme.running,
      };
    case "thinking":
      return { text: ACTIVITY_THINKING_LABEL, color: theme.thinking, spinner: theme.thinking };
    case "waiting":
      return {
        text: `${GLYPHS.bullet}${ACTIVITY_WAITING_LABEL}`,
        color: theme.warning,
        spinner: null,
      };
    case "retrying":
      return { text: ACTIVITY_RETRY_LABEL, color: theme.warning, spinner: theme.warning };
    case "settled": {
      if (status.failure !== null) {
        const notice = failureNotice(status.failure);

        return { text: notice.text, color: theme[notice.tone], spinner: null };
      }

      const duration =
        status.durationMs === null ? "" : ` for ${formatDuration(status.durationMs)}`;

      return { text: `${ACTIVITY_WORKED_LABEL}${duration}`, color: theme.dim, spinner: null };
    }

    default: {
      const _exhaustive: never = status;

      return _exhaustive;
    }
  }
}

export function TurnStatusRow(props: {
  readonly status: TurnStatus;
  readonly turn?: string;
}): JSX.Element {
  const { kit } = useApp();
  const line = createMemo(() => lineOf(props.status, kit.theme()));

  return (
    <box
      id={props.turn === undefined ? undefined : `status:${props.turn}`}
      flexDirection="row"
      width="100%"
      height={1}
      flexShrink={0}
    >
      <Show when={line().spinner}>{(color: Accessor<string>) => <Spinner color={color()} />}</Show>
      <text fg={line().color} wrapMode="none" selectable={false}>
        {line().text}
      </text>
    </box>
  );
}
