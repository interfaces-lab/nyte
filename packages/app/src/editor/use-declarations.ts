import { useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { CodeAction, CodeActionKind, WorkspaceEdit } from "@nyte-ai/schema";
import type { LanguageApi, TextPosition, TextRange, WorkspaceId } from "@nyte-ai/sdk";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { errorMessage } from "../contract/errors.ts";
import { languageFor } from "../data/language.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { workspaceFile } from "../workbench/paths.ts";
import { findDeclaration, identifierAt, navigable, NOWHERE } from "./declaration.ts";
import type { DeclarationQuery, Landing } from "./declaration.ts";
import type { DeclarationPopup } from "./declaration-popups.tsx";
import type { FileBuffer } from "./file-document.ts";
import { fileActions } from "./file-store.ts";
import { languageDocuments } from "./language-documents.ts";
import { applyWorkspaceEdit } from "./workspace-edit.ts";

const RESOLVING_MS = 300;

const HOVER_MS = 500;

const HOVER_LEAVE_MS = 300;

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

export function useDeclarations(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly path: string;
  readonly buffer: FileBuffer;
  readonly workspace: { readonly id: WorkspaceId; readonly path: string } | undefined;
  readonly mac: boolean;
  readonly readOnly: boolean;
  readonly caret: () => TextPosition | undefined;
  readonly selection: () => TextRange | undefined;
  readonly rangeRect: (range: TextRange) => DOMRect | undefined;
  readonly fallbackRect: () => DOMRect;
  readonly diagnosed: (position: TextPosition) => boolean;
  readonly nearestProblem: (position: TextPosition) => TextRange | undefined;
  readonly focus: () => void;
}) {
  const [popup, setPopup] = useState<DeclarationPopup>();
  const [api, setApi] = useState<LanguageApi>();
  const ticket = useRef(0);
  const hovered = useRef<Hovered | undefined>(undefined);
  const linked = useRef<HTMLElement | undefined>(undefined);
  const known = useRef(new Map<string, boolean>());
  const holding = useRef(false);
  const dwell = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const primary = (event: { readonly metaKey: boolean; readonly ctrlKey: boolean }): boolean =>
    input.mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  const connectTo = async (workspace: {
    readonly id: WorkspaceId;
    readonly path: string;
  }): Promise<LanguageApi> => {
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

  const connect = async (): Promise<LanguageApi | undefined> =>
    input.workspace === undefined ? undefined : connectTo(input.workspace);

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

  const resolving = (anchor: DOMRect, message: string, mine: number) =>
    setTimeout(() => {
      if (ticket.current === mine) setPopup({ kind: "hint", anchor, message, busy: true });
    }, RESOLVING_MS);

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

    const slow = resolving(place, "Resolving reference…", mine);

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

  const startRename = async (): Promise<void> => {
    const caret = input.caret();

    if (caret === undefined) return;
    ticket.current += 1;
    const mine = ticket.current;
    const revision = input.buffer.getSnapshot().revision;
    const place = input.rangeRect({ start: caret, end: caret }) ?? input.fallbackRect();
    const slow = resolving(place, "Resolving symbol…", mine);

    const prepared = await connect()
      .then(async (found) => ({
        target: (await found?.prepareRename({ path: input.path, position: caret })) ?? null,
        detail: undefined,
      }))
      .catch((cause: unknown) => ({ target: null, detail: errorMessage(cause) }))
      .finally(() => clearTimeout(slow));

    if (ticket.current !== mine || input.buffer.getSnapshot().revision !== revision) return;

    if (prepared.target === null) {
      setPopup({
        kind: "hint",
        anchor: place,
        message: "This can't be renamed",
        detail: prepared.detail,
        busy: false,
      });

      return;
    }

    setPopup({
      kind: "rename",
      anchor: input.rangeRect(prepared.target.range) ?? place,
      position: caret,
      name: prepared.target.placeholder,
      revision,
      busy: false,
    });
  };

  const dismiss = (): void => {
    ticket.current += 1;
    setPopup(undefined);
    input.focus();
  };

  const applyEdit = async (
    target: { readonly anchor: DOMRect; readonly revision: number },
    failed: string,
    compute: (api: LanguageApi) => Promise<WorkspaceEdit>,
  ): Promise<void> => {
    const workspace = input.workspace;

    if (workspace === undefined) return;
    ticket.current += 1;
    const mine = ticket.current;

    const failure = await connectTo(workspace)
      .then(async (found) => {
        const edit = await compute(found);

        if (ticket.current !== mine) return undefined;

        if (input.buffer.getSnapshot().revision !== target.revision) {
          throw new Error("The file changed meanwhile, so nothing changed.");
        }
        await applyWorkspaceEdit({ view: input.viewKey, root: workspace.path, edit });

        return undefined;
      })
      .catch((cause: unknown) => errorMessage(cause));

    if (ticket.current !== mine) return;

    if (failure === undefined) {
      dismiss();

      return;
    }

    setPopup({
      kind: "hint",
      anchor: target.anchor,
      message: failed,
      detail: failure,
      busy: false,
    });
  };

  const rename = (
    target: Extract<DeclarationPopup, { readonly kind: "rename" }>,
    name: string,
  ): void => {
    if (input.workspace === undefined || name === "" || name === target.name) {
      dismiss();

      return;
    }

    setPopup({ ...target, busy: true });
    void applyEdit(target, `Can't rename ${target.name}`, async (found) => {
      const outcome = await found.rename({ path: input.path, position: target.position, name });

      if (outcome.kind === "refused") throw new Error(outcome.reason);

      return outcome.edit;
    });
  };

  const showActions = async (request: {
    readonly range: TextRange;
    readonly anchor: TextRange;
    readonly only: readonly CodeActionKind[];
  }): Promise<void> => {
    ticket.current += 1;
    const mine = ticket.current;
    const revision = input.buffer.getSnapshot().revision;
    const place = input.rangeRect(request.anchor) ?? input.fallbackRect();
    const slow = resolving(place, "Finding actions…", mine);

    const listed = await connect()
      .then(async (found) => ({
        actions: (
          (await found?.codeActions({
            path: input.path,
            range: request.range,
            only: request.only,
          })) ?? []
        ).filter(
          (action) =>
            action.disabled === null &&
            request.only.some((kind) => action.kind === kind || action.kind.startsWith(`${kind}.`)),
        ),
        detail: undefined,
      }))
      .catch((cause: unknown) => ({ actions: [], detail: errorMessage(cause) }))
      .finally(() => clearTimeout(slow));

    if (ticket.current !== mine || input.buffer.getSnapshot().revision !== revision) return;

    if (listed.actions.length === 0) {
      setPopup({
        kind: "hint",
        anchor: place,
        message: "No actions here",
        detail: listed.detail,
        busy: false,
      });

      return;
    }

    setPopup({
      kind: "actions",
      anchor: place,
      actions: listed.actions,
      revision,
      running: undefined,
    });
  };

  const runAction = (action: CodeAction): void => {
    if (popup?.kind !== "actions" || popup.running !== undefined) return;
    setPopup({ ...popup, running: action });
    void applyEdit(popup, `Can't apply ${action.title}`, async (found) => {
      const outcome = await found.resolveCodeAction({ token: action.token });

      if (outcome.kind === "stale") {
        throw new Error("The file changed, so this action no longer applies.");
      }

      if (outcome.kind === "refused") throw new Error(outcome.reason);

      return outcome.edit;
    });
  };

  const explainCaret = (): void => {
    const caret = input.caret();

    if (caret === undefined) return;
    ticket.current += 1;
    const mine = ticket.current;

    void explain({
      position: caret,
      revision: input.buffer.getSnapshot().revision,
      pinned: true,
      anchor: (range) => input.rangeRect(range) ?? input.fallbackRect(),
      current: () => ticket.current === mine,
    });
  };

  const atCaret = (query: DeclarationQuery): void => {
    const caret = input.caret();

    if (caret !== undefined) void run(caret, query, undefined);
  };

  const keepHover = (): void => clearTimeout(leaving.current);

  const releaseHover = (): void => {
    clearTimeout(leaving.current);
    leaving.current = setTimeout(
      () => setPopup((shown) => (shown?.kind === "hover" && !shown.pinned ? undefined : shown)),
      HOVER_LEAVE_MS,
    );
  };

  const dismissHover = (): void => {
    clearTimeout(dwell.current);
    setPopup((shown) => (shown?.kind === "hover" ? undefined : shown));
  };

  const explain = async (at: {
    readonly position: TextPosition;
    readonly revision: number;
    readonly pinned: boolean;
    readonly anchor: (range: TextRange) => DOMRect;
    readonly current: () => boolean;
  }): Promise<void> => {
    const word = identifierAt(readLine(input.buffer.text(), at.position.line), at.position);

    if (word === undefined || (!at.pinned && input.diagnosed(at.position))) return;

    const hover = await connect()
      .then((connected) => connected?.hover({ path: input.path, position: at.position }))
      .catch(() => undefined);

    if (
      hover === undefined ||
      hover === null ||
      hover.markdown.trim() === "" ||
      !at.current() ||
      input.buffer.getSnapshot().revision !== at.revision
    ) {
      return;
    }
    keepHover();
    setPopup((shown) =>
      shown === undefined || shown.kind === "hover"
        ? {
            kind: "hover",
            anchor: at.anchor(word.range),
            markdown: hover.markdown,
            position: at.position,
            pinned: at.pinned,
          }
        : shown,
    );
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
      clearTimeout(dwell.current);
      clearTimeout(leaving.current);
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
    hoverPopup: { enter: keepHover, leave: releaseHover },
    rename: {
      submit: (name: string): void => {
        if (popup?.kind === "rename") rename(popup, name);
      },
      cancel: dismiss,
    },
    action: { pick: runAction, close: dismiss },
    showFixes: (range: TextRange): void => {
      if (!input.readOnly) void showActions({ range, anchor: range, only: ["quickfix"] });
    },
    pointer: {
      enter(
        word: PointedWord,
        event: {
          readonly metaKey: boolean;
          readonly ctrlKey: boolean;
          readonly altKey: boolean;
          readonly shiftKey: boolean;
        },
      ): void {
        const found = { element: word.element, position: word.position };

        hovered.current = found;
        holding.current = primary(event) && !event.altKey;
        clearTimeout(dwell.current);

        if (holding.current) {
          void link(found);

          return;
        }

        if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;

        if (
          popup?.kind === "hover" &&
          popup.position.line === found.position.line &&
          popup.position.utf16Column === found.position.utf16Column
        ) {
          keepHover();

          return;
        }

        const revision = input.buffer.getSnapshot().revision;

        dwell.current = setTimeout(
          () =>
            void explain({
              position: found.position,
              revision,
              pinned: false,
              anchor: () => found.element.getBoundingClientRect(),
              current: () => hovered.current === found && !holding.current,
            }),
          HOVER_MS,
        );
      },
      leave(element: HTMLElement): void {
        if (hovered.current?.element === element) {
          hovered.current = undefined;
          clearTimeout(dwell.current);
          releaseHover();
        }

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
    dismissHover,
    onKeyDown: (event: KeyboardEvent<HTMLElement>): boolean => {
      const query = declarationKey(event, input.mac);

      if (event.key === "F1" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        explainCaret();

        return true;
      }

      if (!["Shift", "Control", "Alt", "Meta", "Escape"].includes(event.key)) dismissHover();

      if (event.key === "Escape" && popup !== undefined) {
        ticket.current += 1;
        setPopup(undefined);
      }

      if (renameKey(event) && !input.readOnly) {
        event.preventDefault();
        event.stopPropagation();
        void startRename();

        return true;
      }

      if (actionsKey(event, input.mac)) {
        event.preventDefault();
        event.stopPropagation();
        const caret = input.caret();
        const selection = input.selection();

        if (input.readOnly || caret === undefined || selection === undefined) return true;

        const nearby =
          selection.start.line === selection.end.line &&
          selection.start.utf16Column === selection.end.utf16Column &&
          !input.diagnosed(caret)
            ? input.nearestProblem(caret)
            : undefined;

        void showActions({
          range: nearby ?? selection,
          anchor: { start: caret, end: caret },
          only: ["quickfix", "refactor"],
        });

        return true;
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
  ) {
    return "type";
  }

  if (mac) {
    return (event.altKey && !event.metaKey && !event.ctrlKey && key === "Space") ||
      (primary && !event.altKey && !event.shiftKey && key === "KeyY")
      ? "definition"
      : undefined;
  }

  return primary && event.shiftKey && !event.altKey && key === "KeyI" ? "definition" : undefined;
}

function actionsKey(event: KeyboardEvent<HTMLElement>, mac: boolean): boolean {
  if (event.nativeEvent.isComposing) return false;

  const altEnter =
    event.key === "Enter" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const quickFix = primary && !event.altKey && !event.shiftKey && event.code === "Period";

  return altEnter || quickFix;
}

function renameKey(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false;

  return event.shiftKey ? event.key === "F6" : event.key === "F2";
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
