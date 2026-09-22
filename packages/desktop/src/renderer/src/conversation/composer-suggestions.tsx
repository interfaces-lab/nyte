/**
 * The `@` and `/` completion popup every composer editor shares: the message
 * composer and the in-transcript message edit. The hook owns the open token,
 * ranking, keyboard navigation, and the preview card; the caller wires it to
 * one `ComposerEditor` and renders `menu` beside it.
 */
import * as stylex from "@stylexjs/stylex";
import { Popover } from "@nyte-ai/ui/popover";
import { PreviewCard } from "@nyte-ai/ui/preview-card";
import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import type { MentionFile } from "@nyte-ai/client";
import type { CommandInfo, PluginCatalog } from "@nyte-ai/protocol";
import type { Skill } from "@nyte-ai/schema";
import { Icon } from "../components/icons.tsx";
import { FileTypeIcon } from "../components/file-type-icon.tsx";
import { overlayRef } from "../components/overlay-occlusion.ts";
import { floatingSurfaceStyles } from "../theme/floating-surface.stylex.ts";
import type { ComposerCompletion } from "./composer-document.ts";
import type { ComposerComboboxState, ComposerEditorHandle } from "./composer-editor.tsx";
import { createMentionSuggestionRanking } from "./composer-suggestion-ranking.ts";
import type { FileSuggestion, MentionSuggestion } from "./composer-suggestion-ranking.ts";
import { composerEnterAction } from "./composer-keys.ts";
import { mentionPreviewRows } from "./mention-preview.ts";
import { CONVERSATION_MENTION, isFolder, sameReference } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import { composerStyles } from "./styles.stylex.ts";

const NONE: readonly never[] = [];

interface SkillSuggestion {
  readonly kind: "skill";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: "skills";
  readonly skill: Skill;
}

interface PluginCommandSuggestion {
  readonly kind: "plugin-command";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: "sparkle";
  readonly command: CommandInfo;
}

type ComposerSuggestion =
  | PluginCommandSuggestion
  | SkillSuggestion
  | MentionSuggestion
  | FileSuggestion;

/** Suggestions that become chips; the rest rewrite the token in place. */
type ChipSuggestion = Exclude<ComposerSuggestion, PluginCommandSuggestion>;

type SuggestionMenuState =
  | {
      readonly kind: "mention";
      readonly start: number;
      readonly end: number;
      readonly query: string;
    }
  | {
      readonly kind: "slash";
      readonly start: number;
      readonly end: number;
      readonly query: string;
    };

/** A fetched input the popup renders truthfully: loading and failure are states, not empty lists. */
type ComposerSource<T> =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly data: T };

export type ComposerSuggestionCatalog = ComposerSource<PluginCatalog>;
export type ComposerMentionFiles = ComposerSource<readonly MentionFile[]>;

export function composerSource<T>(data: T | undefined, failed: boolean): ComposerSource<T> {
  if (data !== undefined) return { status: "ready", data };
  return failed ? { status: "error" } : { status: "loading" };
}

const NYTE_COMMAND_OWNERS = new Set(["", "fast-mode", "rename", "web-search"]);

/**
 * Scroll the popup's own list so the option is visible. `scrollIntoView` also
 * walks the fixed popup's ancestors and can drag the thread or the window with
 * it; this touches nothing but the list.
 */
function revealSuggestion(list: HTMLElement | null, option: HTMLElement): void {
  if (list === null) return;
  // The list is positioned, so offsets are relative to it.
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

interface RankedSuggestion {
  readonly suggestion: ComposerSuggestion;
  readonly index: number;
  readonly rank: number;
}

function rankSuggestions(
  suggestions: readonly ComposerSuggestion[],
  query: string,
): readonly ComposerSuggestion[] {
  if (query === "") return suggestions;
  return suggestions
    .flatMap((suggestion, index): RankedSuggestion[] => {
      const label = suggestion.label.toLocaleLowerCase();
      const description = suggestion.description.toLocaleLowerCase();
      const rank = label.startsWith(query)
        ? 0
        : label.includes(query)
          ? 1
          : description.includes(query)
            ? 2
            : undefined;
      return rank === undefined ? [] : [{ suggestion, index, rank }];
    })
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ suggestion }) => suggestion);
}

function suggestionsFor(
  kind: SuggestionMenuState["kind"],
  rawQuery: string,
  commands: readonly CommandInfo[],
  skills: readonly Skill[],
  rankMentions: ReturnType<typeof createMentionSuggestionRanking>,
  hasConversationContext: boolean,
): readonly ComposerSuggestion[] {
  if (kind === "mention") {
    return rankMentions(rawQuery, hasConversationContext);
  }
  const query = rawQuery.trim().toLocaleLowerCase();
  return rankSuggestions(
    [
      ...commands.map((command): ComposerSuggestion => ({
        kind: "plugin-command",
        id: `plugin-command:${command.name}`,
        label: command.name,
        description: command.description,
        icon: "sparkle",
        command,
      })),
      ...skills.map((skill): ComposerSuggestion => ({
        kind: "skill",
        id: `skill:${skill.name}`,
        label: skill.name,
        description: skill.description,
        icon: "skills",
        skill,
      })),
    ],
    query,
  );
}

type SuggestionGroup = "context" | "files" | "commands" | "skills";

function suggestionGroup(suggestion: ComposerSuggestion): SuggestionGroup {
  switch (suggestion.kind) {
    case "mention":
      return "context";
    case "file":
      return "files";
    case "plugin-command":
      return "commands";
    case "skill":
      return "skills";
    default: {
      const _exhaustive: never = suggestion;
      return _exhaustive;
    }
  }
}

function suggestionPreviewTitle(suggestion: ComposerSuggestion): string {
  if (suggestion.kind !== "skill") return suggestion.label;
  return suggestion.label
    .split(/[-_]/u)
    .filter((part) => part !== "")
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function suggestionAttribution(suggestion: ComposerSuggestion): string | undefined {
  switch (suggestion.kind) {
    case "plugin-command":
      return NYTE_COMMAND_OWNERS.has(suggestion.command.owner)
        ? "Created by Nyte"
        : `Created by ${suggestion.command.owner}`;
    case "skill":
      return suggestion.skill.filePath;
    case "mention":
      return undefined;
    case "file":
      return isFolder(suggestion.file) ? "Workspace folder" : "Workspace file";
    default: {
      const _exhaustive: never = suggestion;
      return _exhaustive;
    }
  }
}

function suggestionEmptyText(
  kind: SuggestionMenuState["kind"],
  source: ComposerSource<unknown>,
): string {
  switch (source.status) {
    case "loading":
      return kind === "mention" ? "Loading files…" : "Loading commands and skills…";
    case "error":
      return kind === "mention"
        ? "Couldn’t load workspace files"
        : "Couldn’t load commands and skills";
    case "ready":
      return kind === "mention" ? "No Context Found" : "No Matches Found";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function descriptionExcerpt(description: string, query: string): string {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery === "") return description;
  const match = description.toLocaleLowerCase().indexOf(normalizedQuery);
  if (match <= 36) return description;
  const start = Math.max(0, match - 24);
  return `${start === 0 ? "" : "…"}${description.slice(start)}`;
}

function HighlightedSuggestionText({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}): ReactElement {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const match = normalizedQuery === "" ? -1 : text.toLocaleLowerCase().indexOf(normalizedQuery);
  if (match === -1) return <>{text}</>;
  const end = match + normalizedQuery.length;
  return (
    <>
      {text.slice(0, match)}
      <span {...stylex.props(composerStyles.suggestionMatch)}>{text.slice(match, end)}</span>
      {text.slice(end)}
    </>
  );
}

/**
 * A mentioned path reads as the walk down to it: one row per folder, the file
 * or folder itself last. The path line it replaces said the same thing in one
 * ellipsised string.
 */
function MentionPathPreview({ file }: { readonly file: MentionFile }): ReactElement {
  const rows = mentionPreviewRows(file.displayPath);
  return (
    <div {...stylex.props(composerStyles.suggestionPreviewPath)}>
      {rows.map((row, depth) => (
        <div
          key={`${String(depth)}:${row.label}`}
          {...stylex.props(
            composerStyles.suggestionPreviewPathRow,
            composerStyles.suggestionPreviewPathIndent(depth),
            depth === rows.length - 1 && composerStyles.suggestionPreviewPathLeaf,
          )}
        >
          {row.kind === "file" ? (
            <FileTypeIcon path={row.label} />
          ) : (
            <span aria-hidden="true" {...stylex.props(composerStyles.suggestionPreviewPathIcon)}>
              <Icon name="folder" size={12} />
            </span>
          )}
          <span {...stylex.props(composerStyles.suggestionPreviewPathLabel)}>{row.label}</span>
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
      <div {...stylex.props(composerStyles.suggestionPreviewTitle)}>
        {suggestionPreviewTitle(suggestion)}
      </div>
      {attribution !== undefined && (
        <div {...stylex.props(composerStyles.suggestionPreviewAttribution)}>
          <span aria-hidden="true" {...stylex.props(composerStyles.suggestionPreviewIcon)}>
            <Icon name={suggestion.icon} size={12} />
          </span>
          {attribution}
        </div>
      )}
      {suggestion.kind === "file" ? (
        <MentionPathPreview file={suggestion.file} />
      ) : (
        suggestion.kind !== "mention" && (
          <div {...stylex.props(composerStyles.suggestionPreviewDescription)}>
            {suggestion.description}
          </div>
        )
      )}
    </>
  );
}

function suggestionReference(suggestion: ChipSuggestion): MessageReference {
  switch (suggestion.kind) {
    case "skill":
      return { kind: "skill", name: suggestion.skill.name, path: suggestion.skill.filePath };
    case "mention":
      return CONVERSATION_MENTION;
    case "file":
      return { kind: "file", file: suggestion.file };
    default: {
      const exhaustive: never = suggestion;
      return exhaustive;
    }
  }
}

interface ComposerSuggestionsOptions {
  readonly editorRef: RefObject<ComposerEditorHandle | null>;
  /** The popup anchors here; presses and focus moves inside it are editing, not dismissal. */
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly side: "top" | "bottom";
  readonly suggestionCatalog: ComposerSuggestionCatalog;
  readonly mentionFiles: ComposerMentionFiles;
  readonly hasConversationContext: boolean;
  /** Chips already in the draft; a repeated skill or context chip is dropped instead of doubled. */
  readonly references: readonly MessageReference[];
}

interface ComposerSuggestions {
  readonly open: boolean;
  readonly combobox: ComposerComboboxState;
  /** Workspace entries the editor resolves typed paths against. */
  readonly files: readonly MentionFile[];
  readonly onCompletionChange: (completion: ComposerCompletion | undefined) => void;
  /** Menu navigation and selection; true when the key was consumed. */
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
  /** Types the trigger at the caret so the completion opens from the edit itself. */
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
}: ComposerSuggestionsOptions): ComposerSuggestions {
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<SuggestionMenuState>();
  const [index, setIndex] = useState(0);
  const popupId = useId();
  const [previewHandle] = useState(() => PreviewCard.createHandle<ComposerSuggestion>());
  const deferredQuery = useDeferredValue(menu?.query ?? "");
  const commands = suggestionCatalog.status === "ready" ? suggestionCatalog.data.commands : NONE;
  const skills = suggestionCatalog.status === "ready" ? suggestionCatalog.data.skills : NONE;
  const files = mentionFiles.status === "ready" ? mentionFiles.data : NONE;
  const rankMentions = useMemo(() => createMentionSuggestionRanking(files), [files]);
  const kind = menu?.kind;
  // Up to thousands of files rank per keystroke; keep that off the render path
  // for renders that changed nothing the ranking reads.
  const suggestions = useMemo(
    () =>
      kind === undefined
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
  const activeIndex = Math.min(index, Math.max(0, suggestions.length - 1));

  const openPreview = (nextIndex: number): void => {
    requestAnimationFrame(() => {
      const optionId = `${popupId}-${String(nextIndex)}`;
      const option = window.document.getElementById(optionId);
      if (option === null) return;
      revealSuggestion(listRef.current, option);
      previewHandle.open(optionId);
    });
  };
  const show = (next: SuggestionMenuState | undefined): void => {
    const continuesCurrentToken =
      menu !== undefined &&
      next !== undefined &&
      menu.kind === next.kind &&
      menu.start === next.start;
    if (!continuesCurrentToken) {
      previewHandle.close();
      setIndex(0);
      if (next !== undefined) openPreview(0);
    }
    setMenu(next);
  };
  const activate = (nextIndex: number): void => {
    setIndex(nextIndex);
    openPreview(nextIndex);
  };
  const clampedActivate = (nextIndex: number): void => {
    if (suggestions.length === 0) return;
    activate(Math.max(0, Math.min(suggestions.length - 1, nextIndex)));
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

  const select = (suggestion: ComposerSuggestion): void => {
    if (menu === undefined) return;
    if (suggestion.kind === "plugin-command") {
      editorRef.current?.replaceText(menu.start, menu.end, `/${suggestion.command.name} `);
    } else {
      addReference(suggestionReference(suggestion), menu.start, menu.end);
    }
    show(undefined);
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
    if (menu === undefined) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      show(undefined);
      return true;
    }
    const down =
      event.key === "ArrowDown" || (event.ctrlKey && (event.key === "n" || event.key === "j"));
    const up =
      event.key === "ArrowUp" || (event.ctrlKey && (event.key === "p" || event.key === "k"));
    if (down || up) {
      event.preventDefault();
      clampedActivate(activeIndex + (down ? 1 : -1));
      return true;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      clampedActivate(event.key === "Home" ? 0 : suggestions.length - 1);
      return true;
    }
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      clampedActivate(activeIndex + (event.key === "PageDown" ? 9 : -9));
      return true;
    }
    // Plain Enter and Tab pick; the modifier keeps its meaning and sends past the menu.
    const picks =
      composerEnterAction(event) === "submit" || (event.key === "Tab" && !event.shiftKey);
    if (!picks) return false;
    const active = suggestions[activeIndex];
    if (active === undefined) {
      show(undefined);
      return false;
    }
    event.preventDefault();
    select(active);
    return true;
  };

  const menuElement = (
    <>
      <Popover.Root
        open={menu !== undefined}
        modal={false}
        onOpenChange={(open, details) => {
          if (open) return;
          // The editor drives this popup. A press or focus move inside
          // the anchor is editing, not dismissal; `select` decides then.
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
            positionMethod="fixed"
            anchor={anchorRef}
            side={side}
            align="start"
            sideOffset={8}
            collisionPadding={8}
            collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
            {...stylex.props(composerStyles.suggestionPositioner)}
          >
            <Popover.Popup
              ref={overlayRef}
              id={popupId}
              role="listbox"
              initialFocus={false}
              finalFocus={false}
              aria-busy={
                menu?.kind === "mention"
                  ? mentionFiles.status === "loading"
                  : suggestionCatalog.status === "loading"
              }
              aria-label={
                menu?.kind === "mention"
                  ? "Mention files and context"
                  : "Commands, skills, and prompts"
              }
              onMouseDown={(event) => event.preventDefault()}
              {...stylex.props(floatingSurfaceStyles.popup, composerStyles.suggestionMenu)}
            >
              <div ref={listRef} {...stylex.props(composerStyles.suggestionList)}>
                {suggestions.length === 0 ? (
                  <div role="status" {...stylex.props(composerStyles.suggestionEmpty)}>
                    {menu === undefined
                      ? undefined
                      : suggestionEmptyText(
                          menu.kind,
                          menu.kind === "mention" ? mentionFiles : suggestionCatalog,
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
                      <PreviewCard.Trigger
                        key={suggestion.id}
                        id={optionId}
                        handle={previewHandle}
                        payload={suggestion}
                        delay={0}
                        closeDelay={100}
                        render={
                          <div
                            role="option"
                            tabIndex={-1}
                            aria-selected={selected}
                            {...stylex.props(
                              composerStyles.suggestionItem,
                              startsGroup && composerStyles.suggestionGroupStart,
                            )}
                            onPointerMove={() => {
                              if (!selected) setIndex(optionIndex);
                            }}
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={() => select(suggestion)}
                          >
                            <span
                              aria-hidden="true"
                              {...stylex.props(composerStyles.suggestionIcon)}
                            >
                              <Icon name={suggestion.icon} size={12} />
                            </span>
                            <span {...stylex.props(composerStyles.suggestionText)}>
                              <span {...stylex.props(composerStyles.suggestionLabel)}>
                                <HighlightedSuggestionText
                                  text={suggestion.label}
                                  query={deferredQuery}
                                />
                              </span>
                              <span {...stylex.props(composerStyles.suggestionDescription)}>
                                <HighlightedSuggestionText
                                  text={description}
                                  query={deferredQuery}
                                />
                              </span>
                            </span>
                          </div>
                        }
                      />
                    );
                  })
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <PreviewCard.Root handle={previewHandle}>
        {({ payload }) =>
          payload === undefined ? null : (
            <PreviewCard.Portal>
              <PreviewCard.Positioner
                positionMethod="fixed"
                side="right"
                align="end"
                sideOffset={6}
                collisionPadding={8}
                collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
                {...stylex.props(composerStyles.suggestionPreviewPositioner)}
              >
                <PreviewCard.Popup
                  ref={overlayRef}
                  aria-label={`Details for ${payload.label}`}
                  {...stylex.props(floatingSurfaceStyles.popup, composerStyles.suggestionPreview)}
                >
                  <SuggestionPreview suggestion={payload} />
                </PreviewCard.Popup>
              </PreviewCard.Positioner>
            </PreviewCard.Portal>
          )
        }
      </PreviewCard.Root>
    </>
  );

  return {
    open: menu !== undefined,
    combobox: {
      expanded: menu !== undefined,
      popupId: menu === undefined ? undefined : popupId,
      activeOption:
        menu === undefined || suggestions.length === 0
          ? undefined
          : `${popupId}-${String(activeIndex)}`,
    },
    files,
    onCompletionChange: (completion) =>
      show(
        completion === undefined
          ? undefined
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
