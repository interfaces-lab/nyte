import type { KeyInput, Terminal } from "@nyte-ai/vt";
import { addsToChat } from "../../references/add-to-chat.ts";
import { nyte } from "../../contract/nyte.ts";

export interface InputHost {
  readonly terminal: Terminal;
  readonly element: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly shell: boolean;
  takesInput(): boolean;
  running(): boolean;
  send(bytes: Uint8Array): void;
  typed(): void;
  submitted(): void;
  focused(focused: boolean): void;
  copy(): void;
  addToChat(): boolean;
}

const encoder = new TextEncoder();

function keyInput(event: KeyboardEvent, action: KeyInput["action"], mac: boolean): KeyInput {
  const altGraph = event.getModifierState("AltGraph");

  return {
    action,
    code: event.code,
    key: event.key,
    shift: event.shiftKey,
    ctrl: event.ctrlKey && !altGraph,
    alt: event.altKey && !altGraph,
    meta: event.metaKey,
    composing: event.isComposing,
    optionAsAlt: !mac,
  };
}

function appChord(event: KeyboardEvent, mac: boolean): boolean {
  if (mac) return event.metaKey;

  return event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v";
}

export function attachInput(host: InputHost): () => void {
  const mac = nyte.platform === "darwin";
  const textarea = host.textarea;
  let composing = false;
  let committed = "";

  const emit = (bytes: Uint8Array): void => {
    host.typed();
    host.send(bytes);
  };

  const keydown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.keyCode === 229 || event.key === "Dead") return;

    if (event.ctrlKey && event.code === "Backquote") return;

    if (addsToChat(event, mac)) {
      if (host.addToChat()) event.preventDefault();

      return;
    }

    if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      host.copy();

      return;
    }

    if (!host.shell || !host.takesInput() || appChord(event, mac)) return;
    const bytes = host.terminal.key(keyInput(event, event.repeat ? "repeat" : "press", mac));

    if (bytes.length === 0) return;
    event.preventDefault();

    if (event.key === "Enter" && !event.shiftKey && !event.repeat) host.submitted();
    emit(bytes);
  };

  const keyup = (event: KeyboardEvent): void => {
    if (event.isComposing || !host.shell || !host.takesInput() || appChord(event, mac)) return;
    const bytes = host.terminal.key(keyInput(event, "release", mac));

    if (bytes.length > 0) host.send(bytes);
  };

  const commit = (): void => {
    const text = textarea.value;
    textarea.value = "";

    if (text === "" || !host.takesInput()) return;
    emit(encoder.encode(text));
  };

  const preedit = (text: string | null): void => {
    textarea.style.opacity = text === null ? "0" : "1";
    textarea.style.width =
      text === null ? "1px" : String(Math.max(1, Array.from(text).length) * 2 + 1) + "ch";
  };

  const compositionstart = (): void => {
    composing = true;
    preedit("");
  };

  const compositionupdate = (event: CompositionEvent): void => preedit(event.data);

  const compositionend = (): void => {
    composing = false;
    preedit(null);
    committed = textarea.value;
    commit();
    setTimeout(() => {
      committed = "";
    });
  };

  const beforeinput = (event: InputEvent): void => {
    if (composing || event.isComposing || !host.takesInput()) return;

    if (event.inputType === "deleteContentBackward" && textarea.value === "") {
      event.preventDefault();
      emit(Uint8Array.of(0x7f));

      return;
    }

    if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
      event.preventDefault();
      commit();
      host.submitted();
      emit(Uint8Array.of(0x0d));
    }
  };

  const input = (event: Event): void => {
    if (composing || (event instanceof InputEvent && event.isComposing)) return;

    if (committed !== "" && textarea.value === committed) {
      textarea.value = "";
      committed = "";

      return;
    }

    commit();
  };

  const copy = (event: ClipboardEvent): void => {
    const text = host.terminal.selectionText();

    if (text === "") return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", text);
  };

  const paste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData("text/plain");

    if (text === undefined) return;
    event.preventDefault();
    event.stopPropagation();

    if (host.running()) emit(host.terminal.paste(text));
  };

  const focus = (): void => host.focused(true);

  const blur = (): void => host.focused(false);

  textarea.addEventListener("keydown", keydown);
  textarea.addEventListener("keyup", keyup);
  textarea.addEventListener("focus", focus);
  textarea.addEventListener("blur", blur);
  host.element.addEventListener("copy", copy, true);
  host.element.addEventListener("paste", paste, true);

  if (host.shell) {
    textarea.addEventListener("compositionstart", compositionstart);
    textarea.addEventListener("compositionupdate", compositionupdate);
    textarea.addEventListener("compositionend", compositionend);
    textarea.addEventListener("beforeinput", beforeinput);
    textarea.addEventListener("input", input);
  }

  return () => {
    textarea.removeEventListener("keydown", keydown);
    textarea.removeEventListener("keyup", keyup);
    textarea.removeEventListener("focus", focus);
    textarea.removeEventListener("blur", blur);
    textarea.removeEventListener("compositionstart", compositionstart);
    textarea.removeEventListener("compositionupdate", compositionupdate);
    textarea.removeEventListener("compositionend", compositionend);
    textarea.removeEventListener("beforeinput", beforeinput);
    textarea.removeEventListener("input", input);
    host.element.removeEventListener("copy", copy, true);
    host.element.removeEventListener("paste", paste, true);
  };
}
