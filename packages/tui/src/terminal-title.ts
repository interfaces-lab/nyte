/**
 * Puts the chat's name in the terminal's title bar, so a window in a stack of
 * windows says which chat it is. The name is a session fact, so this follows
 * the log rather than any one writer: `/name`, `/title`, automatic naming,
 * and a rename made by another process all arrive the same way.
 *
 * A name reaches this through a model and through the composer, so it is
 * untrusted text on the way to an OSC sequence: the escape that ends the
 * sequence has to be stripped here, at the write, not wherever a name was
 * written.
 */
import { truncateDisplay } from "./width.ts";
import type { SessionStorage } from "@uji-ai/core/store";

/** What the title says before a chat has a name. */
export const TERMINAL_TITLE_BASE = "uji";

/** Long titles are dropped or scrolled by the terminal; cut before it does. */
export const TERMINAL_TITLE_MAX_CHARS = 72;

/** C0 and C1, which is where the OSC terminator and the bell live. */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/** The session slice this reads: the name, and the log it changes on. */
export type NamedSession = Pick<SessionStorage, "getLog" | "getName" | "watch">;

export interface TerminalTitleOptions {
  setTitle: (title: string) => void;
  onError?: (error: Error) => void;
}

/** `uji` until the chat has a name, then `uji - <name>`. */
export function terminalTitle(name: string | undefined): string {
  const clean = (name ?? "").replaceAll(CONTROL_CHARACTERS, " ").replaceAll(/\s+/gu, " ").trim();
  if (clean === "") return TERMINAL_TITLE_BASE;
  const room = TERMINAL_TITLE_MAX_CHARS - TERMINAL_TITLE_BASE.length - " - ".length;
  return `${TERMINAL_TITLE_BASE} - ${truncateDisplay(clean, room, "…")}`;
}

/** Publishes the current name, then every rename, until the returned stop is called. */
export function watchTerminalTitle(
  session: NamedSession,
  options: TerminalTitleOptions,
): () => void {
  const controller = new AbortController();
  void (async () => {
    try {
      const replay = await session.getLog();
      const cursor = replay.at(-1)?.seq ?? -1;
      options.setTitle(terminalTitle(await session.getName()));
      for await (const item of session.watch({ afterSeq: cursor, signal: controller.signal })) {
        if (item.kind !== "fact" || item.fact !== "name") continue;
        options.setTitle(terminalTitle(item.name));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  })();

  return () => controller.abort();
}
