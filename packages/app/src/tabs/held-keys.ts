export interface HeldKeys {
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly digit: string | undefined;
}

export type KeyStroke = Pick<KeyboardEvent, "type" | "metaKey" | "ctrlKey" | "code">;

export const RELEASED: HeldKeys = { meta: false, ctrl: false, digit: undefined };

export function nextHeld(previous: HeldKeys, stroke: KeyStroke | undefined): HeldKeys {
  if (stroke === undefined) return RELEASED;

  const next = {
    meta: stroke.metaKey,
    ctrl: stroke.ctrlKey,
    digit: stroke.type === "keydown" ? /^Digit([1-9])$/.exec(stroke.code)?.[1] : undefined,
  };

  return next.meta === previous.meta && next.ctrl === previous.ctrl && next.digit === previous.digit
    ? previous
    : next;
}
