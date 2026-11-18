import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Popover } from "@nyte-ai/ui/popover";
import { PreviewCard, PreviewCardContent } from "@nyte-ai/ui/preview-card";
import { skipToken, useQuery } from "@tanstack/react-query";
// oxlint-disable-next-line no-restricted-imports -- the compiler skips memoizing the file index because later closures capture it, so it would rebuild on every keystroke
import { useDeferredValue, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import type { MentionFile } from "../../data/files.ts";
import type { CommandCompletion } from "@nyte-ai/sdk";
import type { SessionCatalogView } from "@nyte-ai/sdk";
import { Icon } from "@nyte-ai/ui/icon";
import { FileTypeIcon } from "@nyte-ai/ui/file-type-icon";
import type { ComposerCompletion, ComposerDocumentState } from "./composer-document.ts";
import type { ComposerComboboxState, ComposerEditorHandle } from "./composer-editor.tsx";
import { createMentionSuggestionRanking } from "./composer-suggestion-ranking.ts";
import {
  argumentToken,
  CLOSED_MENU,
  descriptionExcerpt,
  findQuery,
  liveToken,
  menuKey,
  nextMenu,
  pickFor,
  suggestionAttribution,
  suggestionEmptyText,
  suggestionGroup,
  suggestionPreviewTitle,
  suggestionReference,
  suggestionsFor,
} from "./composer-suggestion-menu.ts";
import type {
  ArgumentSuggestion,
  ComposerSource,
  ComposerSuggestion,
  MenuEvent,
  MenuState,
  SuggestionToken,
} from "./composer-suggestion-menu.ts";
import { mentionPreviewRows } from "../../references/mention-preview.ts";
import { sameReference } from "../../references/message-references.ts";
import type { MessageReference } from "../../references/message-references.ts";
import { composerStyles } from "./composer.stylex.ts";

const NONE: readonly never[] = [];

interface ArgumentAnswer {
  readonly command: string;
  readonly query: string;
  readonly suggestions: readonly ArgumentSuggestion[];
}

export type ComposerSuggestionCatalog = ComposerSource<
  Pick<SessionCatalogView, "commands" | "skills">
>;

export type ComposerMentionFiles = ComposerSource<readonly MentionFile[]>;

export function composerSource<T>(data: T | undefined, failed: boolean): ComposerSource<T> {
  if (data !== undefined) return { status: "ready", data };

  return failed ? { status: "error" } : { status: "loading" };
}

function revealSuggestion(list: HTMLElement | null, option: HTMLElement): void {
  if (list === null) return;
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;

  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

function HighlightedSuggestionText({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}): ReactElement {
  const match = findQuery(text, query);

  if (match === undefined) return <>{text}</>;

  return (
    <>
      {text.slice(0, match.start)}
      <span {...props(intent.primary, composerStyles.suggestionMatch)}>
        {text.slice(match.start, match.end)}
      </span>
      {text.slice(match.end)}
    </>
  );
}

function MentionPathPreview({ file }: { readonly file: MentionFile }): ReactElement {
  const rows = mentionPreviewRows(file);

  return (
    <div {...props(composerStyles.suggestionPreviewPath)}>
      {rows.map((row, depth) => (
        <div
          key={`${String(depth)}:${row.label}`}
          {...props(
            text.sm,
            composerStyles.suggestionPreviewPathRow,
            composerStyles.suggestionPreviewPathIndent(depth),
            depth === rows.length - 1 && composerStyles.suggestionPreviewPathLeaf,
          )}
        >
          {row.kind === "file" ? (
            <FileTypeIcon path={row.label} />
          ) : (
            <span aria-hidden="true" {...props(composerStyles.suggestionPreviewPathIcon)}>
              <Icon name="folder" size="xs" />
            </span>
          )}
          <span {...props(composerStyles.suggestionPreviewPathLabel)}>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function SuggestionPreview({
  suggestion,
}: {
  readonly suggestion: ComposerSuggestion;
}): ReactElement {
  const attribution = suggestionAttribution(suggestion);

  return (
    <>
      <div {...props(text.base, composerStyles.suggestionPreviewTitle)}>
        {suggestionPreviewTitle(suggestion)}
      </div>
      {attribution !== undefined && (
        <div {...props(text.sm, composerStyles.suggestionPreviewAttribution)}>
          <span aria-hidden="true" {...props(composerStyles.suggestionPreviewIcon)}>
            <Icon name={suggestion.icon} size="xs" />
          </span>
          {attribution}
        </div>
      )}
      {suggestion.kind === "file" ? (
        <MentionPathPreview file={suggestion.file} />
      ) : (
        suggestion.kind !== "mention" && (
          <div {...props(text.base, composerStyles.suggestionPreviewDescription)}>
            {suggestion.description}
          </div>
        )
      )}
    </>
  );
}

interface ComposerSuggestionsOptions {
  readonly editorRef: RefObject<ComposerEditorHandle | null>;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly side: "top" | "bottom";
  readonly suggestionCatalog: ComposerSuggestionCatalog;
  readonly mentionFiles: ComposerMentionFiles;
  readonly hasConversationContext: boolean;
  readonly references: readonly MessageReference[];
  readonly onCommand?: () => void;
  readonly completeCommand?: (
    name: string,
    prefix: string,
  ) => Promise<readonly CommandCompletion[]>;
}

interface ComposerSuggestions {
  readonly open: boolean;
  readonly combobox: ComposerComboboxState;
  readonly files: readonly MentionFile[];
  readonly onCompletionChange: (
    completion: ComposerCompletion | undefined,
    document: ComposerDocumentState,
  ) => void;
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
  readonly insertTrigger: (trigger: "@" | "/") => void;
  readonly menu: ReactElement;
}

export function useComposerSuggestions({
  editorRef,
  anchorRef,
  side,
  suggestionCatalog,
  mentionFiles,
  hasConversationContext,
  references,
  onCommand,
  completeCommand,
}: ComposerSuggestionsOptions): ComposerSuggestions {
  const listRef = useRef<HTMLDivElement>(null);
  const [activeOption, setActiveOption] = useState<HTMLDivElement | null>(null);
  const [menuState, setMenuState] = useState<MenuState>(CLOSED_MENU);
  const menu = menuState.token;
  const highlighted = menuState.highlighted;
  const popupId = useId();
  const deferredQuery = useDeferredValue(menu?.query ?? "");

  const commands =
    suggestionCatalog.status === "ready" && onCommand !== undefined
      ? suggestionCatalog.data.commands
      : NONE;

  const skills = suggestionCatalog.status === "ready" ? suggestionCatalog.data.skills : NONE;
  const files = mentionFiles.status === "ready" ? mentionFiles.data : NONE;
  const rankMentions = useMemo(() => createMentionSuggestionRanking(files), [files]);
  const kind = menu?.kind;
  const argument = menu?.kind === "argument" ? menu : undefined;

  const completions = useQuery({
    queryKey: ["command-completion", popupId, argument?.command, argument?.query],
    queryFn:
      argument === undefined || completeCommand === undefined
        ? skipToken
        : async (): Promise<ArgumentAnswer> => {
            const answer = await completeCommand(argument.command, argument.query).catch(
              (): readonly CommandCompletion[] => [],
            );

            return {
              command: argument.command,
              query: argument.query,
              suggestions: answer.map((completion) => ({
                kind: "argument",
                id: `argument:${completion.value}`,
                label: completion.label,
                description: completion.description ?? "",
                icon: "command",
                value: completion.value,
              })),
            };
          },
  });

  const answer = completions.data;

  const answered = (token: SuggestionToken): readonly ComposerSuggestion[] =>
    token.kind === "argument" && answer?.command === token.command && answer.query === token.query
      ? answer.suggestions
      : NONE;

  const argumentSuggestions = menu === undefined ? NONE : answered(menu);

  const listed = useMemo(
    () =>
      kind === undefined || kind === "argument"
        ? NONE
        : suggestionsFor(
            kind,
            deferredQuery,
            commands,
            skills,
            rankMentions,
            hasConversationContext,
          ),
    [kind, deferredQuery, commands, skills, rankMentions, hasConversationContext],
  );

  const suggestions = kind === "argument" ? argumentSuggestions : listed;

  const typedInFull = listed.some(
    (suggestion) =>
      suggestion.kind === "plugin-command" &&
      !suggestion.command.takesText &&
      suggestion.label.toLocaleLowerCase() === deferredQuery.trim().toLocaleLowerCase(),
  );

  const open =
    menu !== undefined && !typedInFull && (menu.kind !== "argument" || suggestions.length > 0);

  const activeIndex = Math.min(menuState.index, Math.max(0, suggestions.length - 1));
  const activeSuggestion = menu === undefined ? undefined : suggestions[activeIndex];

  // oxlint-disable-next-line nyte-code/no-direct-effect -- scrolls the active suggestion into view before paint
  useLayoutEffect(() => {
    if (activeOption !== null) revealSuggestion(listRef.current, activeOption);
  }, [activeOption]);

  const dispatch = (event: MenuEvent): void => setMenuState((current) => nextMenu(current, event));
  const show = (token: SuggestionToken | undefined): void => dispatch({ kind: "token", token });

  const addReference = (reference: MessageReference, start: number, end: number): void => {
    if (
      reference.kind !== "file" &&
      references.some((candidate) => sameReference(candidate, reference))
    ) {
      editorRef.current?.replaceText(start, end, "");

      return;
    }

    editorRef.current?.insertReference(reference, start, end);
  };

  const select = (suggestion: ComposerSuggestion, token: SuggestionToken, text: string): void => {
    if (suggestion.kind === "argument") {
      editorRef.current?.replaceText(token.start, token.end, suggestion.value);
    } else if (suggestion.kind === "plugin-command") {
      const runs =
        !suggestion.command.takesText &&
        onCommand !== undefined &&
        references.length === 0 &&
        `${text.slice(0, token.start)}${text.slice(token.end)}`.trim() === "";

      editorRef.current?.replaceText(token.start, token.end, `/${suggestion.command.name} `);

      if (runs) queueMicrotask(onCommand);
    } else {
      addReference(suggestionReference(suggestion), token.start, token.end);
    }

    show(undefined);
  };

  const rankLive = (token: SuggestionToken): readonly ComposerSuggestion[] =>
    token.kind === "argument"
      ? answered(token)
      : suggestionsFor(
          token.kind,
          token.query,
          commands,
          skills,
          rankMentions,
          hasConversationContext,
        );

  const click = (suggestion: ComposerSuggestion): void => {
    const document = editorRef.current?.readDocument();

    const token =
      menu === undefined || document === undefined
        ? undefined
        : liveToken(document, menu, commands);

    if (token === undefined || document === undefined) return;

    if (
      token.query !== deferredQuery &&
      !rankLive(token).some((candidate) => candidate.id === suggestion.id)
    )
      return;
    select(suggestion, token, document.text);
  };

  const insertTrigger = (trigger: "@" | "/"): void => {
    const editor = editorRef.current;

    if (editor === null) return;
    const current = editor.readDocument();
    const start = current.selectionStart;
    const leadingSpace = start > 0 && !/\s/.test(current.text[start - 1] ?? "") ? " " : "";
    editor.replaceText(start, current.selectionEnd, `${leadingSpace}${trigger}`);
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (menu === undefined || !open) return false;
    const key = menuKey(event, activeIndex, suggestions.length);

    if (key.kind === "pass") return false;

    if (key.kind === "close") {
      event.preventDefault();
      show(undefined);

      return true;
    }

    if (key.kind === "move") {
      event.preventDefault();
      dispatch({ kind: "move", to: key.to, count: suggestions.length });

      return true;
    }

    const document = editorRef.current?.readDocument();
    const token = document === undefined ? undefined : liveToken(document, menu, commands);

    if (token === undefined || document === undefined) {
      event.preventDefault();
      show(undefined);

      return true;
    }

    const active = pickFor(token, deferredQuery, suggestions, () => rankLive(token), activeIndex);

    if (active === undefined) {
      show(undefined);

      return false;
    }

    event.preventDefault();
    select(active, token, document.text);

    return true;
  };

  const menuElement = (
    <>
      <Popover.Root
        open={open}
        modal={false}
        onOpenChange={(open, details) => {
          if (open) return;
          const target = details.event.target;

          if (
            (details.reason === "outside-press" || details.reason === "focus-out") &&
            target instanceof Node &&
            anchorRef.current?.contains(target) === true
          ) {
            details.cancel();

            return;
          }

          show(undefined);
        }}
      >
        <Popover.Portal>
          <Popover.Positioner
            anchor={anchorRef}
            side={side}
            align="start"
            sideOffset={8}
            collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          >
            <Popover.Popup
              id={popupId}
              role="listbox"
              initialFocus={false}

              aria-busy={
                menu?.kind === "mention"
                  ? mentionFiles.status === "loading"
                  : suggestionCatalog.status === "loading"
              }
              aria-label={
                menu?.kind === "mention"
                  ? "Mention files and context"
                  : menu?.kind === "argument"
                    ? `/${menu.command} suggestions`
                    : onCommand === undefined
                      ? "Skills"
                      : "Commands and skills"
              }
              onMouseDown={(event) => event.preventDefault()}
              xstyle={composerStyles.suggestionMenu}
            >
              <div ref={listRef} {...props(composerStyles.suggestionList)}>
                {suggestions.length === 0 ? (
                  <div role="status" {...props(text.base, composerStyles.suggestionEmpty)}>
                    {menu === undefined || menu.kind === "argument"
                      ? undefined
                      : suggestionEmptyText(
                          menu.kind,
                          menu.kind === "mention" ? mentionFiles : suggestionCatalog,
                          onCommand === undefined ? "skills" : "commands and skills",
                        )}
                  </div>
                ) : (
                  suggestions.map((suggestion, optionIndex) => {
                    const previous = suggestions[optionIndex - 1];

                    const startsGroup =
                      previous !== undefined &&
                      suggestionGroup(previous) !== suggestionGroup(suggestion);

                    const optionId = `${popupId}-${String(optionIndex)}`;
                    const selected = activeIndex === optionIndex;
                    const description = descriptionExcerpt(suggestion.description, deferredQuery);

                    return (
                      <div
                        key={suggestion.id}
                        id={optionId}
                        ref={selected ? setActiveOption : undefined}
                        role="option"
                        tabIndex={-1}
                        aria-selected={selected}
                        {...props(
                          text.base,
                          composerStyles.suggestionItem,
                          selected && highlighted && composerStyles.suggestionItemHighlighted,
                          startsGroup && composerStyles.suggestionGroupStart,
                        )}
                        onPointerMove={() =>
                          dispatch({ kind: "point", index: optionIndex, count: suggestions.length })
                        }
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => click(suggestion)}
                      >
                        <span aria-hidden="true" {...props(composerStyles.suggestionIcon)}>
                          <Icon name={suggestion.icon} size="xs" />
                        </span>
                        <span {...props(composerStyles.suggestionText)}>
                          <span {...props(composerStyles.suggestionLabel)}>
                            <HighlightedSuggestionText
                              text={suggestion.label}
                              query={deferredQuery}
                            />
                          </span>
                          <span {...props(text.base, composerStyles.suggestionDescription)}>
                            <HighlightedSuggestionText text={description} query={deferredQuery} />
                          </span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <PreviewCard
        open={
          highlighted &&
          activeSuggestion !== undefined &&
          activeSuggestion.kind !== "argument" &&
          activeOption !== null
        }
      >
        {activeSuggestion === undefined ||
        activeSuggestion.kind === "argument" ||
        activeOption === null ? null : (
          <PreviewCardContent
            anchor={activeOption}
            side="right"
            align="end"
            sideOffset={6}
            collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}
            aria-label={`Details for ${activeSuggestion.label}`}
            xstyle={composerStyles.suggestionPreview}
          >
            <SuggestionPreview suggestion={activeSuggestion} />
          </PreviewCardContent>
        )}
      </PreviewCard>
    </>
  );

  return {
    open,
    combobox: {
      expanded: open,
      popupId: open ? popupId : undefined,
      activeOption:
        !open || suggestions.length === 0 ? undefined : `${popupId}-${String(activeIndex)}`,
    },
    files,
    onCompletionChange: (completion, document) =>
      show(
        completion === undefined
          ? argumentToken(document, commands)
          : {
              kind: completion.kind === "@" ? "mention" : "slash",
              start: completion.start,
              end: completion.end,
              query: completion.query,
            },
      ),
    onKeyDown,
    insertTrigger,
    menu: menuElement,
  };
}
