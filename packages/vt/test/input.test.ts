import { describe, expect, test } from "vitest";

import { decode, key, openTerminal } from "./harness.ts";

describe("keys", () => {
  test("encodes legacy keys", async () => {
    const session = await openTerminal();
    const terminal = session.terminal;

    expect(decode(terminal.key(key("Enter", "Enter")))).toBe("\r");
    expect(decode(terminal.key(key("KeyC", "c", { ctrl: true })))).toBe("\u0003");
    expect(decode(terminal.key(key("KeyA", "a")))).toBe("a");
    expect(decode(terminal.key(key("KeyA", "A", { shift: true })))).toBe("A");
    expect(decode(terminal.key(key("ArrowUp", "ArrowUp")))).toBe("\u001b[A");
    expect(terminal.key(key("KeyA", "a", { action: "release" }))).toHaveLength(0);
  });

  test("follows cursor key mode and the Kitty keyboard protocol", async () => {
    const session = await openTerminal();
    const terminal = session.terminal;

    session.write("\u001b[?1h");
    expect(decode(terminal.key(key("ArrowUp", "ArrowUp")))).toBe("\u001bOA");
    session.write("\u001b[>1u");
    expect(decode(terminal.key(key("Enter", "Enter", { shift: true })))).toBe("\u001b[13;2u");
    expect(decode(terminal.key(key("KeyA", "A", { shift: true })))).toBe("A");
    expect(terminal.key(key("KeyA", "a", { action: "release" }))).toHaveLength(0);
    session.write("\u001b[=3u");
    expect(decode(terminal.key(key("KeyA", "a", { action: "release" })))).toBe("\u001b[97;1:3u");
  });

  test("prefixes the typed character with Escape when Alt is Meta", async () => {
    const session = await openTerminal();
    const terminal = session.terminal;
    const meta = { alt: true, optionAsAlt: true };

    expect(decode(terminal.key(key("KeyB", "b", meta)))).toBe("\u001bb");
    expect(decode(terminal.key(key("Comma", "<", { ...meta, shift: true })))).toBe("\u001b<");
    expect(decode(terminal.key(key("KeyQ", "a", meta)))).toBe("\u001ba");
    expect(decode(terminal.key(key("KeyA", "å", { alt: true })))).toBe("å");
  });
});

describe("paste", () => {
  test("pastes every line and keeps escapes from ending a bracketed paste", async () => {
    const session = await openTerminal();
    const terminal = session.terminal;

    expect(decode(terminal.paste("echo one\necho two\n"))).toBe("echo one\recho two\r");
    session.write("\u001b[?2004h");
    expect(decode(terminal.paste("one\ntwo"))).toBe("\u001b[200~one\ntwo\u001b[201~");
    expect(decode(terminal.paste("ls\u001b[201~id\r"))).toBe("\u001b[200~ls [201~id\r\u001b[201~");
  });
});

describe("mouse and focus", () => {
  test("reports nothing until the program enables tracking", async () => {
    const session = await openTerminal();
    const terminal = session.terminal;

    const press = {
      action: "press",
      button: "left",
      x: 8 * 3 + 2,
      y: 16 * 2 + 2,
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    } as const;

    expect(terminal.mouseTracking()).toBe(false);
    expect(terminal.mouse(press)).toHaveLength(0);
    session.write("\u001b[?1000h\u001b[?1006h");
    expect(terminal.mouseTracking()).toBe(true);
    expect(decode(terminal.mouse(press))).toBe("\u001b[<0;4;3M");
    expect(decode(terminal.mouse({ ...press, action: "release" }))).toBe("\u001b[<0;4;3m");
  });

  test("reports focus only after mode 1004", async () => {
    const session = await openTerminal();

    expect(session.terminal.focus(true)).toHaveLength(0);
    session.write("\u001b[?1004h");
    expect(decode(session.terminal.focus(true))).toBe("\u001b[I");
    expect(decode(session.terminal.focus(false))).toBe("\u001b[O");
  });
});
