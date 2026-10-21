import { SyntaxStyle } from "@opentui/core";
import type { CliRenderer, NativeResourceOwner, Renderable } from "@opentui/core";
import { createEffect, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import type { CliTheme } from "../lib/theme.ts";
import { displayWidth } from "../lib/width.ts";
import type { FailureReport } from "../model/state.ts";
import { createDiagrams } from "../services/diagrams.ts";
import { LabelSyntax } from "../services/label-syntax.ts";
import type { Kit } from "./context.tsx";
import type { Tickers } from "./ticker.ts";

interface KitOptions {
  readonly renderer: CliRenderer;
  readonly theme: Accessor<CliTheme>;
  readonly tickers: Tickers;
  readonly blob: (id: string) => AsyncIterable<Uint8Array>;
  readonly drawPart: (message: PartMessage) => Renderable | null;
  readonly attach: Kit["attach"];
  readonly report: (origin: FailureReport["origin"], error: unknown) => void;
}

interface SyntaxPair {
  readonly normal: SyntaxStyle;
  readonly subtle: SyntaxStyle;
}

interface OwnedKit extends Kit {
  dispose(): void;
}

export function createKit(options: KitOptions): OwnedKit {
  const owner = options.renderer.nativeScene;
  let current = syntaxPair(options.theme(), owner);
  const [syntax, setSyntax] = createSignal(current);

  createEffect(
    on(
      options.theme,
      (theme) => {
        const previous = current;
        current = syntaxPair(theme, owner);
        setSyntax(current);
        queueMicrotask(() => destroyPair(previous));
      },
      { defer: true },
    ),
  );

  const labels = new LabelSyntax();
  const diagrams = createDiagrams();

  return {
    theme: options.theme,
    syntax,
    ticker: (intervalMs) => options.tickers.ticker(intervalMs),
    now: () => options.tickers.now(),
    report: options.report,
    highlight(text, filetype) {
      return labels.chunks(text, filetype, syntax().normal, waitForLabel) ?? null;
    },
    async diagram(source) {
      const text = await diagrams.draw(source);
      const lines = text.split("\n");

      return { text, height: lines.length, width: Math.max(1, ...lines.map(displayWidth)) };
    },
    blob: options.blob,
    drawPart: options.drawPart,
    attach: options.attach,
    dispose() {
      destroyPair(current);
      diagrams.dispose();
    },
  };
}

function waitForLabel(): () => void {
  const [landed, setLanded] = createSignal(false);
  landed();

  return () => setLanded(true);
}

function destroyPair(pair: SyntaxPair): void {
  pair.normal.destroy();
  pair.subtle.destroy();
}

function syntaxPair(theme: CliTheme, owner: NativeResourceOwner): SyntaxPair {
  return { normal: syntaxStyle(theme, false, owner), subtle: syntaxStyle(theme, true, owner) };
}

export function syntaxStyle(
  theme: CliTheme,
  subtle: boolean,
  owner: NativeResourceOwner,
): SyntaxStyle {
  const color = (value: string): string => (subtle ? theme.dim : value);

  return SyntaxStyle.fromStyles(
    {
      default: { fg: color(theme.foreground) },
      markup: { fg: color(theme.foreground) },
      keyword: { fg: color(theme.code) },
      string: { fg: color(theme.string) },
      number: { fg: color(theme.number) },
      comment: { fg: color(theme.dim), italic: true },
      function: { fg: color(theme.user) },
      type: { fg: color(theme.type) },
      variable: { fg: color(theme.foreground) },
      operator: { fg: color(theme.operator) },
      punctuation: { fg: color(theme.dim) },
      constant: { fg: color(theme.number) },
      boolean: { fg: color(theme.number) },
      character: { fg: color(theme.string) },
      constructor: { fg: color(theme.type) },
      module: { fg: color(theme.type) },
      property: { fg: color(theme.foreground) },
      attribute: { fg: color(theme.type) },
      label: { fg: color(theme.code) },
      tag: { fg: color(theme.code) },
      "markup.heading": { fg: color(theme.foreground), bold: true },
      "markup.strong": { fg: color(theme.foreground), bold: true },
      "markup.italic": { italic: true },
      "markup.strikethrough": { fg: color(theme.dim) },
      "markup.raw": { fg: color(theme.code) },
      "markup.link": { fg: color(theme.link), underline: true },
      "markup.list": { fg: color(theme.dim) },
      "markup.quote": { fg: color(theme.dim), italic: true },
      conceal: { fg: color(theme.dim) },
      "diff.plus": { bg: theme.diffAddedEmphasis },
      "diff.minus": { bg: theme.diffRemovedEmphasis },
    },
    owner,
  );
}
