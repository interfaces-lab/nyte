import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { findLanguage } from "@nyte-ai/schema";
import type {
  CompletionItem,
  CompletionList,
  CompletionResolveToken,
  CompletionTrigger,
} from "@nyte-ai/schema";
import type { EditorChange } from "@nyte-ai/ui/diffs/edit";
import type { LanguageApi, TextPosition, WorkspaceId } from "@nyte-ai/sdk";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { languageFor } from "../data/language.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { languageStatusWatch } from "../data/watches.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { workspaceFile } from "../workbench/paths.ts";
import {
  completionInsert,
  continuesWord,
  rankCompletions,
  WORD_CHARACTER,
  wordStart,
} from "./completion.ts";
import type { RankedCompletion } from "./completion.ts";
import type { ItemEditor } from "./file-code-view.tsx";
import { fileActions } from "./file-store.ts";
import { languageDocuments } from "./language-documents.ts";
import { editorRange } from "./pierre-language.ts";

const QUICK_MS = 50;

const PAGE_ROWS = 10;

const PAIRS = new Set(["()", "[]", "{}", '""', "''", "``"]);

interface Asked {
  readonly line: number;
  readonly start: number;
  readonly requested: TextPosition;
  readonly explicit: boolean;
}

interface Session extends Asked {
  readonly list: CompletionList;
}

export interface CompletionPopup {
  readonly anchor: DOMRect;
  readonly ranked: readonly RankedCompletion[];
  readonly selected: number;
}

export function useCompletion(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly path: string;
  readonly workspace: { readonly id: WorkspaceId; readonly path: string } | undefined;
  readonly readOnly: boolean;
  readonly editor: () => ItemEditor | undefined;
}) {
  const [popup, setPopup] = useState<CompletionPopup>();
  const api = useRef<LanguageApi | undefined>(undefined);
  const session = useRef<Session | undefined>(undefined);
  const asked = useRef<Asked | undefined>(undefined);
  const ranked = useRef<TextPosition | undefined>(undefined);
  const ticket = useRef(0);
  const applying = useRef(false);
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queryClient = useQueryClient();
  const language = findLanguage(input.path)?.name;

  const relative =
    input.workspace === undefined
      ? undefined
      : workspaceFile(input.path, [input.workspace.path])?.relative;

  const triggers = useWatchSelect(
    input.workspace === undefined || language === undefined || relative === undefined
      ? undefined
      : languageStatusWatch(input.workspace.id),
    (state) => {
      const offering = (state.value ?? []).filter(
        (view) =>
          language !== undefined &&
          view.languages.includes(language) &&
          relative !== undefined &&
          (view.root === "" || relative.startsWith(`${view.root}/`)) &&
          (view.features.includes("completion") || view.state.kind === "idle"),
      );

      return offering.length === 0
        ? undefined
        : offering.flatMap((view) => view.completionTriggers).join("");
    },
  );

  useMountEffect(() => () => clearTimeout(pause.current));

  const resolving = (token: CompletionResolveToken | null) => ({
    queryKey: ["completion", "resolve", token],
    queryFn: async (): Promise<CompletionItem | null> =>
      token === null || api.current === undefined ? null : api.current.resolveCompletion({ token }),
    staleTime: Infinity,
  });

  const chosen = popup?.ranked[popup.selected]?.item;
  const token = chosen?.resolve ?? null;
  const details = useQuery({ ...resolving(token), enabled: token !== null });

  const caretNow = (): { readonly position: TextPosition; readonly line: string } | undefined => {
    const editor = input.editor();
    const selections = editor?.getViewState().selections;
    const only = selections?.length === 1 ? selections[0] : undefined;

    if (
      editor === undefined ||
      only === undefined ||
      only.start.line !== only.end.line ||
      only.start.character !== only.end.character
    ) {
      return undefined;
    }

    const line = editor.getLineText(only.end.line);

    return line === undefined
      ? undefined
      : { position: { line: only.end.line, utf16Column: only.end.character }, line };
  };

  const close = (): void => {
    applying.current = false;
    ticket.current += 1;
    clearTimeout(pause.current);
    pause.current = undefined;
    session.current = undefined;
    asked.current = undefined;
    ranked.current = undefined;
    setPopup(undefined);
  };

  const show = (current: Session): void => {
    const at = caretNow();

    const anchor = input.editor()?.getRangeRect({
      start: { line: current.line, character: current.start },
      end: { line: current.line, character: current.start },
    });

    if (
      at === undefined ||
      anchor === undefined ||
      at.position.line !== current.line ||
      !continuesWord(at.line, current.start, at.position.utf16Column)
    ) {
      close();

      return;
    }

    const rows = rankCompletions(current.list.items, at.line, at.position, current.start);

    if (rows.length === 0 && !current.explicit) {
      close();

      return;
    }

    asked.current = undefined;
    session.current = { ...current, explicit: false };
    ranked.current = at.position;
    setPopup({ anchor, ranked: rows, selected: 0 });
  };

  const connect = async (workspace: {
    readonly id: WorkspaceId;
    readonly path: string;
  }): Promise<LanguageApi> => {
    const found = api.current ?? (await languageFor(workspace.id));

    api.current = found;
    await languageDocuments.prepare(
      workspace.path,
      found,
      input.path,
      fileActions.documents(input.viewKey),
    );

    return found;
  };

  const begin = async (trigger: CompletionTrigger, explicit: boolean): Promise<void> => {
    const workspace = input.workspace;
    const at = caretNow();

    if (workspace === undefined || at === undefined || input.readOnly || triggers === undefined) {
      return;
    }

    clearTimeout(pause.current);
    pause.current = undefined;
    ticket.current += 1;
    const mine = ticket.current;

    const question: Asked = {
      line: at.position.line,
      start: wordStart(at.line, at.position.utf16Column),
      requested: at.position,
      explicit,
    };

    asked.current = question;

    const list = await connect(workspace)
      .then((found) => found.completion({ path: input.path, position: at.position, trigger }))
      .catch(() => undefined);

    if (ticket.current !== mine || list === undefined) return;
    show({ ...question, list });
  };

  const refilter = (): void => {
    const current = session.current;
    const at = caretNow();

    if (current === undefined) return;

    if (
      at !== undefined &&
      ranked.current?.line === at.position.line &&
      ranked.current.utf16Column === at.position.utf16Column
    ) {
      return;
    }

    show(current);
  };

  const accept = async (index: number): Promise<void> => {
    const current = session.current;
    const picked = popup?.ranked[index]?.item;
    const editor = input.editor();

    if (current === undefined || picked === undefined || editor === undefined) return;
    close();
    const mine = ticket.current;
    const version = editor.getEditState()?.document.version;

    const item =
      picked.resolve === null
        ? picked
        : ((await queryClient.fetchQuery(resolving(picked.resolve)).catch(() => null)) ?? picked);

    const document = editor.getEditState()?.document;
    const at = caretNow();

    if (
      ticket.current !== mine ||
      document === undefined ||
      document.version !== version ||
      at === undefined
    ) {
      return;
    }

    const insert = completionInsert(item, {
      line: at.line,
      caret: at.position,
      requested: current.requested,
      start: current.start,
    });

    const main = { range: editorRange(insert.range), newText: document.normalizeEol(insert.text) };
    const start = document.offsetAt(main.range.start);

    const extra = item.additionalEdits.map((edit) => ({
      range: editorRange(edit.range),
      newText: document.normalizeEol(edit.text),
    }));

    const before = extra.reduce((shift, edit) => {
      const end = document.offsetAt(edit.range.end);

      return end <= start
        ? shift + edit.newText.length - (end - document.offsetAt(edit.range.start))
        : shift;
    }, 0);

    const from =
      start + before + document.normalizeEol(insert.text.slice(0, insert.caret.start)).length;

    const to =
      from +
      document.normalizeEol(
        insert.text.slice(insert.caret.start, insert.caret.start + insert.caret.length),
      ).length;

    applying.current = true;
    editor.applyEdits([...extra, main]);
    const after = editor.getEditState()?.document ?? document;

    editor.setSelections([
      {
        start: after.positionAt(from),
        end: after.positionAt(to),
        direction: to > from ? "forward" : "none",
      },
    ]);
    applying.current = false;
  };

  const move = (event: KeyboardEvent<HTMLElement>, shown: CompletionPopup, to: number): void => {
    event.preventDefault();
    event.stopPropagation();
    setPopup({ ...shown, selected: to });
  };

  return {
    popup,
    detail: details.data ?? chosen,
    close,
    pick: (index: number): void => void accept(index),
    keyDown: (event: KeyboardEvent<HTMLElement>): void => {
      if (event.nativeEvent.isComposing) return;
      const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

      if (
        event.code === "Space" &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        void begin({ kind: "invoked" }, true);

        return;
      }

      if (popup === undefined || !plain) return;
      const count = popup.ranked.length;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();

        return;
      }

      if (count === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        move(event, popup, (popup.selected + (event.key === "ArrowDown" ? 1 : -1) + count) % count);

        return;
      }

      if (event.key === "PageDown" || event.key === "PageUp") {
        const step = event.key === "PageDown" ? PAGE_ROWS : -PAGE_ROWS;

        move(event, popup, Math.min(count - 1, Math.max(0, popup.selected + step)));

        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        void accept(popup.selected);
      }
    },
    edited: (changes: readonly EditorChange[]): void => {
      if (applying.current) return;
      const change = changes.length === 1 ? changes[0] : undefined;

      const typed =
        change === undefined
          ? undefined
          : change.text.length === 1
            ? change.text
            : PAIRS.has(change.text)
              ? change.text.charAt(0)
              : undefined;

      if (change !== undefined && change.text === "" && session.current !== undefined) {
        refilter();

        return;
      }

      if (typed === undefined) {
        close();

        return;
      }

      if (triggers?.includes(typed) === true) {
        close();
        void begin({ kind: "character", character: typed }, false);

        return;
      }

      if (!WORD_CHARACTER.test(typed)) {
        close();

        return;
      }

      if (session.current?.list.incomplete === true) {
        refilter();
        void begin({ kind: "incomplete" }, false);

        return;
      }

      if (session.current !== undefined) {
        refilter();

        return;
      }

      if (asked.current !== undefined && pause.current === undefined) return;
      const at = caretNow();
      const start = at === undefined ? 0 : wordStart(at.line, at.position.utf16Column);

      if (at === undefined || /\p{N}/u.test(at.line.charAt(start))) return;
      clearTimeout(pause.current);
      asked.current = { line: at.position.line, start, requested: at.position, explicit: false };
      pause.current = setTimeout(() => {
        pause.current = undefined;
        void begin({ kind: "invoked" }, false);
      }, QUICK_MS);
    },
    moved: (): void => {
      if (applying.current) return;

      if (session.current !== undefined) {
        refilter();

        return;
      }

      const pending = asked.current;
      const at = caretNow();

      if (
        pending !== undefined &&
        (at === undefined ||
          at.position.line !== pending.line ||
          !continuesWord(at.line, pending.start, at.position.utf16Column))
      ) {
        close();
      }
    },
    scrolled: (): void => {
      const current = session.current;

      if (current === undefined) return;

      const anchor = input.editor()?.getRangeRect({
        start: { line: current.line, character: current.start },
        end: { line: current.line, character: current.start },
      });

      if (anchor === undefined) close();
      else setPopup((shown) => (shown === undefined ? shown : { ...shown, anchor }));
    },
  };
}
