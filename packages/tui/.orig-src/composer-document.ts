/**
 * One native read of the composer per bounded operation.
 *
 * The edit buffer stays authoritative and offers no synchronous content
 * revision: every mutation is synchronous, but its notification arrives a
 * microtask later, after every other key in the same terminal batch has been
 * dispatched. So this never caches across keys. A scope opens when a key
 * enters the keymap and closes before the focused editor handles it; a hint
 * pass or content notification opens its own. Inside a scope the first read
 * hits the native buffer and later reads reuse it; outside one every read is
 * native. Code that mutates the composer inside a scope calls `invalidate`
 * first, so the next read after its own edit is fresh again.
 */
import type { TextareaRenderable } from "@opentui/core";

type DraftKind = "empty" | "blank" | "message";

interface DraftSnapshot {
  readonly text: string;
  readonly kind: DraftKind;
}

function classify(text: string): DraftSnapshot {
  return { text, kind: text === "" ? "empty" : text.trim() === "" ? "blank" : "message" };
}

export class ComposerDocument {
  private readonly input: Pick<TextareaRenderable, "plainText">;
  private snapshot: DraftSnapshot | undefined;
  private scoped = false;
  /** The most recent read, for labels while another surface owns the keyboard. */
  latest: DraftSnapshot | undefined;

  constructor(input: Pick<TextareaRenderable, "plainText">) {
    this.input = input;
  }

  /** The draft as it is now, read once per scope. */
  read(): DraftSnapshot {
    if (this.scoped && this.snapshot !== undefined) return this.snapshot;
    const snapshot = classify(this.input.plainText);
    this.latest = snapshot;

    if (this.scoped) this.snapshot = snapshot;

    return snapshot;
  }

  /** A key entered the keymap; nothing edits the composer until dispatch ends. */
  open(): void {
    this.snapshot = undefined;
    this.scoped = true;
  }

  /** Dispatch ended; the focused editor may edit the composer now. */
  close(): void {
    this.snapshot = undefined;
    this.scoped = false;
  }

  /** The caller is about to edit or has edited the composer inside a scope. */
  invalidate(): void {
    this.snapshot = undefined;
  }

  /** Run one read-only pass, such as hint generation, against a single read. */
  during<T>(work: () => T): T {
    const outer = this.scoped;
    this.snapshot = undefined;
    this.scoped = true;

    try {
      return work();
    } finally {
      this.snapshot = undefined;
      this.scoped = outer;
    }
  }
}
