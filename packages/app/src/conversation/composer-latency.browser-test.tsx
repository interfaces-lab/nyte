import "../../test/window-bridge.ts";
// oxlint-disable-next-line no-restricted-imports -- the stream loop runs only while the flag is set
import { StrictMode, memo, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { ComposerFrame } from "./composer-frame.tsx";
import type { ComposerDocumentState } from "./composer-document.ts";
import { Prose } from "./prose.tsx";

const WORDS =
  "the quick brown fox jumps over the lazy dog while the model streams tokens into the transcript and the composer must keep every keystroke on its own frame".split(
    " ",
  );

const SETTLED_ROWS = 120;

const TYPED = "hello from the composer latency test";

const KEY_INTERVAL_MS = 30;

function settledMarkdown(index: number): string {
  return `### Turn ${String(index)}\n\n${WORDS.slice(0, 18).join(" ")}.\n\n- ${WORDS.slice(3, 9).join(" ")}\n- ${WORDS.slice(9, 15).join(" ")}\n\n\`\`\`ts\nconst value${String(index)} = ${String(index)};\n\`\`\``;
}

const SettledTranscript = memo(function SettledTranscript(): ReactElement {
  return (
    <>
      {Array.from({ length: SETTLED_ROWS }, (_, index) => (
        <Prose key={index} markdown={settledMarkdown(index)} />
      ))}
    </>
  );
});

function StreamingProse({ running }: { running: boolean }): ReactElement {
  const [markdown, setMarkdown] = useState("");
  useEffect(() => {
    if (!running) return undefined;
    let frame = 0;
    let count = 0;

    const tick = (): void => {
      count += 1;
      setMarkdown((current) => `${current} ${WORDS[count % WORDS.length] ?? ""}`);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [running]);

  return <Prose markdown={markdown} streaming />;
}

function Harness({ streaming }: { streaming: boolean }): ReactElement {
  const [document, setDocument] = useState<ComposerDocumentState>({
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <SettledTranscript />
        <StreamingProse running={streaming} />
      </div>
      <ComposerFrame
        surface="follow-up"
        document={document}
        onDocumentChange={setDocument}
        onSubmit={() => undefined}
        placeholder="Type"
        suggestionCatalog={{
          status: "ready",
          data: { commands: [], skills: [] },
        }}
        mentionFiles={{ status: "ready", data: [] }}
      />
    </div>
  );
}

interface FrameSample {
  readonly at: number;
  readonly length: number;
}

export interface LatencyReport {
  readonly streaming: boolean;
  readonly typed: number;
  readonly rendered: number;
  readonly maxCharsPerFrame: number;
  readonly maxLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly frames: number;
  readonly longestFrameMs: number;
  readonly coalescedAtMs: readonly number[];
}

function editorElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[aria-multiline][aria-label='Message']");

  if (element === null) {
    const labels = [...document.querySelectorAll("[aria-label]")].map((node) =>
      node.getAttribute("aria-label"),
    );

    throw new Error(
      `Composer editor not mounted: ${labels.join(",")} ${String(document.body.lastElementChild?.innerHTML.length)}`,
    );
  }

  return element;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(streaming: boolean): Promise<LatencyReport> {
  const client = new QueryClient();
  const host = document.createElement("div");
  document.body.style.margin = "0";
  document.body.append(host);
  let failure: unknown;

  const root = createRoot(host, {
    onUncaughtError: (error) => {
      failure = error;
    },
  });

  flushSync(() =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <Harness streaming={streaming} />
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
  await wait(300);

  if (failure !== undefined) throw failure;
  const editor = editorElement();
  editor.focus();

  for (const character of "warm") {
    document.execCommand("insertText", false, character);
    await wait(KEY_INTERVAL_MS);
  }

  await wait(200);
  const base = editor.textContent.length;

  const samples: FrameSample[] = [];
  let sampling = true;

  const sample = (): void => {
    samples.push({ at: performance.now(), length: editor.textContent.length - base });

    if (sampling) requestAnimationFrame(sample);
  };

  requestAnimationFrame(sample);

  const sentAt: number[] = [];

  for (const character of TYPED) {
    sentAt.push(performance.now());
    document.execCommand("insertText", false, character);
    await wait(KEY_INTERVAL_MS);
  }

  await wait(120);
  sampling = false;

  let maxCharsPerFrame = 0;
  let longestFrameMs = 0;
  const coalescedAtMs: number[] = [];
  const firstKeyAt = sentAt[0] ?? 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];

    if (previous === undefined || current === undefined) continue;
    const landed = current.length - previous.length;

    if (landed > 1) coalescedAtMs.push(Math.round(current.at - firstKeyAt));
    maxCharsPerFrame = Math.max(maxCharsPerFrame, landed);
    longestFrameMs = Math.max(longestFrameMs, current.at - previous.at);
  }

  const latencies = sentAt.map((at, index) => {
    const painted = samples.find((frame) => frame.at > at && frame.length > index);

    return painted === undefined ? Number.POSITIVE_INFINITY : painted.at - at;
  });

  const sorted = latencies.toSorted((left, right) => left - right);
  root.unmount();
  host.remove();

  return {
    streaming,
    typed: TYPED.length,
    rendered: samples.at(-1)?.length ?? 0,
    maxCharsPerFrame,
    maxLatencyMs: sorted.at(-1) ?? Number.POSITIVE_INFINITY,
    p95LatencyMs: sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY,
    frames: samples.length,
    longestFrameMs,
    coalescedAtMs,
  };
}

applyDisplayMode("light");
