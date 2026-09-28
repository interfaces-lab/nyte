/**
 * What every transcript surface draws with: the shared context, the repaint
 * registry a retheme walks, and text renderables that remember their width rules.
 */
import { CodeRenderable, TextRenderable } from "@opentui/core";
import type {
  BoxRenderable,
  CliRenderer,
  Renderable,
  ScrollBoxRenderable,
  SyntaxStyle,
  TextBufferRenderable,
} from "@opentui/core";
import type { LabelSyntax } from "./label-syntax.ts";
import type { Task } from "./tasks.ts";
import type { CliTheme } from "./theme.ts";

// Native text buffers retain their construction-time width rules after capability replies.
export const bufferWidths = new WeakMap<TextBufferRenderable, CliRenderer["widthMethod"]>();

export class TranscriptTextRenderable extends TextRenderable {
  constructor(renderer: CliRenderer, options: ConstructorParameters<typeof TextRenderable>[1]) {
    super(renderer, options);
    bufferWidths.set(this, renderer.widthMethod);
  }
}

export class TranscriptCodeRenderable extends CodeRenderable {
  constructor(renderer: CliRenderer, options: ConstructorParameters<typeof CodeRenderable>[1]) {
    super(renderer, options);
    bufferWidths.set(this, renderer.widthMethod);
  }
}

export const repaints = new WeakMap<Renderable, () => void>();

export function repaintTree(root: Renderable): void {
  repaints.get(root)?.();

  for (const child of root.getChildren()) repaintTree(child);
}

export interface ExpandableToolOutput {
  setExpanded(expanded: boolean): void;
}

/**
 * One expansion state for the transcript and every tool card in it.
 *
 * Based on pi's global tool-output toggle:
 * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts
 */
export class ToolOutputExpansion {
  private readonly cards = new Set<ExpandableToolOutput>();
  private current = false;

  get expanded(): boolean {
    return this.current;
  }

  register(card: ExpandableToolOutput): () => void {
    this.cards.add(card);
    card.setExpanded(this.current);

    return () => this.cards.delete(card);
  }

  toggle(): boolean {
    this.current = !this.current;

    for (const card of this.cards) card.setExpanded(this.current);

    return this.current;
  }
}

/** Disclosure changes invalidate measurements at every previously visited width. */
export class TranscriptDisclosures extends Map<string, boolean> {
  revision = 0;

  override set(key: string, value: boolean): this {
    if (this.get(key) === value) return this;
    super.set(key, value);
    this.revision += 1;

    return this;
  }
}

/** What every block draws with. */
export interface Transcript {
  readonly renderer: CliRenderer;
  readonly container: ScrollBoxRenderable;
  syntaxStyle: SyntaxStyle;
  subtleSyntaxStyle: SyntaxStyle;
  readonly theme: CliTheme;
  /** Highlights for one-line labels, such as the command on a shell call. */
  readonly labelSyntax: LabelSyntax;
  readonly toolOutput: ToolOutputExpansion;
  readonly nextId: (prefix?: string) => string;
  readonly openPath: (path: string) => void;
  /**
   * The tasks of the session shown, for delegation cards. The task browser
   * follows them and installs this once it exists; until then there are none.
   */
  tasks: () => readonly Task[];
  readonly disclosures?: TranscriptDisclosures;
  /** Width for user cards, which sit inside the scroll padding. */
  readonly userBlocks: Set<BoxRenderable>;
  readonly userBlockWidth: () => number;
  /** Told whether output growth owns the viewport, for the latest control. */
  readonly onFollowModeChange: (followingLatest: boolean) => void;
  /** Told whether the transcript has anything to show, for the welcome. */
  readonly onEmptyChange: (empty: boolean) => void;
}
