"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  TerminalHints,
  TerminalPrompt,
  TerminalTitle,
  Tool,
  terminalPalette,
} from "../plate/hosts/terminal-host";
import type { Turn } from "./use-session";

export interface ClientProps {
  transcript: ReactNode;
  turns: readonly Turn[];
  draft: string;
  busy: boolean;
  onDraft: (text: string) => void;
  onSend: () => void;
}

const FRAMES = ["⠀⠰", "⠀⡷", "⢸⡷", "⢾⡷", "⢾⡇", "⢾⠀", "⠆⠀"] as const;

/* The TUI's activity spinner: the same frames, every 130ms. */
function Spinner() {
  const [frame, setFrame] = useState(3);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setFrame((current) => (current + 1) % FRAMES.length), 130);
    return () => clearInterval(timer);
  }, []);

  return <span className="text-(--t-accent)">{FRAMES[frame]}</span>;
}

function TerminalTurn({ turn }: { turn: Turn }) {
  return (
    <>
      <p className="mx-[2ch] mt-[1lh] bg-(--t-band) py-[1lh] pr-[1ch] pl-[3ch] break-words">
        {turn.text}
      </p>
      {turn.tools.length > 0 ? (
        <div className="pr-[2ch] pl-[3ch]">
          {turn.tools.map((tool) => (
            <Tool key={tool.verb} verb={tool.verb.toLowerCase()} subject={tool.subject}>
              {tool.note}
            </Tool>
          ))}
        </div>
      ) : null}
      {turn.reply ? <p className="mt-[1lh] pr-[2ch] pl-[3ch]">{turn.reply}</p> : null}
      {turn.phase === "working" ? (
        <p className="mt-[1lh] pl-[1ch] whitespace-pre">
          <Spinner />
          <span className="text-(--t-dim)"> Working</span>
        </p>
      ) : null}
      {turn.phase === "done" ? (
        <p className="mt-[1lh] pl-[3ch] text-(--t-dim)">Worked for {turn.seconds.toFixed(1)}s</p>
      ) : null}
    </>
  );
}

export function LiveTerminal({ transcript, turns, draft, busy, onDraft, onSend }: ClientProps) {
  return (
    <div
      className={`flex h-full flex-col overflow-clip rounded-[14px] text-left shadow-[0_0_0_1px_rgb(0_0_0/0.05)] ${terminalPalette}`}
    >
      <TerminalTitle />
      <div className="@container flex min-h-0 flex-1 flex-col font-mono text-[12px]/[1.25]">
        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-clip py-[1lh]">
          <div className="mb-auto">
            {transcript}
            {turns.map((turn) => (
              <TerminalTurn key={turn.id} turn={turn} />
            ))}
          </div>
        </div>
        <form
          className="shrink-0"
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <TerminalPrompt>
            <input
              aria-label="Message"
              value={draft}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onDraft(event.target.value)}
              placeholder={busy ? "Steer the run" : "Plan, search, build anything"}
              className="h-[1lh] min-w-0 flex-1 bg-transparent p-0 text-(--t-fg) caret-(--t-accent) outline-none placeholder:text-(--t-dim)"
            />
          </TerminalPrompt>
        </form>
        <TerminalHints />
      </div>
    </div>
  );
}
