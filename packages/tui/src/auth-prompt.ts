import type { AuthPrompt } from "@nyte-ai/ai";
import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
} from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { commandBindings } from "@opentui/keymap/extras";
import { CHAT_KEYBINDS, keycap } from "./constants.ts";
import { PickerCancelled } from "./picker.ts";
import { closePanel, openPanel, setHints } from "./app/ui.ts";
import type { Shell } from "./app/ui.ts";

/** OpenTUI has no edit mask. Its editor only receives bullets, including in undo and selection. */
class SecretInput extends InputRenderable {
  private secret: string[] = [];

  readSecret(): string {
    return this.secret.join("");
  }

  override insertText(text: string): void {
    const inserted = Array.from(text.replace(/[\r\n]/g, ""));

    if (inserted.length === 0) return;
    const selection = this.getSelection();
    const start = selection === null ? this.cursorOffset : Math.min(selection.start, selection.end);
    this.secret = [
      ...this.secret.slice(0, start),
      ...inserted,
      ...this.secret.slice(start + this.getSelectedText().length),
    ];
    this.clearSelection();
    this.setText("•".repeat(this.secret.length));
    this.cursorOffset = start + inserted.length;
  }

  override handleKeyPress(key: KeyEvent): boolean {
    const handled = super.handleKeyPress(key);

    if (this.isDestroyed) return handled;
    // Native movement and deletion operate on one bullet per code point. Never retain undo.
    const removed = this.secret.length - this.plainText.length;

    if (removed > 0) {
      const nextCursor = this.cursorOffset;
      // The native caret lands at the removed range's start, including line deletion
      // commands that deliberately ignore an existing selection.
      this.secret.splice(nextCursor, removed);
      this.clearSelection();
      this.setText("•".repeat(this.secret.length));
      this.cursorOffset = nextCursor;
    }

    return handled;
  }

  override destroy(): void {
    this.secret.fill("");
    this.secret.length = 0;

    if (!this.isDestroyed) this.setText("");
    super.destroy();
  }
}

/** Reads auth input without borrowing the composer's draft, history, or submission handlers. */
export function readAuthPrompt(
  shell: Shell,
  prompt: Exclude<AuthPrompt, { type: "select" }>,
  signal: AbortSignal,
): Promise<string> {
  const abort = prompt.signal === undefined ? signal : AbortSignal.any([signal, prompt.signal]);

  if (abort.aborted || shell.renderer.isDestroyed) return Promise.reject(new PickerCancelled());
  shell.dismissInfoPanel?.();

  if (shell.ui.selecting || shell.ui.prompting) {
    return Promise.reject(new Error("Another prompt or panel is already open"));
  }

  const previousFocus = shell.renderer.currentFocusedRenderable;
  const previousFocusable = shell.input.focusable;
  const previousHints = shell.ui.hints;

  const container = new BoxRenderable(shell.renderer, {
    id: shell.nextId("auth-prompt"),
    flexDirection: "column",
    paddingLeft: 3,
    paddingRight: 2,
    paddingTop: 1,
  });

  container.add(
    new TextRenderable(shell.renderer, {
      content: prompt.message,
      fg: shell.theme.accent,
      height: 1,
      wrapMode: "none",
      truncate: true,
    }),
  );
  const Input = prompt.type === "secret" ? SecretInput : InputRenderable;

  const input = new Input(shell.renderer, {
    id: shell.nextId("auth-input"),
    width: "100%",
    maxLength: Number.MAX_SAFE_INTEGER,
    placeholder: prompt.placeholder ?? "",
    placeholderColor: shell.theme.dim,
    backgroundColor: shell.theme.transparent,
    focusedBackgroundColor: shell.theme.transparent,
    textColor: shell.theme.foreground,
    focusedTextColor: shell.theme.foreground,
    cursorColor: shell.theme.accent,
    selectionBg: shell.theme.selectionBackground,
    selectionFg: shell.theme.selectionForeground,
    selectionOccupancy: "boundary",
  });

  container.add(input);

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const panel = {
      container,
      rows: 3,
      hints: `${keycap("auth.submit")} continue · ${keycap("auth.cancel")} cancel · ${keycap("chat.quit")} cancel`,
      focus: () => input.focus(),
      blur: () => input.blur(),
      destroy: () => {
        if (!input.isDestroyed) input.setText("");
        container.destroyRecursively();
      },
    };

    const finish = (value?: string): void => {
      if (settled) return;
      settled = true;
      abort.removeEventListener("abort", onAbort);
      unregister();
      input.off(InputRenderableEvents.ENTER, onSubmit);

      if (shell.root.isDestroyed) {
        panel.destroy();
        shell.setUi("selecting", false);
      } else {
        closePanel(shell, panel);
        shell.input.focusable = previousFocusable;

        if (previousFocus !== null && !previousFocus.isDestroyed) shell.focus.use(previousFocus);
        else shell.input.blur();
        setHints(shell, previousHints);
      }

      shell.setUi("prompting", false);

      if (value === undefined) reject(new PickerCancelled());
      else resolve(value);
    };

    const onAbort = (): void => finish();

    const onSubmit = (): void =>
      finish(input instanceof SecretInput ? input.readSecret() : input.value);

    const unregister = shell.keymap.registerLayer({
      commands: [{ name: "auth.cancel", run: onAbort }],
      bindings: commandBindings({ "auth.cancel": CHAT_KEYBINDS["auth.cancel"] }),
    });

    shell.setUi("prompting", true);
    openPanel(shell, panel);
    input.on(InputRenderableEvents.ENTER, onSubmit);
    abort.addEventListener("abort", onAbort, { once: true });

    if (abort.aborted) onAbort();
  });
}
