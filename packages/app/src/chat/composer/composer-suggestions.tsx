import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { Popover } from "@nyte-ai/ui/popover";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { PreviewCard, PreviewCardContent } from "@nyte-ai/ui/preview-card";
import {
  useDeferredValue,
  useId,
  useLayoutEffect,
  // oxlint-disable-next-line no-restricted-imports -- the compiler skips memoizing the file index because later closures capture it, so it would rebuild on every keystroke
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, RefObject } from "react";
import type { MentionFile } from "../../data/files.ts";
import type { CommandCompletion, SessionCatalogView } from "@nyte-ai/sdk";
import { Icon } from "@nyte-ai/ui/icon";
import { FileTypeIcon } from "@nyte-ai/ui/file-type-icon";
import type { ComposerCompletion, ComposerDocumentState } from "./composer-document.ts";
import type { ComposerComboboxState, ComposerEditorHandle } from "./composer-editor.tsx";
import {
  rememberSuggestion,
  useRecentSuggestions,
  useSuggestionFrecency,
} from "./composer-recent.ts";
import {
  createMentionSuggestionRanking,
  knownMentionFiles,
} from "./composer-suggestion-ranking.ts";
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
  SuggestionSources,
  SuggestionToken,
} from "./composer-suggestion-menu.ts";
import { useChatFolder } from "../../chats/index.ts";
import { activeEditorFile } from "../../workbench/model.ts";
import { useWorkbenchViewKey } from "../../workbench/paths.ts";
import { workbench } from "../../workbench/store.ts";
import { mentionPreviewRows } from "../../references/mention-preview.ts";
import { sameReference } from "../../references/message-references.ts";
import type { MessageReference } from "../../references/message-references.ts";
import { composerStyles } from "./composer.stylex.ts";

const NONE: readonly never[] = [];

const ARGUMENT_DELAY_MS = 120;

type ArgumentResult =
  | { readonly status: "ready"; readonly suggestions: readonly ArgumentSuggestion[] }
  | { readonly status: "error"; readonly message: string };

interface ArgumentAnswer {
  readonly command: string;
  readonly query: string;
  readonly result: ArgumentResult;
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
            text.base,
            composerStyles.suggestionPreviewPathRow,
            depth === rows.length - 1 && composerStyles.suggestionPreviewPathLeaf,
          )}
        >
          {Array.from({ length: depth }, (_, level) => (
            <span key={level} aria-hidden="true" {...props(composerStyles.suggestionPreviewGuide)}>
              <span {...props(composerStyles.suggestionPreviewGuideLine, hairline.inlineStart)} />
            </span>
          ))}
          <span aria-hidden="true" {...props(composerStyles.suggestionPreviewPathIcon)}>
            {row.kind === "file" ? (
              <FileTypeIcon path={row.label} />
            ) : (
              <Icon name="folder" size="xs" />
            )}
          </span>
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
  if (suggestion.kind === "file") return <MentionPathPreview file={suggestion.file} />;
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
      {suggestion.kind !== "mention" && (
        <div {...props(text.base, composerStyles.suggestionPreviewDescription)}>
          {suggestion.description}
        </div>
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

interface LiveToken {
  readonly token: SuggestionToken;
  readonly text: string;
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
  const [argumentAnswer, setArgumentAnswer] = useState<ArgumentAnswer>();
  const generation = useRef(0);
  const requested = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const menu = menuState.token;
  const highlighted = menuState.highlighted;
  const popupId = useId();
  const deferredQuery = useDeferredValue(menu?.query ?? "");
  const root = useChatFolder()?.path;
  const viewKey = useWorkbenchViewKey(root);

  const workbenchView = useSyncExternalStore(
    workbench.subscribe,
    () => (menu?.kind === "mention" ? workbench.getView(viewKey) : undefined),
    () => undefined,
  );

  const commands =
    suggestionCatalog.status === "ready" && onCommand !== undefined
      ? suggestionCatalog.data.commands
      : NONE;

  const skills = suggestionCatalog.status === "ready" ? suggestionCatalog.data.skills : NONE;
  const files = mentionFiles.status === "ready" ? mentionFiles.data : NONE;
  const scanning = mentionFiles.status === "loading";
  const recent = useRecentSuggestions();
  const frecency = useSuggestionFrecency();

  const recency = useMemo(
    () => ({
      accepted: recent,
      opened:
        workbenchView === undefined
          ? NONE
          : [
              ...new Set(
                [activeEditorFile(workbenchView), ...workbenchView.tabs].flatMap((tab) =>
                  tab?.kind === "file" ? [tab.path] : [],
                ),
              ),
            ],
    }),
    [recent, workbenchView],
  );

  const known = useMemo(
    () => (scanning && root !== undefined ? knownMentionFiles(root, recency) : files),
    [scanning, root, recency, files],
  );

  const rankMentions = useMemo(() => createMentionSuggestionRanking(known), [known]);

  const sources = useMemo(
    (): SuggestionSources => ({
      commands,
      skills,
      mentions: rankMentions,
      hasConversationContext,
      recency,
      frecency,
    }),
    [commands, skills, rankMentions, hasConversationContext, recency, frecency],
  );

  const kind = menu?.kind;
  const argument = menu?.kind === "argument" ? menu : undefined;

  const answerFor = (token: SuggestionToken): ArgumentAnswer | undefined =>
    token.kind === "argument" &&
    argumentAnswer?.command === token.command &&
    argumentAnswer.query === token.query
      ? argumentAnswer
      : undefined;

  const argumentResult = argument === undefined ? undefined : answerFor(argument)?.result;

  const heldArguments =
    argument !== undefined &&
    argumentAnswer?.command === argument.command &&
    argumentAnswer.result.status === "ready"
      ? argumentAnswer.result.suggestions
      : NONE;

  const listed = useMemo(
    () =>
      kind === undefined || kind === "argument"
        ? NONE
        : suggestionsFor(kind, deferredQuery, sources),
    [kind, deferredQuery, sources],
  );

  const suggestions = kind === "argument" ? heldArguments : listed;

  const typedInFull = listed.some(
    (suggestion) =>
      suggestion.kind === "plugin-command" &&
      !suggestion.command.takesText &&
      suggestion.label.toLocaleLowerCase() === deferredQuery.trim().toLocaleLowerCase(),
  );

  const open =
    menu !== undefined &&
    !typedInFull &&
    (menu.kind !== "argument" || completeCommand !== undefined);

  const activeSuggestion =
    suggestions.find((suggestion) => suggestion.id === menuState.active) ?? suggestions[0];

  const activeIndex = activeSuggestion === undefined ? -1 : suggestions.indexOf(activeSuggestion);

  if (
    menuState.active !== undefined &&
    !suggestions.some((suggestion) => suggestion.id === menuState.active)
  ) {
    setMenuState((current) =>
      nextMenu(current, { kind: "rows", ids: suggestions.map((suggestion) => suggestion.id) }),
    );
  }

  // oxlint-disable-next-line nyte-code/no-direct-effect -- scrolls the active suggestion into view before paint
  useLayoutEffect(() => {
    if (activeOption !== null) revealSuggestion(listRef.current, activeOption);
  }, [activeOption]);

  const dispatch = (event: MenuEvent): void => setMenuState((current) => nextMenu(current, event));

  const requestArguments = (token: SuggestionToken | undefined): void => {
    const request = token?.kind === "argument" ? token : undefined;
    const key = request === undefined ? undefined : `${request.command}\n${request.query}`;

    if (key === requested.current) return;
    requested.current = key;
    generation.current += 1;
    clearTimeout(timer.current);

    if (request === undefined || completeCommand === undefined) return;
    const ticket = generation.current;

    const settle = (result: ArgumentResult): void => {
      if (ticket === generation.current) {
        setArgumentAnswer({ command: request.command, query: request.query, result });
      }
    };

    timer.current = setTimeout(() => {
      void completeCommand(request.command, request.query).then(
        (answer) =>
          settle({
            status: "ready",
            suggestions: answer.map((completion) => ({
              kind: "argument",
              id: `argument:${completion.value}`,
              label: completion.label,
              description: completion.description ?? "",
              icon: "command",
              value: completion.value,
            })),
          }),
        (error: unknown) =>
          settle({
            status: "error",
            message: error instanceof Error ? error.message : "Couldn’t load suggestions",
          }),
      );
    }, ARGUMENT_DELAY_MS);
  };

  useMountEffect(() => () => {
    generation.current += 1;
    clearTimeout(timer.current);
  });

  const show = (token: SuggestionToken | undefined): void => {
    dispatch({ kind: "token", token });
    requestArguments(nextMenu(menuState, { kind: "token", token }).token);
  };

  const readToken = (): LiveToken | undefined => {
    const document = editorRef.current?.readDocument();

    const token =
      menu === undefined || document === undefined
        ? undefined
        : liveToken(document, menu, commands);

    return token === undefined || document === undefined
      ? undefined
      : { token, text: document.text };
  };

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

    if (suggestion.kind !== "argument") rememberSuggestion(suggestion.id);
    show(undefined);
  };

  const rankLive = (token: SuggestionToken): readonly ComposerSuggestion[] => {
    if (token.kind !== "argument") return suggestionsFor(token.kind, token.query, sources);
    const result = answerFor(token)?.result;

    return result?.status === "ready" ? result.suggestions : NONE;
  };

  const showsLive = (token: SuggestionToken): boolean =>
    token.kind === "argument" ? answerFor(token) !== undefined : token.query === deferredQuery;

  const offered = (suggestion: ComposerSuggestion): LiveToken | undefined => {
    const live = readToken();

    if (live === undefined) return undefined;

    return showsLive(live.token) ||
      rankLive(live.token).some((candidate) => candidate.id === suggestion.id)
      ? live
      : undefined;
  };

  const click = (suggestion: ComposerSuggestion): void => {
    const live = offered(suggestion);

    if (live !== undefined) select(suggestion, live.token, live.text);
  };

  const insertTrigger = (trigger: "@" | "/"): void => {
    const editor = editorRef.current;

    if (editor === null) return;
    const current = editor.readDocument();
    const start = current.selectionStart;
    const leadingSpace = start > 0 && !/\s/.test(current.text[start - 1] ?? "") ? " " : "";
    editor.replaceText(start, current.selectionEnd, `${leadingSpace}${trigger}`);
  };

  const pick = (): void => {
    const live = readToken();

    if (live === undefined) {
      show(undefined);

      return;
    }

    const choice = pickFor(showsLive(live.token), suggestions, activeSuggestion?.id, () =>
      rankLive(live.token),
    );

    if (choice.kind === "accept") select(choice.suggestion, live.token, live.text);

    if (choice.kind === "select") dispatch({ kind: "select", id: choice.id });
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (menu === undefined || !open) return false;
    const key = menuKey(event, { index: Math.max(0, activeIndex), count: suggestions.length });

    if (key.kind === "pass") return false;
    event.preventDefault();

    if (key.kind === "close") {
      dispatch({ kind: "dismiss" });
      requestArguments(undefined);
    }

    const moved = key.kind === "move" ? suggestions[key.to] : undefined;

    if (moved !== undefined) dispatch({ kind: "select", id: moved.id });

    if (key.kind === "pick") pick();

    return true;
  };

  const status = (): string | undefined => {
    if (menu === undefined) return undefined;

    if (menu.kind === "argument") {
      if (argumentResult?.status === "error") return argumentResult.message;

      if (suggestions.length > 0) return undefined;

      return argumentResult === undefined ? "Loading…" : "No matches";
    }

    if (menu.kind === "mention" && scanning) return "Loading files…";

    return suggestions.length === 0
      ? suggestionEmptyText(
          menu.kind,
          menu.kind === "mention" ? mentionFiles : suggestionCatalog,
          onCommand === undefined ? "skills" : "commands and skills",
        )
      : undefined;
  };

  const statusText = status();

  const menuElement = (
    <>
      <Popover.Root
        open={open}
        modal={false}
        onOpenChange={(open, details) => {
          if (open) return;
          const target = details.event.target;

          if (
            details.reason === "escape-key" ||
            ((details.reason === "outside-press" || details.reason === "focus-out") &&
              target instanceof Node &&
              anchorRef.current?.contains(target) === true)
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
                  ? scanning
                  : menu?.kind === "argument"
                    ? argumentResult === undefined
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
                {suggestions.map((suggestion, optionIndex) => {
                  const previous = suggestions[optionIndex - 1];

                  const startsGroup =
                    previous !== undefined &&
                    suggestionGroup(previous) !== suggestionGroup(suggestion);

                  const optionId = `${popupId}-${String(optionIndex)}`;
                  const selected = activeIndex === optionIndex;

                  const description =
                    suggestion.kind === "file"
                      ? suggestion.description
                      : descriptionExcerpt(suggestion.description, deferredQuery);

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
                      onPointerMove={() => dispatch({ kind: "select", id: suggestion.id })}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => click(suggestion)}
                    >
                      <span aria-hidden="true" {...props(composerStyles.suggestionIcon)}>
                        {suggestion.kind === "file" && suggestion.file.kind === "file" ? (
                          <FileTypeIcon path={suggestion.file.path} />
                        ) : (
                          <Icon name={suggestion.icon} size="xs" />
                        )}
                      </span>
                      <span {...props(composerStyles.suggestionText)}>
                        <span {...props(composerStyles.suggestionLabel)}>
                          <HighlightedSuggestionText
                            text={suggestion.label}
                            query={deferredQuery}
                          />
                        </span>
                        <span {...props(text.base, composerStyles.suggestionDescription)}>
                          {suggestion.kind === "file" ? (
                            description
                          ) : (
                            <HighlightedSuggestionText text={description} query={deferredQuery} />
                          )}
                        </span>
                      </span>
                    </div>
                  );
                })}
                {statusText !== undefined && (
                  <div role="status" {...props(text.base, composerStyles.suggestionEmpty)}>
                    {statusText}
                  </div>
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
            anchor={listRef}
            side="right"
            align="start"
            sideOffset={-12}
            alignOffset={-8}
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
      activeOption: !open || activeIndex === -1 ? undefined : `${popupId}-${String(activeIndex)}`,
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
