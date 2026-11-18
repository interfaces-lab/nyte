import { useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { LanguageApi, TextPosition, TextRange, WorkspaceId } from "@nyte-ai/sdk";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { languageFor } from "../../data/language.ts";
import type { WorkbenchViewKey } from "../model.ts";
import { workspaceFile } from "../paths.ts";
import { findDeclaration, identifierAt, navigable, NOWHERE } from "./declaration.ts";
import type { DeclarationQuery, Landing } from "./declaration.ts";
import type { DeclarationPopup } from "./declaration-popups.tsx";
import type { FileBuffer } from "./file-document.ts";
import { fileActions } from "./file-store.ts";
import { languageDocuments } from "./language-documents.ts";

const RESOLVING_MS = 300;

/** The modifier-hover link, as the IntelliJ platform's `CTRL_CLICKABLE` draws it: the accent ink, underlined. */
export const DECLARATION_LINK_CSS = `
[data-line] [data-declaration-link] {
  color: ${role.contentAccent};
  text-decoration-line: underline;
  text-decoration-thickness: from-font;
  text-underline-position: from-font;
  cursor: pointer;
}
`;

interface Hovered {
  readonly element: HTMLElement;
  readonly position: TextPosition;
}

/** A pointer over a word of the text, as the editor reports it: where the word starts, and the element drawing it. */
export interface PointedWord {
  readonly position: TextPosition;
  readonly element: HTMLElement;
}

/**
 * Go to Declaration, Go to Type Declaration and Quick Definition for one open file: the keys, the
 * modifier-click and the modifier-hover link, and what the editor shows while and after it resolves.
 */
export function useDeclarations(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly path: string;
  readonly buffer: FileBuffer;
  readonly workspace: { readonly id: WorkspaceId; readonly path: string } | undefined;
  readonly mac: boolean;
  readonly caret: () => TextPosition | undefined;
  readonly rangeRect: (range: TextRange) => DOMRect | undefined;
  readonly fallbackRect: () => DOMRect;
}) {
  const [popup, setPopup] = useState<DeclarationPopup>();
  const [api, setApi] = useState<LanguageApi>();
  const ticket = useRef(0);
  const hovered = useRef<Hovered | undefined>(undefined);
  const linked = useRef<HTMLElement | undefined>(undefined);
  const known = useRef(new Map<string, boolean>());
  const holding = useRef(false);

  const primary = (event: { readonly metaKey: boolean; readonly ctrlKey: boolean }): boolean =>
    input.mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  const connect = async (): Promise<LanguageApi | undefined> => {
    const workspace = input.workspace;

    if (workspace === undefined) return undefined;
    const found = api ?? (await languageFor(workspace.id));

    setApi(found);
    await languageDocuments.prepare(
      workspace.path,
      found,
      input.path,
      fileActions.documents(input.viewKey),
    );

    return found;
  };

  const land = (landing: Landing): void => {
    setPopup(undefined);
    fileActions.open(input.viewKey, {
      path: landing.path,
      target: {
        kind: "position",
        line: landing.range.start.line + 1,
        column: landing.range.start.utf16Column + 1,
      },
      readOnly: workspaceFile(landing.path, [input.viewKey]) === undefined,
    });
  };

  const run = async (
    position: TextPosition,
    query: DeclarationQuery,
    anchor: DOMRect | undefined,
  ): Promise<void> => {
    ticket.current += 1;
    const mine = ticket.current;
    const revision = input.buffer.getSnapshot().revision;
    const word = identifierAt(readLine(input.buffer.text(), position.line), position);
    const at = anchor ?? (word === undefined ? undefined : input.rangeRect(word.range));
    const place = at ?? input.fallbackRect();

    if (word === undefined) {
      setPopup({ kind: "hint", anchor: place, message: NOWHERE, busy: false });

      return;
    }

    const slow = setTimeout(() => {
      if (ticket.current === mine)
        setPopup({ kind: "hint", anchor: place, message: "Resolving reference…", busy: true });
    }, RESOLVING_MS);

    const outcome = await connect()
      .then((found) =>
        found === undefined || input.workspace === undefined
          ? { kind: "none" as const, message: "Open a folder to go to declarations." }
          : findDeclaration(found, {
              root: input.workspace.path,
              path: input.path,
              position,
              name: word.name,
              query,
            }),
      )
      .catch((cause: unknown) => ({
        kind: "none" as const,
        message: NOWHERE,
        detail: cause instanceof Error ? cause.message : undefined,
      }))
      .finally(() => clearTimeout(slow));

    if (ticket.current !== mine || input.buffer.getSnapshot().revision !== revision) return;

    if (outcome.kind === "none") {
      setPopup({
        kind: "hint",
        anchor: place,
        message: outcome.message,
        detail: outcome.detail,
        busy: false,
      });

      return;
    }

    if (query === "definition") {
      setPopup({
        kind: "peek",
        anchor: place,
        name: word.name,
        landings: outcome.kind === "go" ? [outcome.landing] : outcome.landings,
        index: 0,
      });

      return;
    }

    if (outcome.kind === "go") {
      land(outcome.landing);

      return;
    }

    setPopup({ kind: "choose", anchor: place, title: outcome.title, landings: outcome.landings });
  };

  const atCaret = (query: DeclarationQuery): void => {
    const caret = input.caret();

    if (caret !== undefined) void run(caret, query, undefined);
  };

  const unlink = (): void => {
    if (linked.current !== undefined) delete linked.current.dataset.declarationLink;
    linked.current = undefined;
  };

  const link = async (found: Hovered): Promise<void> => {
    const revision = input.buffer.getSnapshot().revision;
    const key = `${String(revision)}:${String(found.position.line)}:${String(found.position.utf16Column)}`;
    const cached = known.current.get(key);

    const answer =
      cached ??
      (await connect()
        .then((connected) =>
          connected === undefined ? false : navigable(connected, input.path, found.position),
        )
        .catch(() => false));

    if (cached === undefined) {
      if (known.current.size > 500) known.current.clear();
      known.current.set(key, answer);
    }

    if (!answer || hovered.current !== found || !holding.current) return;
    unlink();
    found.element.dataset.declarationLink = "";
    linked.current = found.element;
  };

  const modifierChanged = useEffectEvent((event: globalThis.KeyboardEvent | FocusEvent): void => {
    const held = "metaKey" in event && primary(event) && !event.altKey;

    if (held === holding.current) return;
    holding.current = held;

    if (!held) {
      unlink();

      return;
    }

    if (hovered.current !== undefined) void link(hovered.current);
  });

  useMountEffect(() => {
    const changed = (event: globalThis.KeyboardEvent | FocusEvent): void => modifierChanged(event);
    window.addEventListener("keydown", changed);
    window.addEventListener("keyup", changed);
    window.addEventListener("blur", changed);

    return () => {
      window.removeEventListener("keydown", changed);
      window.removeEventListener("keyup", changed);
      window.removeEventListener("blur", changed);
    };
  });

  return {
    popup,
    api,
    land,
    peekAt: (index: number): void => {
      if (popup?.kind === "peek") setPopup({ ...popup, index });
    },
    close: (): void => {
      ticket.current += 1;
      setPopup(undefined);
    },
    pointer: {
      enter(
        word: PointedWord,
        event: { readonly metaKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean },
      ): void {
        const found = { element: word.element, position: word.position };

        hovered.current = found;
        holding.current = primary(event) && !event.altKey;

        if (holding.current) void link(found);
      },
      leave(element: HTMLElement): void {
        if (hovered.current?.element === element) hovered.current = undefined;

        if (linked.current === element) unlink();
      },
      click(word: PointedWord, event: globalThis.MouseEvent): void {
        if (event.button !== 0 || !primary(event) || event.altKey) return;
        unlink();
        void run(
          word.position,
          event.shiftKey ? "type" : "declaration",
          word.element.getBoundingClientRect(),
        );
      },
    },
    onAuxClick: (event: MouseEvent<HTMLElement>): void => {
      const found = hovered.current;

      if (event.button !== 1 || found === undefined) return;
      event.preventDefault();
      void run(found.position, "declaration", found.element.getBoundingClientRect());
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>): boolean => {
      const query = declarationKey(event, input.mac);

      if (event.key === "Escape" && popup !== undefined) {
        ticket.current += 1;
        setPopup(undefined);
      }

      if (query === undefined) return false;
      event.preventDefault();
      event.stopPropagation();
      atCaret(query);

      return true;
    },
  };
}

function declarationKey(
  event: KeyboardEvent<HTMLElement>,
  mac: boolean,
): DeclarationQuery | undefined {
  if (event.nativeEvent.isComposing) return undefined;
  const key = event.code;
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  if (primary && !event.altKey && !event.shiftKey && key === "KeyB") return "declaration";

  if (
    !event.altKey &&
    event.shiftKey &&
    key === "KeyB" &&
    (primary || (mac && event.ctrlKey && !event.metaKey))
  )
    return "type";

  if (mac)
    return (event.altKey && !event.metaKey && !event.ctrlKey && key === "Space") ||
      (primary && !event.altKey && !event.shiftKey && key === "KeyY")
      ? "definition"
      : undefined;

  return primary && event.shiftKey && !event.altKey && key === "KeyI" ? "definition" : undefined;
}

function readLine(text: string, line: number): string {
  let start = 0;

  for (let at = 0; at < line; at += 1) {
    const next = text.indexOf("\n", start);

    if (next < 0) return "";
    start = next + 1;
  }

  const end = text.indexOf("\n", start);

  return text.slice(start, end < 0 ? text.length : end).replace(/\r$/u, "");
}
