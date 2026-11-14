import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { create, props } from "@stylexjs/stylex";
import { media, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import type { ReactElement } from "react";
import type { CommitId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { useCopyConfirmation } from "../../components/copy-confirmation.ts";
import { forkChat } from "../../data/session-actions.ts";
import { useNowMinute } from "../../lib/use-now-minute.ts";
import { conversation } from "../../theme/schema.stylex.ts";
import { Prose } from "../markdown/prose.tsx";
import { stepGroupStyles } from "./step-group.stylex.ts";
import { useTranscriptScope } from "./transcript.tsx";
import { replyAge } from "./transcript-presentation.ts";
import { responseRowView } from "./transcript-row-views.ts";
import type { TurnItemRow } from "./transcript-rows.ts";

const replyStyles = create({
  reply: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    minWidth: 0,
    "--_reply-time-opacity": {
      default: 0,
      ":hover": { [media.hover]: 1 },
      ":focus-within": 1,
    },
  },
  latest: { "--_reply-time-opacity": 1 },
  actions: { display: "flex", alignItems: "center", gap: space.s1 },
  time: {
    color: role.contentTertiary,
    opacity: "var(--_reply-time-opacity)",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

export function ResponseView({
  row,
}: {
  row: Extract<TurnItemRow, { kind: "response" }>;
}): ReactElement | null {
  const view = responseRowView(row);

  if (view === null) return null;

  return (
    <div {...props(replyStyles.reply, view.latest && replyStyles.latest)}>
      {view.worked !== undefined && <span {...props(stepGroupStyles.status)}>{view.worked}</span>}
      <Prose markdown={view.markdown} streaming={view.streaming} />
      {view.ended && (
        <ReplyActions
          markdown={view.markdown}
          at={view.at}
          worked={view.worked}
          commit={view.commit}
        />
      )}
    </div>
  );
}

const SENT_AT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function ReplyActions({
  markdown,
  at,
  worked,
  commit,
}: {
  markdown: string;
  at: number;
  worked: string | undefined;
  commit: CommitId | undefined;
}): ReactElement {
  const sessionId = useTranscriptScope()?.sessionId;
  const confirmation = useCopyConfirmation();
  const now = useNowMinute();
  const sent = new Date(at);
  const full = SENT_AT.format(sent);

  return (
    <div {...props(text.sm, replyStyles.actions)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              icon={confirmation.copied ? "checkmark" : "copy"}
              data-copied={confirmation.copied || undefined}
              aria-label="Copy reply"
              onClick={() => confirmation.copy(markdown)}
            />
          }
        />
        <TooltipContent>{confirmation.copied ? "Copied" : "Copy reply"}</TooltipContent>
      </Tooltip>
      {sessionId !== undefined && commit !== undefined && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                icon="fork"
                aria-label="Fork chat from here"
                onClick={() => void forkChat(sessionId, commit)}
              />
            }
          />
          <TooltipContent>Fork chat from here</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <time dateTime={sent.toISOString()} {...props(replyStyles.time)}>
              <span aria-hidden="true">{replyAge(at, now)}</span>
              <span {...props(srOnly)}>Message sent {full}</span>
            </time>
          }
        />
        <TooltipContent>
          {full}
          {worked !== undefined && (
            <>
              <br />
              {worked}
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
