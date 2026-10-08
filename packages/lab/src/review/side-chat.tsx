/**
 * The side chat: questions beside the pull request, drawn with the app's own
 * conversation parts (TurnView with its working groups, ComposerFrame). It
 * is not a place and is never saved as a chat; the toolbar's Ask opens it on
 * every view.
 *
 * A thread is demo or live. Live, a question goes to a fork of the guide's
 * brief, cut by the thread's first question, so it starts from everything
 * the guide read; a change goes to Nyte on the branch. Demo plays a scripted
 * turn instead and calls no model. A CSS animation paces it, so nothing here
 * needs a timer.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import { useRef, useState, type ReactElement } from "react";
import type { ComposerSubmission } from "@nyte-ai/app/conversation/composer-document.ts";
import type {
  ComposerMentionFiles,
  ComposerSuggestionCatalog,
} from "@nyte-ai/app/conversation/composer-suggestions.tsx";
import { ComposerFrame } from "@nyte-ai/app/conversation/composer.tsx";
import { StatusMarker } from "@nyte-ai/app/conversation/row-surfaces.tsx";
import { composerStyles } from "@nyte-ai/app/conversation/styles.stylex.ts";
import { TurnView } from "@nyte-ai/app/conversation/turn-view.tsx";
import { preferences, useSetting } from "@nyte-ai/app/preferences/index.ts";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Toggle } from "@nyte-ai/ui/toggle";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { useAsk, useChange, useRepo, useSideThread } from "./api";
import {
  PART_MS,
  demoTurn,
  playing,
  shownTurn,
  stop,
  type DemoExchange,
  type Recipient,
} from "./demo-thread";
import type { GuideWriting } from "./guide";
import { useReviewState } from "./review-state";
import type { ReviewDetail } from "./wire";

const NO_LIVE_TOOLS = new Map();

const NO_SUGGESTIONS = {
  status: "ready",
  data: { plugins: [], commands: [], skills: [], settings: [] },
} satisfies ComposerSuggestionCatalog;

const NO_FILES = { status: "ready", data: [] } satisfies ComposerMentionFiles;

export function SideChat({
  review,
  version,
  writing,
}: {
  readonly review: ReviewDetail;
  readonly version: number;
  readonly writing: GuideWriting;
}): ReactElement {
  const root = useRepo().data?.root;
  const density = useSetting(preferences.toolCalls);
  const local = useReviewState(review.id, review.files);
  const { thread } = local;
  const [recipient, setRecipient] = useState<Recipient>("reviewer");
  const liveTurns = useSideThread(review, thread.kind === "live" ? thread : undefined, version);
  const ask = useAsk(review.id);
  const change = useChange(review.id);
  const focused = useRef(-1);
  const head = review.revision.head;
  const brief = review.briefs.find((entry) => entry.head === head);
  const guided = brief?.status === "done" && brief.guide !== undefined;
  const last = thread.kind === "demo" ? thread.exchanges.at(-1) : undefined;
  const turns = thread.kind === "demo" ? thread.exchanges.map(shownTurn) : liveTurns;

  const running =
    thread.kind === "demo"
      ? last !== undefined && playing(last)
      : review.author?.status === "working" ||
        review.threads.some((fork) => fork.thread === thread.id && fork.status === "running");

  const closed =
    thread.kind === "live" && (recipient === "reviewer" ? !guided : review.blocked !== undefined);

  const updateLast = (next: (exchange: DemoExchange) => DemoExchange): void =>
    local.updateDemo((exchanges) =>
      exchanges.map((exchange, index) =>
        index === exchanges.length - 1 ? next(exchange) : exchange,
      ),
    );

  const send = async ({ text }: ComposerSubmission): Promise<boolean> => {
    const message = text.trim();

    if (message === "" || running || closed) return false;

    if (thread.kind === "demo") {
      const paths = review.files.map((file) => file.path);

      local.updateDemo((exchanges) => [
        ...exchanges,
        demoTurn({ text: message, recipient, paths }),
      ]);
    } else {
      const key = crypto.randomUUID();

      const sent =
        recipient === "reviewer"
          ? ask.mutateAsync({ head, thread: thread.id, key, text: message })
          : change.mutateAsync({ key, text: message });

      if (
        !(await sent.then(
          () => true,
          () => false,
        ))
      )
        return false;
    }

    local.setDraft({ text: "", selectionStart: 0, selectionEnd: 0 });

    return true;
  };

  return (
    <aside aria-label="Side chat" {...props(styles.panel)}>
      <header {...props(styles.header)}>
        <span {...props(styles.title)}>Side chat</span>
        <Toggle
          pressed={thread.kind === "demo"}
          onPressedChange={(demo) => local.startThread(demo ? "demo" : "live")}
        >
          Demo
        </Toggle>
        <Button
          iconOnly
          icon="new-chat"
          aria-label="New thread"
          disabled={turns.length === 0}
          onClick={() => local.startThread(thread.kind)}
        />
      </header>
      <div {...props(styles.scroller)}>
        <div {...props(styles.transcript)}>
          {turns.length === 0 && (
            <div {...props(styles.empty)}>
              {thread.kind === "demo" && "Replies are scripted. Nothing calls a model."}
              {thread.kind === "live" &&
                guided &&
                `Questions fork the guide for ${head.slice(0, 7)}.`}
              {thread.kind === "live" &&
                !guided &&
                (brief?.status === "running" || writing.requesting ? (
                  <>
                    <Spinner /> Writing the guide
                  </>
                ) : (
                  <>
                    Questions fork the guide.
                    <Button size="sm" onClick={writing.onWrite}>
                      Write Guide
                    </Button>
                  </>
                ))}
            </div>
          )}
          {turns.map((turn, index) => (
            <TurnView
              key={turn.id}
              turn={turn}
              density={density}
              liveTools={NO_LIVE_TOOLS}
              cwd={root}
              onOpenChanges={() => {}}
              running={running && index === turns.length - 1}
            />
          ))}
          {(ask.error ?? change.error) !== null && (
            <StatusMarker role="alert" variant="destructive">
              {(ask.error ?? change.error)?.message}
            </StatusMarker>
          )}
        </div>
      </div>
      {last !== undefined && playing(last) && (
        <span
          key={`${last.turn.id}:${last.shown}`}
          aria-hidden="true"
          onAnimationEnd={() =>
            updateLast((exchange) => ({ ...exchange, shown: exchange.shown + 1 }))
          }
          {...props(styles.pacer(PART_MS))}
        />
      )}
      <div {...props(composerStyles.dock, styles.dock)}>
        <div role="region" aria-label="Side chat input" {...props(composerStyles.region)}>
          <div {...props(composerStyles.inputStack)}>
            <ComposerFrame
              surface="follow-up"
              document={local.draft}
              onDocumentChange={local.setDraft}
              onSubmit={send}
              placeholder={
                recipient === "reviewer" ? "Ask about this change" : "Describe the change"
              }
              disabled={closed}
              busy={thread.kind === "demo" && running}
              onAbort={() => updateLast(stop)}
              suggestionCatalog={NO_SUGGESTIONS}
              mentionFiles={NO_FILES}
              inputRef={(handle) => {
                // Opening the side chat, or "Ask about this section", asks for focus by bumping the counter.
                if (handle === null || focused.current === local.focus) return;

                focused.current = local.focus;
                handle.focus();
              }}
              model={
                <Menu>
                  <MenuTrigger
                    render={
                      <Button size="sm" aria-description="Who answers">
                        {recipient === "reviewer" ? "Ask" : "Change"}
                        <Icon name="chevron-down" size={12} />
                      </Button>
                    }
                  />
                  <MenuContent align="start">
                    <MenuRadioGroup
                      value={recipient}
                      onValueChange={(value) =>
                        setRecipient(value === "nyte" ? "nyte" : "reviewer")
                      }
                    >
                      <MenuRadioItem value="reviewer">Ask the guide</MenuRadioItem>
                      <MenuRadioItem value="nyte">Ask Nyte to change it</MenuRadioItem>
                    </MenuRadioGroup>
                  </MenuContent>
                </Menu>
              }
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

const pace = keyframes({ from: { opacity: 0 }, to: { opacity: 0 } });

const styles = create({
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "min(420px, 42%)",
    minWidth: 320,
    minHeight: 0,
    flexShrink: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.borderSecondaryTranslucent,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    paddingBlock: 6,
    paddingInline: "16px 8px",
  },
  title: { flex: 1, color: role.contentPrimary, fontSize: type.fontSm, fontWeight: 600 },
  // Reversed, so the newest message stays in view as turns arrive and nothing has to scroll it there.
  scroller: {
    display: "flex",
    flexDirection: "column-reverse",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  transcript: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.turnGap,
    paddingBlock: 16,
    paddingInline: conversation.gutter,
  },
  empty: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    textWrap: "pretty",
  },
  // The demo's clock: each run of this invisible animation lets the next part of the scripted turn land.
  pacer: (ms: number) => ({
    position: "absolute",
    opacity: 0,
    pointerEvents: "none",
    animationName: pace,
    animationDuration: `${ms}ms`,
  }),
  dock: { position: "relative", flexShrink: 0 },
});
