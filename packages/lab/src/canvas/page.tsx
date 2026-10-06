import { create, keyframes, props } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isTerminalPhase } from "@nyte-ai/protocol";
import { ComposerFrame } from "@nyte-ai/app/conversation/composer.tsx";
import type {
  ComposerDocumentState,
  ComposerSubmission,
} from "@nyte-ai/app/conversation/composer-document.ts";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { canvasClient, compileDemo, openCanvasSession, useCanvasSession } from "./api";
import { demoSources, demoTurns, revealDemo } from "./demo";
import { CanvasTurn } from "./turn";

const PLAYBACK_MS = 700;

export function CanvasPage(): ReactElement {
  const [demo, setDemo] = useState(true);

  return (
    <main {...props(styles.page)}>
      {demo ? (
        <DemoConversation mode={<ModeToggle demo={demo} onChange={setDemo} />} />
      ) : (
        <LiveConversation mode={<ModeToggle demo={demo} onChange={setDemo} />} />
      )}
    </main>
  );
}

function ModeToggle({
  demo,
  onChange,
}: {
  readonly demo: boolean;
  readonly onChange: (demo: boolean) => void;
}): ReactElement {
  return (
    <Toggle size="sm" pressed={demo} onPressedChange={onChange}>
      Demo
    </Toggle>
  );
}

function Header({
  detail,
  children,
}: {
  readonly detail: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <header {...props(styles.header)}>
      <div {...props(styles.heading)}>
        <h1 {...props(styles.title)}>Canvas</h1>
        <p {...props(styles.detail)}>{detail}</p>
      </div>
      <div {...props(styles.actions)}>{children}</div>
    </header>
  );
}

function DemoConversation({ mode }: { readonly mode: ReactNode }): ReactElement {
  const [shown, setShown] = useState(1);

  const query = useQuery({
    queryKey: ["canvas", "demo"],
    queryFn: async () =>
      demoTurns(
        await Promise.all(demoSources.map(({ title, source }) => compileDemo({ title, source }))),
      ),
  });

  const turns = revealDemo(query.data ?? [], shown);
  const playing = query.data !== undefined && shown < query.data.length * 4;

  return (
    <>
      <Header detail="Scripted exchange · no model calls">
        <Button size="sm" onClick={() => setShown(1)} disabled={query.data === undefined}>
          Replay
        </Button>
        {mode}
      </Header>
      <section aria-label="Demo conversation" {...props(styles.transcript)}>
        {query.isPending && (
          <p role="status" {...props(styles.status)}>
            Compiling demo canvases…
          </p>
        )}
        {query.error !== null && (
          <p role="alert" {...props(styles.status)}>
            {query.error.message}
          </p>
        )}
        {turns.map((turn, index) => (
          <CanvasTurn key={turn.id} turn={turn} running={playing && index === turns.length - 1} />
        ))}
      </section>
      {playing && (
        <span
          key={shown}
          aria-hidden="true"
          onAnimationEnd={() => setShown((value) => value + 1)}
          {...props(styles.pacer(PLAYBACK_MS))}
        />
      )}
    </>
  );
}

function LiveConversation({ mode }: { readonly mode: ReactNode }): ReactElement {
  const [document, setDocument] = useState<ComposerDocumentState>({
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
  });

  const session = useMutation({ mutationFn: openCanvasSession });
  const sessionId = session.data?.sessionId;
  const live = useCanvasSession(sessionId);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const current = session.data ?? (await session.mutateAsync());
      await canvasClient().messages.send({
        sessionId: current.sessionId,
        key: crypto.randomUUID(),
        content: text,
      });
    },
  });

  const stop = useMutation({
    mutationFn: async () => {
      if (sessionId !== undefined) await canvasClient().runs.abort({ sessionId });
    },
  });

  const phase = live.snapshot?.run?.phase;

  const running =
    send.isPending ||
    (phase !== undefined && !isTerminalPhase(phase)) ||
    (live.snapshot?.pending.length ?? 0) > 0;

  const turns = (live.snapshot?.transcript ?? []).flatMap((turn) =>
    turn.kind === "turn" ? [turn] : [],
  );

  const submit = async ({ text }: ComposerSubmission): Promise<boolean> => {
    if (text.trim() === "" || running) return false;

    try {
      await send.mutateAsync(text.trim());
      setDocument({ text: "", selectionStart: 0, selectionEnd: 0 });

      return true;
    } catch {
      return false;
    }
  };

  const error = send.error ?? session.error ?? stop.error ?? live.error;

  return (
    <>
      <Header detail={`Live · ${session.data?.model ?? "openai-codex/gpt-6-luna"}`}>{mode}</Header>
      <section aria-label="Live conversation" {...props(styles.transcript)}>
        {turns.length === 0 && (
          <p {...props(styles.status)}>
            Ask for a chart or diagram. Nyte can read files in this repository.
          </p>
        )}
        {turns.map((turn, index) => (
          <CanvasTurn key={turn.id} turn={turn} running={running && index === turns.length - 1} />
        ))}
        {error !== null && (
          <p role="alert" {...props(styles.status)}>
            {error.message}
          </p>
        )}
      </section>
      <div {...props(styles.composer)}>
        <ComposerFrame
          surface="follow-up"
          document={document}
          onDocumentChange={setDocument}
          onSubmit={submit}
          onAbort={() => stop.mutate()}
          busy={running}
          placeholder="Ask Nyte to make a chart or diagram"
          suggestionCatalog={{
            status: "ready",
            data: { plugins: [], commands: [], skills: [], settings: [] },
          }}
          mentionFiles={{ status: "ready", data: [] }}
        />
      </div>
    </>
  );
}

const pace = keyframes({ from: { opacity: 0 }, to: { opacity: 0 } });

const styles = create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    boxSizing: "border-box",
    width: "100%",
    maxWidth: conversation.measure,
    minHeight: "100vh",
    marginInline: "auto",
    paddingBlock: "32px 96px",
    paddingInline: conversation.gutter,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  heading: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  title: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    fontWeight: 600,
  },
  detail: {
    margin: 0,
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  actions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  status: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  transcript: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.turnGap,
    minWidth: 0,
  },
  composer: {
    position: "sticky",
    insetBlockEnd: 0,
    marginTop: "auto",
    paddingBlock: 16,
    backgroundColor: role.bgBase,
  },
  pacer: (ms: number) => ({
    position: "absolute",
    opacity: 0,
    pointerEvents: "none",
    animationName: pace,
    animationDuration: `${ms}ms`,
  }),
});
