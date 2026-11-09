import { pixelPosition } from "./context.ts";
import {
  ClipboardLocation,
  ColorScheme,
  FocusEvent,
  KeyAction,
  Mode,
  MouseAction,
  MouseButton,
  MouseEncoderOption,
  PasteSource,
  Result,
  TerminalData,
} from "./constants.ts";
import { modifierBits, readKey } from "./keys.ts";
import { check } from "./memory.ts";

import type { Context, Geometry } from "./context.ts";
import type {
  ColorScheme as Scheme,
  KeyInput,
  MouseButton as Button,
  MouseInput,
} from "./index.ts";

interface Input {
  readonly key: (input: KeyInput) => Uint8Array;
  readonly mouseTracking: () => boolean;
  readonly mouse: (input: MouseInput) => Uint8Array;
  readonly focus: (focused: boolean) => Uint8Array;
  readonly colorSchemeReport: (scheme: Scheme) => Uint8Array;
  readonly paste: (text: string) => Uint8Array;
  readonly readMime: (writer: number) => number;
  readonly modesChanged: () => void;
  readonly dispose: () => void;
}

const keyActions = {
  press: KeyAction.PRESS,
  repeat: KeyAction.REPEAT,
  release: KeyAction.RELEASE,
} as const;

const mouseActions = {
  press: MouseAction.PRESS,
  release: MouseAction.RELEASE,
  motion: MouseAction.MOTION,
} as const;

const mouseButtons = {
  left: MouseButton.LEFT,
  middle: MouseButton.MIDDLE,
  right: MouseButton.RIGHT,
  "wheel-up": MouseButton.FOUR,
  "wheel-down": MouseButton.FIVE,
  "wheel-left": MouseButton.SIX,
  "wheel-right": MouseButton.SEVEN,
} as const;

const heldButtons: ReadonlySet<Button> = new Set(["left", "middle", "right"]);

const empty = new Uint8Array(0);

export function createInput(
  context: Context,
  keys: ReadonlyMap<string, number>,
  capture: (run: () => number) => { readonly result: number; readonly output: Uint8Array },
  readMimeCallback: number,
): Input {
  const native = context.native;
  const layout = context.layout;
  const memory = context.memory;
  const terminal = context.terminal;

  const keyEncoder = memory.handle(
    (slot) => native.ghostty_key_encoder_new(0, slot),
    "key encoder",
  );

  const keyEvent = memory.handle((slot) => native.ghostty_key_event_new(0, slot), "key event");

  const mouseEncoder = memory.handle(
    (slot) => native.ghostty_mouse_encoder_new(0, slot),
    "mouse encoder",
  );

  const mouseEvent = memory.handle(
    (slot) => native.ghostty_mouse_event_new(0, slot),
    "mouse event",
  );

  const option = memory.allocate(8);
  const written = memory.allocate(8);
  const mouseSize = memory.allocate(layout.mouseSize.size);
  const mousePosition = memory.allocate(layout.mousePosition.size);
  const paste = memory.allocate(layout.paste.size);
  const mime = memory.allocate(layout.string.size);
  const utf8 = memory.allocate(layout.string.size);
  const mimeText = new TextEncoder().encode("text/plain");
  const mimeBytes = memory.allocate(mimeText.length);
  const output = memory.growable(128);
  const keyText = memory.growable(32);
  const pasteText = memory.growable(256);
  const pressed = new Set<Button>();
  const encoder = new TextEncoder();
  let pending = { pointer: 0, length: 0 };
  let modesStale = true;
  let encodedGeometry: Geometry | null = null;

  memory.bytes().set(mimeText, mimeBytes);
  memory.view().setUint32(mime + layout.string.pointer, mimeBytes, true);
  memory.view().setUint32(mime + layout.string.length, mimeText.length, true);

  const setMouse = (mouseOption: number, pointer: number) =>
    check(
      native.ghostty_mouse_encoder_set(mouseEncoder, mouseOption, pointer),
      "mouse encoder option",
    );

  memory.view().setUint8(option, 1);
  setMouse(MouseEncoderOption.TRACK_LAST_CELL, option);

  const encode = (
    run: (buffer: number, capacity: number, written: number) => number,
    what: string,
  ) => {
    const first = run(output.pointer(), output.capacity(), written);

    if (first === Result.OUT_OF_SPACE) output.reserve(memory.view().getUint32(written, true));
    check(
      first === Result.OUT_OF_SPACE ? run(output.pointer(), output.capacity(), written) : first,
      what,
    );

    return memory.copy(output.pointer(), memory.view().getUint32(written, true));
  };

  const writeMouseState = (geometry: Geometry, input: MouseInput) => {
    const size = layout.mouseSize;
    const position = pixelPosition(geometry, input.x, input.y);
    const view = memory.view();

    memory.sized(mouseSize, size);
    view.setUint32(mouseSize + size.screenWidth, geometry.cols * geometry.pixels.width, true);
    view.setUint32(mouseSize + size.screenHeight, geometry.rows * geometry.pixels.height, true);
    view.setUint32(mouseSize + size.cellWidth, geometry.pixels.width, true);
    view.setUint32(mouseSize + size.cellHeight, geometry.pixels.height, true);
    view.setUint8(option, pressed.size > 0 ? 1 : 0);
    view.setFloat32(mousePosition + layout.mousePosition.x, position.x, true);
    view.setFloat32(mousePosition + layout.mousePosition.y, position.y, true);
  };

  const mouseTracking = () => context.flag(TerminalData.MOUSE_TRACKING);

  return {
    key: (input) => {
      const key = readKey(input);
      const text = encoder.encode(key.text);
      const pointer = keyText.reserve(text.length + 1);

      memory.bytes().set(text, pointer);
      memory.view().setUint32(utf8 + layout.string.pointer, text.length === 0 ? 0 : pointer, true);
      memory.view().setUint32(utf8 + layout.string.length, text.length, true);
      check(native.ghostty_key_encoder_set_from_terminal(keyEncoder, terminal), "key modes");
      check(native.ghostty_key_event_set_action(keyEvent, keyActions[input.action]), "key action");
      check(native.ghostty_key_event_set_key(keyEvent, keys.get(input.code) ?? 0), "key");
      check(native.ghostty_key_event_set_mods(keyEvent, key.mods), "key mods");
      check(native.ghostty_key_event_set_consumed_mods(keyEvent, key.consumed), "consumed mods");
      check(native.ghostty_key_event_set_composing(keyEvent, input.composing ? 1 : 0), "composing");
      check(native.ghostty_key_event_set_utf8(keyEvent, utf8), "key text");
      check(
        native.ghostty_key_event_set_unshifted_codepoint(keyEvent, key.unshifted),
        "unshifted codepoint",
      );

      return encode(
        (buffer, capacity, length) =>
          native.ghostty_key_encoder_encode(keyEncoder, keyEvent, buffer, capacity, length),
        "key encode",
      );
    },
    mouseTracking,
    mouse: (input) => {
      const button = input.button;

      if (button !== null && input.action === "press" && heldButtons.has(button)) {
        pressed.add(button);
      }

      if (button !== null && input.action === "release") pressed.delete(button);
      const geometry = context.geometry();

      writeMouseState(geometry, input);

      if (modesStale) {
        check(
          native.ghostty_mouse_encoder_set_from_terminal(mouseEncoder, terminal),
          "mouse modes",
        );
        modesStale = false;
      }

      if (geometry !== encodedGeometry) {
        setMouse(MouseEncoderOption.SIZE, mouseSize);
        encodedGeometry = geometry;
      }

      setMouse(MouseEncoderOption.ANY_BUTTON_PRESSED, option);
      check(
        native.ghostty_mouse_event_set_action(mouseEvent, mouseActions[input.action]),
        "action",
      );
      check(native.ghostty_mouse_event_set_mods(mouseEvent, modifierBits(input)), "mouse mods");
      check(native.ghostty_mouse_event_set_position(mouseEvent, mousePosition), "mouse position");
      check(
        button === null
          ? native.ghostty_mouse_event_clear_button(mouseEvent)
          : native.ghostty_mouse_event_set_button(mouseEvent, mouseButtons[button]),
        "mouse button",
      );

      return encode(
        (buffer, capacity, length) =>
          native.ghostty_mouse_encoder_encode(mouseEncoder, mouseEvent, buffer, capacity, length),
        "mouse encode",
      );
    },
    focus: (focused) => {
      if (!context.mode(Mode.FOCUS_EVENT)) return empty;
      const event = focused ? FocusEvent.GAINED : FocusEvent.LOST;

      return encode(
        (buffer, capacity, length) => native.ghostty_focus_encode(event, buffer, capacity, length),
        "focus encode",
      );
    },
    colorSchemeReport: (scheme) => {
      if (!context.mode(Mode.COLOR_SCHEME_REPORT)) return empty;
      const value = scheme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT;

      return encode(
        (buffer, capacity, length) =>
          native.ghostty_color_scheme_report_encode(value, buffer, capacity, length),
        "color scheme report",
      );
    },
    paste: (text) => {
      const bytes = encoder.encode(text);
      const pointer = pasteText.reserve(bytes.length + 1);
      const view = memory.view();

      memory.bytes().set(bytes, pointer);
      pending = { pointer, length: bytes.length };
      memory.sized(paste, layout.paste);
      view.setInt32(paste + layout.paste.location, ClipboardLocation.STANDARD, true);
      view.setInt32(paste + layout.paste.source, PasteSource.CLIPBOARD, true);
      view.setUint32(paste + layout.paste.mimes, mime, true);
      view.setUint32(paste + layout.paste.mimeCount, 1, true);
      view.setUint32(paste + layout.paste.read, readMimeCallback, true);
      view.setUint32(paste + layout.paste.readUserdata, 0, true);
      view.setUint8(paste + layout.paste.allowUnsafe, 1);
      const captured = capture(() => native.ghostty_terminal_paste(terminal, paste, 0));

      pending = { pointer: 0, length: 0 };
      check(captured.result, "paste");

      return captured.output;
    },
    readMime: (writer) => {
      if (pending.length === 0) return 1;
      const view = memory.view();

      const write: unknown = native.__indirect_function_table.get(
        view.getUint32(writer + layout.writer.write, true),
      );

      if (!(write instanceof Function)) return 0;

      return write(
        view.getUint32(writer + layout.writer.userdata, true),
        pending.pointer,
        pending.length,
      )
        ? 1
        : 0;
    },
    modesChanged: () => {
      modesStale = true;
    },
    dispose: () => {
      native.ghostty_key_event_free(keyEvent);
      native.ghostty_key_encoder_free(keyEncoder);
      native.ghostty_mouse_event_free(mouseEvent);
      native.ghostty_mouse_encoder_free(mouseEncoder);
    },
  };
}
