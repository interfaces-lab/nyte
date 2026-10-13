/**
 * Builds the drawing kit `useApp().kit` hands to components. The kit owns
 * the SyntaxStyle pair: both styles are built with `renderer.nativeScene` as
 * their owner from the current theme, rebuilt when the theme changes, and
 * the previous pair is destroyed once the new one is in place (the last
 * pair on `dispose`), so a retheme never leaks native styles.
 */
import { SyntaxStyle } from "@opentui/core";
import type { CliRenderer, NativeResourceOwner, Renderable } from "@opentui/core";
import { createEffect, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import type { CliTheme } from "../lib/theme.ts";
import type { PartMessage } from "../lib/view-helpers.ts";
import type { FailureReport } from "../model/state.ts";
import { LabelSyntax } from "../services/label-syntax.ts";
import type { Kit } from "./context.tsx";
import type { Tickers } from "./ticker.ts";

export interface KitOptions {
  readonly renderer: CliRenderer;
  /** The active palette (`sinks.ts` resolves a pinned theme or the terminal's). */
  readonly theme: Accessor<CliTheme>;
  readonly tickers: Tickers;
  readonly blob: (id: string) => AsyncIterable<Uint8Array>;
  readonly drawPart: (message: PartMessage) => Renderable | null;
  readonly attach: Kit["attach"];
  readonly report: (origin: FailureReport["origin"], error: unknown) => void;
}

export interface SyntaxPair {
  /** Prose, code and diffs. */
  readonly normal: SyntaxStyle;
  /** Thoughts and dim previews. */
  readonly subtle: SyntaxStyle;
}

export interface OwnedKit extends Kit {
  /** Destroys the current SyntaxStyle pair; called once, when the renderer closes. */
  dispose(): void;
}

/** Call under a Solid owner: the retheme effect lives as long as it does. */
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
        // Readers switch when this update cycle flushes; nothing draws with the old pair after it.
        queueMicrotask(() => destroyPair(previous));
      },
      { defer: true },
    ),
  );

  const labels = new LabelSyntax();
  // One version for every label: a landed answer is a cache hit for the rest.
  const [labelled, setLabelled] = createSignal(0);

  return {
    theme: options.theme,
    syntax,
    ticker: (intervalMs) => options.tickers.ticker(intervalMs),
    now: () => options.tickers.now(),
    report: options.report,
    highlight(text, filetype) {
      labelled();

      return (
        labels.chunks(text, filetype, syntax().normal, () => setLabelled((count) => count + 1)) ??
        null
      );
    },
    blob: options.blob,
    drawPart: options.drawPart,
    attach: options.attach,
    dispose: () => destroyPair(current),
  };
}

function destroyPair(pair: SyntaxPair): void {
  pair.normal.destroy();
  pair.subtle.destroy();
}

/** The two styles for one palette, owned by `owner`: the syntax role table ported from transcript.ts `createSyntaxStyle`. */
export function syntaxPair(theme: CliTheme, owner: NativeResourceOwner): SyntaxPair {
  return { normal: syntaxStyle(theme, false, owner), subtle: syntaxStyle(theme, true, owner) };
}

function syntaxStyle(theme: CliTheme, subtle: boolean, owner: NativeResourceOwner): SyntaxStyle {
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
      // Base scopes the non-bundled grammars lean on; a dotted group falls back
      // to the name before its first dot.
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
