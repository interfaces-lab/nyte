import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { asId } from "@nyte-ai/schema";
import type { SessionView } from "@nyte-ai/sdk";
import { conversationTurns } from "@nyte-ai/app/view-helpers.ts";
import { ComposerFrame } from "@nyte-ai/app/conversation/composer-frame.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "@nyte-ai/app/conversation/composer-document.ts";
import { LiveTurn, liveTurnStyles } from "@nyte-ai/app/conversation/live-turn.tsx";
import { StatusMarker } from "@nyte-ai/app/conversation/row-surfaces.tsx";
import { SubagentSessionsProvider } from "@nyte-ai/app/conversation/subagent-sessions.ts";
import { displayTranscriptParts } from "@nyte-ai/app/conversation/transcript-presentation.ts";
import { conversationMessages, transcriptRows } from "@nyte-ai/app/conversation/transcript-rows.ts";
import type { TranscriptRow } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { TurnItemView, UserMessageView } from "@nyte-ai/app/conversation/turn-view.tsx";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { directorConnection, startDirector, useDirectorModel, useDirectorSession } from "./api";

const CWD = "video/src/film";
const NO_CHANGES: SessionView["changes"] = [];
const noSubagents = { children: [], open: () => {} };
const noop = () => {};

function Row({ row, working, settledWork }: { readonly row: TranscriptRow; readonly working: boolean; readonly settledWork: boolean }): ReactElement | null {
  switch (row.kind) {
    case "part":
    case "step":
    case "agents":
    case "response":
    case "failure":
    case "changes":
      return (
        <TurnItemView
          row={row}
          running={(row.kind === "step" || row.kind === "changes") && row.trailing && working}
          density="balanced"
          cwd={CWD}
          onEditUser={async () => {}}
          branchModel={{ catalog: undefined, model: undefined, thinkingLevel: undefined, fast: false }}
          onOpenChanges={noop}
        />
      );
    case "landing":
      return (
        <div {...props(liveTurnStyles.root, row.pending && liveTurnStyles.pending)}>
          <UserMessageView content={row.message.source.kind === "action" ? row.message.source.label : row.message.content} />
        </div>
      );
    case "retry":
      return (
        <StatusMarker role="status" variant="retrying" title={row.message}>
          Retrying…
        </StatusMarker>
      );
    case "live":
      return <LiveTurn working={working} settledWork={settledWork} density="balanced" cwd={CWD} />;
    default:
      return null;
  }
}

const empty: ComposerDocumentState = { text: "", selectionStart: 0, selectionEnd: 0 };

/** A Nyte chat with the director. Every message carries what is on screen, like "[nyte · frame 96 · 3.20 s]". */
export function Chat({ context, frame }: { readonly context: string; readonly frame: number }): ReactElement {
  const [document, setDocument] = useState(empty);
  const model = useDirectorModel();
  const session = useMutation({ mutationFn: startDirector });
  const sessionId = session.data === undefined ? undefined : asId<"session">(session.data.sessionId);
  const { view, error: watchError } = useDirectorSession(sessionId);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const content = `[${context}] ${text}`;
      if (session.data === undefined) {
        await session.mutateAsync(content);
        return;
      }
      await (await directorConnection()).session(asId<"session">(session.data.sessionId)).send(content);
    },
  });

  const stop = useMutation({
    mutationFn: async () => {
      if (sessionId !== undefined) await (await directorConnection()).session(sessionId).stop();
    },
  });

  const turns = useMemo(() => (view === undefined ? [] : conversationTurns(view).turns), [view]);
  const messages = useMemo(() => conversationMessages(view), [view]);
  const working = send.isPending || messages.running || messages.submitted.length > 0;
  const last = turns.at(-1);
  const settledWork = last !== undefined && displayTranscriptParts(last.messages).at(-1)?.kind === "step";

  const rows = useMemo(
    () =>
      transcriptRows({
        loading: false,
        failed: false,
        turns,
        changes: view?.changes ?? NO_CHANGES,
        landing: messages.submitted,
        held: messages.held,
        retrying: view?.execution.kind === "retrying" ? view.execution.reason : undefined,
        working,
        running: messages.running,
      }),
    [turns, view, messages, working],
  );

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [rows]);

  const submit = async ({ text }: ComposerSubmission): Promise<boolean> => {
    if (text.trim() === "" || working) return false;
    try {
      await send.mutateAsync(text.trim());
      setDocument(empty);
      return true;
    } catch {
      return false;
    }
  };

  const error = send.error ?? session.error ?? stop.error ?? watchError ?? model.error;

  return (
    <section aria-label="Director" {...props(styles.panel)}>
      <header {...props(styles.header)}>
        <span {...props(styles.title)}>director</span>
        <span {...props(styles.detail)}>{model.data?.model ?? (model.isPending ? "opening core…" : "no model")}</span>
      </header>
      <div ref={scroller} {...props(styles.transcript)}>
        {rows.length === 0 ? (
          <p {...props(styles.hint)}>
            Scrub to a moment and say what should change. “Make the moon rise slower.” “Hold the name longer.” “Warmer dawn.”
          </p>
        ) : (
          <SubagentSessionsProvider value={noSubagents}>
            {rows.map((row) => (
              <Row key={row.messageId} row={row} working={working} settledWork={settledWork} />
            ))}
          </SubagentSessionsProvider>
        )}
        {error !== null && (
          <p role="alert" {...props(styles.error)}>
            {error.message}
          </p>
        )}
      </div>
      <div {...props(styles.composer)}>
        <ComposerFrame
          surface="follow-up"
          document={document}
          onDocumentChange={setDocument}
          onSubmit={submit}
          onAbort={() => stop.mutate()}
          busy={working}
          placeholder={`Change frame ${frame}…`}
          suggestionCatalog={{ status: "ready", data: { commands: [], skills: [] } }}
          mentionFiles={{ status: "ready", data: [] }}
        />
      </div>
    </section>
  );
}

const styles = create({
  panel: { display: "flex", flexDirection: "column", minHeight: 0, height: "100%" },
  header: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingBlock: 10, paddingInline: 14, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: role.borderSecondary },
  title: { fontFamily: type.fontMono, fontSize: type.fontSm, color: role.contentPrimary },
  detail: { fontFamily: type.fontMono, fontSize: type.fontXs, color: role.contentTertiary },
  transcript: { flex: 1, minHeight: 0, overflowY: "auto", paddingBlock: 14, paddingInline: 14, display: "flex", flexDirection: "column" },
  hint: { margin: 0, color: role.contentTertiary, fontSize: type.fontSm, lineHeight: type.leadingSm },
  error: { margin: 0, marginTop: 8, color: role.contentSecondary, fontSize: type.fontSm },
  composer: { paddingBlock: 12, paddingInline: 12 },
});
