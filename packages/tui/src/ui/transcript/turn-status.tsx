import type { JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { failureNotice } from "@nyte-ai/plugin/client/presentation";
import { useApp } from "../../app/context.tsx";
import {
  ACTIVITY_RETRY_LABEL,
  ACTIVITY_THINKING_LABEL,
  ACTIVITY_WAITING_LABEL,
  ACTIVITY_WORKED_LABEL,
  ACTIVITY_WORKING_LABEL,
  GLYPHS,
  RECOVERY_STEPS,
} from "../../lib/constants.ts";
import { formatDuration, formatWholeDuration } from "@nyte-ai/plugin/client/presentation";
import { retryCause } from "../../lib/format.ts";
import type { CliTheme } from "../../lib/theme.ts";
import type { TurnStatus } from "../../model/transcript.ts";
import { Spinner } from "../chrome/spinner.tsx";

interface Line {
  readonly text: string;
  readonly color: string;
  readonly spinner: string | null;
}

const CLOCK_INTERVAL_MS = 1_000;

export function statusLine(status: TurnStatus, theme: CliTheme, now: number): Line {
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
      return {
        text: `${ACTIVITY_RETRY_LABEL} in ${formatWholeDuration(status.until - now)} (attempt ${String(status.attempt)}) · ${retryCause(status.reason)}`,
        color: theme.warning,
        spinner: theme.warning,
      };
    case "settled": {
      if (status.failure !== null) {
        const notice = failureNotice(status.failure);
        const step = notice.recovery === undefined ? "" : ` ${RECOVERY_STEPS[notice.recovery]}`;

        return notice.tone === "danger"
          ? { text: `${GLYPHS.cross} ${notice.text}${step}`, color: theme.error, spinner: null }
          : { text: `! ${notice.text}`, color: theme.warning, spinner: null };
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
  const [now, setNow] = createSignal(kit.now());

  createEffect(() => {
    if (props.status.kind !== "retrying") return;
    const tick = kit.ticker(CLOCK_INTERVAL_MS);

    createEffect(() => {
      tick();
      setNow(kit.now());
    });
  });

  const line = createMemo(() => statusLine(props.status, kit.theme(), now()));

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
