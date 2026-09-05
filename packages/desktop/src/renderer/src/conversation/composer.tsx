/**
 * The input surface, shaped like Cursor's Agents composer (layout reference
 * only; no code ported): the new-chat field stacks above its controls while
 * the follow-up field is one compact row. The frame and behavior stay shared.
 *
 * Admission is open (invariant 5): sending while a run is live is not an
 * error — it steers, and the receipt's disposition is the only difference the
 * client sees. The strip above the field shows still-pending queue items with
 * cancel and "send now" (`redeliver`), and Esc requests a durable abort.
 */
import * as stylex from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { Popover, PreviewCard } from "@nyte-ai/ui/primitives";
import {
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DragEvent, ReactElement, ReactNode } from "react";
import { completionTrigger } from "@nyte-ai/core/views";
import type { MentionFile } from "@nyte-ai/core/views";
import type { CommandInfo, PendingItem, PluginCatalog, SessionId } from "@nyte-ai/core";
import type { ImageContent, Skill, TextContent, UserMessage } from "@nyte-ai/schema";
import { Icon, type IconName } from "../components/icons.tsx";
import { Menu, MenuItem, MenuSeparator } from "../components/menu.tsx";
import { focus, IconButton } from "../components/ui.tsx";
import { floatingSurfaceStyles } from "../theme/floating-surface.stylex.ts";
import {
  keys,
  queryClient,
  refreshThread,
  useApplyPluginSetting,
  useCatalog,
  useConfigureSession,
  useMentionFiles,
  usePluginCatalog,
  usePluginSettings,
  useSessionSnapshot,
} from "../queries.ts";
import { nyte } from "../nyte.ts";
import type { OutboxRow, OutboxRowState } from "../outbox.ts";
import { outbox } from "../use-outbox.ts";
import type { ComposerViewState } from "../layout/session-view-state.ts";
import { formatContextWindow } from "./model-picker-state.ts";
import { ModelPicker, type ModelPickerChange } from "./model-picker.tsx";
import { parsePluginCommand } from "./plugin-command.ts";
import { ImagePreview } from "./image-preview.tsx";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor.tsx";
import { composerStyles } from "./styles.stylex.ts";

const FOLLOW_UP_PLACEHOLDER = "Add a follow-up";
const DROP_PLACEHOLDER = "Drop here to attach…";
const ACCEPTED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
/** The popup lists this many workspace entries at most; typing narrows the rest. */
const MAX_FILE_SUGGESTIONS = 20;
const NONE: readonly never[] = [];

function boundaryLane(): string {
  const policy = nyte.landing.lanes.find((candidate) => candidate.lands === "boundary");
  if (policy === undefined) throw new Error("The landing policy has no boundary lane");
  return policy.lane;
}

const STEER_LANE = boundaryLane();

export type ComposerSurface = "new-chat" | "follow-up";
type ComposerGeometry = "new-chat" | "follow-up-compact" | "follow-up-expanded";

export interface ComposerImageAttachment {
  readonly id: string;
  readonly name: string;
  readonly previewUrl: string;
  readonly content: ImageContent;
}

interface CommandSuggestion {
  readonly kind: "command";
  readonly id: "plan" | "debug" | "ask" | "multitask";
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  readonly instruction: string;
}

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

interface MentionSuggestion {
  readonly kind: "mention";
  readonly id: "current-conversation";
  readonly label: "Current conversation";
  readonly description: "Use this conversation as context";
  readonly icon: "more";
}

interface FileSuggestion {
  readonly kind: "file";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: "file" | "folder";
  readonly file: MentionFile;
}

type ComposerSuggestion =
  | CommandSuggestion
  | PluginCommandSuggestion
  | SkillSuggestion
  | MentionSuggestion
  | FileSuggestion;

/** Suggestions that become chips; the rest rewrite the token in place. */
type ChipSuggestion = Exclude<ComposerSuggestion, PluginCommandSuggestion>;

export type ComposerChip =
  | (Pick<FileSuggestion, "kind" | "id" | "label" | "file"> & { readonly tokenId: string })
  | (Pick<CommandSuggestion, "kind" | "id" | "label" | "instruction"> & {
      readonly tokenId: string;
    })
  | {
      readonly kind: "skill";
      readonly id: string;
      readonly label: string;
      readonly tokenId: string;
      readonly skill: Skill;
    }
  | {
      readonly kind: "mention";
      readonly id: MentionSuggestion["id"];
      readonly label: MentionSuggestion["label"];
      readonly tokenId: string;
    };

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
export type ComposerSource<T> =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly data: T };

export type ComposerSuggestionCatalog = ComposerSource<PluginCatalog>;
export type ComposerMentionFiles = ComposerSource<readonly MentionFile[]>;

export function composerSource<T>(data: T | undefined, failed: boolean): ComposerSource<T> {
  if (data !== undefined) return { status: "ready", data };
  return failed ? { status: "error" } : { status: "loading" };
}

const PLAN_SUGGESTION = {
  kind: "command",
  id: "plan",
  label: "Plan",
  description: "Ask for an implementation plan",
  icon: "square-checklist",
  instruction: "Create an implementation plan.",
} satisfies CommandSuggestion;

const MULTITASK_SUGGESTION = {
  kind: "command",
  id: "multitask",
  label: "Multitask",
  description: "Run independent parts of the task in parallel",
  icon: "circles",
  instruction: "Break this task into parallel subtasks when useful.",
} satisfies CommandSuggestion;

const DEBUG_SUGGESTION = {
  kind: "command",
  id: "debug",
  label: "Debug",
  description: "Pinpoint the root cause of an issue",
  icon: "bug",
  instruction: "Investigate this problem before changing code.",
} satisfies CommandSuggestion;

const ASK_SUGGESTION = {
  kind: "command",
  id: "ask",
  label: "Ask",
  description: "Answer questions without making edits",
  icon: "bubble-question",
  instruction: "Answer this question without making edits.",
} satisfies CommandSuggestion;

const BUILTIN_SLASH_SUGGESTIONS = [
  PLAN_SUGGESTION,
  DEBUG_SUGGESTION,
  MULTITASK_SUGGESTION,
  ASK_SUGGESTION,
] satisfies readonly ComposerSuggestion[];

const NYTE_COMMAND_OWNERS = new Set(["", "fast-mode", "rename", "web-search"]);

function isAcceptedImage(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.has(file.type);
}

function isTextFileReaderResult(result: FileReader["result"]): result is string {
  return typeof result === "string";
}

function readImageAttachment(file: File): Promise<ComposerImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        const result = reader.result;
        if (!isTextFileReaderResult(result)) {
          reject(new Error(`Could not read ${file.name}`));
          return;
        }
        const marker = ";base64,";
        const markerIndex = result.indexOf(marker);
        if (!result.startsWith("data:") || markerIndex === -1) {
          reject(new Error(`Could not encode ${file.name}`));
          return;
        }
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          previewUrl: result,
          content: {
            type: "image",
            data: result.slice(markerIndex + marker.length),
            mimeType: file.type,
          },
        });
      },
      { once: true },
    );
    reader.addEventListener("error", () => reject(new Error(`Could not read ${file.name}`)), {
      once: true,
    });
    reader.addEventListener(
      "abort",
      () => reject(new Error(`Reading ${file.name} was cancelled`)),
      {
        once: true,
      },
    );
    reader.readAsDataURL(file);
  });
}

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

function suggestionAt(value: string, caret: number): SuggestionMenuState | undefined {
  const trigger = completionTrigger(value, caret);
  if (trigger === undefined) return undefined;
  return {
    kind: trigger.kind === "@" ? "mention" : "slash",
    start: trigger.start,
    end: trigger.end,
    query: trigger.query,
  };
}

function isFolder(file: MentionFile): boolean {
  return file.label.endsWith("/");
}

function fileSuggestion(file: MentionFile): FileSuggestion {
  return {
    kind: "file",
    id: `file:${file.path}`,
    label: file.label,
    description: file.displayPath,
    icon: isFolder(file) ? "folder" : "file",
    file,
  };
}

/** The text a picked file becomes: the same `@file://` spelling the TUI sends. */
export function fileMentionText(file: MentionFile): string {
  return `@${file.url}`;
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
  files: readonly MentionFile[],
  hasConversationContext: boolean,
): readonly ComposerSuggestion[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (kind === "mention") {
    const context: readonly ComposerSuggestion[] = hasConversationContext
      ? [
          {
            kind: "mention",
            id: "current-conversation",
            label: "Current conversation",
            description: "Use this conversation as context",
            icon: "more",
          },
        ]
      : [];
    // Files rank among themselves so a long tree never buries the context entry.
    return [
      ...rankSuggestions(context, query),
      ...rankSuggestions(files.map(fileSuggestion), query).slice(0, MAX_FILE_SUGGESTIONS),
    ];
  }
  const commandNames = new Set(commands.map((command) => command.name));
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
      ...BUILTIN_SLASH_SUGGESTIONS.filter((suggestion) => !commandNames.has(suggestion.id)),
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

type SuggestionGroup = "context" | "files" | "commands" | "modes" | "skills";

function suggestionGroup(suggestion: ComposerSuggestion): SuggestionGroup {
  switch (suggestion.kind) {
    case "mention":
      return "context";
    case "file":
      return "files";
    case "plugin-command":
      return "commands";
    case "command":
      return "modes";
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

function suggestionAttribution(suggestion: ComposerSuggestion): string {
  switch (suggestion.kind) {
    case "command":
      return "Created by Nyte";
    case "plugin-command":
      return NYTE_COMMAND_OWNERS.has(suggestion.command.owner)
        ? "Created by Nyte"
        : `Created by ${suggestion.command.owner}`;
    case "skill":
      return suggestion.skill.filePath;
    case "mention":
      return "Conversation context";
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

function SuggestionPreview({
  suggestion,
}: {
  readonly suggestion: ComposerSuggestion;
}): ReactElement {
  return (
    <>
      <div {...stylex.props(composerStyles.suggestionPreviewTitle)}>
        {suggestionPreviewTitle(suggestion)}
      </div>
      <div {...stylex.props(composerStyles.suggestionPreviewAttribution)}>
        <span aria-hidden="true" {...stylex.props(composerStyles.suggestionPreviewIcon)}>
          <Icon name={suggestion.icon} size={12} />
        </span>
        {suggestionAttribution(suggestion)}
      </div>
      <div {...stylex.props(composerStyles.suggestionPreviewDescription)}>
        {suggestion.description}
      </div>
    </>
  );
}

function chipInstruction(chip: ComposerChip): string | undefined {
  switch (chip.kind) {
    case "command":
      return chip.instruction;
    case "skill":
      return `Use the ${chip.skill.name} skill.`;
    case "mention":
    case "file":
      return undefined;
    default: {
      const _exhaustive: never = chip;
      return _exhaustive;
    }
  }
}

export function composerPromptText(text: string, chips: readonly ComposerChip[] = []): string {
  const instructions = chips.flatMap((chip) => {
    const instruction = chipInstruction(chip);
    return instruction === undefined ? [] : [instruction];
  });
  return [...instructions, text].filter((part) => part !== "").join("\n\n");
}

export function composerMessageContent(
  text: string,
  attachments: readonly ComposerImageAttachment[],
  chips: readonly ComposerChip[] = [],
): UserMessage["content"] {
  const prompt = composerPromptText(text, chips);
  if (attachments.length === 0) return prompt;
  const parts: (TextContent | ImageContent)[] = [];
  if (prompt !== "") parts.push({ type: "text", text: prompt });
  for (const attachment of attachments) parts.push(attachment.content);
  return parts;
}

export async function readComposerImageAttachments(files: readonly File[]): Promise<{
  readonly attachments: readonly ComposerImageAttachment[];
  readonly error: string | undefined;
}> {
  const imageFiles = files.filter(isAcceptedImage);
  if (imageFiles.length === 0) {
    return {
      attachments: [],
      error: "Nyte accepts PNG, JPEG, WebP, and GIF images.",
    };
  }
  const results = await Promise.allSettled(imageFiles.map(readImageAttachment));
  const attachments = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const error =
    attachments.length !== imageFiles.length
      ? "Some images could not be read."
      : imageFiles.length !== files.length
        ? "Nyte accepts PNG, JPEG, WebP, and GIF images."
        : undefined;
  return { attachments, error };
}

/**
 * Session-bound chip: reads the executing host's inputs from core and
 * configures on pick. The context gauge sits
 * beside it because the two describe the same thing: how much of this model
 * the conversation has used.
 */
const SessionModelChip = memo(function SessionModelChip({
  sessionId,
}: {
  sessionId: SessionId;
}): ReactElement | null {
  const catalog = useCatalog();
  const snapshot = useSessionSnapshot(sessionId);
  const configure = useConfigureSession(sessionId);
  const context = snapshot.data?.context;
  const options = catalog.data?.models ?? [];
  const configured = snapshot.data?.config.model;
  const current = options.find(
    (option) =>
      option.id === configured?.id &&
      (configured.provider === undefined || option.provider === configured.provider),
  );
  const pluginSettings = usePluginSettings(
    sessionId,
    options.some((option) => option.fastMode.kind === "available"),
  );
  const applyPluginSetting = useApplyPluginSetting(sessionId);
  const fastEnabled = useMemo(
    () =>
      new Set(
        (pluginSettings.data ?? [])
          .filter((setting) => setting.current === "on")
          .map((setting) => setting.id),
      ),
    [pluginSettings.data],
  );
  const handleChange = useCallback(
    (change: ModelPickerChange) => {
      switch (change.kind) {
        case "model":
          configure.mutate({
            model: { provider: change.option.provider, id: change.option.id },
            thinkingLevel: change.thinkingLevel,
          });
          return;
        case "thinking":
          configure.mutate({ thinkingLevel: change.thinkingLevel });
          return;
        case "fast":
          applyPluginSetting.mutate({
            id: change.settingId,
            choiceId: change.enabled ? "on" : "off",
          });
          return;
        default: {
          const _exhaustive: never = change;
          return _exhaustive;
        }
      }
    },
    [applyPluginSetting, configure],
  );

  return (
    <>
      <ModelPicker
        catalog={catalog.data}
        current={current}
        thinkingLevel={snapshot.data?.config.thinkingLevel}
        fastEnabled={fastEnabled}
        disabled={configure.isPending}
        onChange={handleChange}
      />
      {context?.percent !== undefined && (
        <span
          {...stylex.props(composerStyles.gauge)}
          title={
            context.contextWindow === undefined
              ? `${String(context.estimatedTokens)} tokens`
              : `${String(context.estimatedTokens)} tokens of ${formatContextWindow(context.contextWindow)}`
          }
        >
          {String(Math.round(context.percent))}%
        </span>
      )}
    </>
  );
});

export interface ComposerFrameProps {
  /** Placement is caller intent; the follow-up surface derives its own geometry. */
  readonly surface: ComposerSurface;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (chips: readonly ComposerChip[]) => boolean | Promise<boolean>;
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** A run is live: empty-input Esc and the idle button both request an abort. */
  busy?: boolean;
  onAbort?: () => void;
  /** The model chip slot, left side of the controls row. */
  model?: ReactNode;
  inputRef?: (element: HTMLDivElement | null) => void;
  selectionStart?: number;
  selectionEnd?: number;
  onSelectionChange?: (start: number, end: number) => void;
  onFocusChange?: (focused: boolean) => void;
  suggestionCatalog: ComposerSuggestionCatalog;
  /** Workspace entries behind `@`. Callers without an open workspace pass an empty ready list. */
  mentionFiles: ComposerMentionFiles;
  hasConversationContext?: boolean;
  attachments?: readonly ComposerImageAttachment[];
  attachmentBusy?: boolean;
  attachmentError?: string;
  onFilesSelected?: (files: readonly File[]) => void;
  onAttachmentRemove?: (id: string) => void;
}

const carriesFiles = (event: DragEvent<HTMLFormElement>): boolean =>
  Array.from(event.dataTransfer.types).includes("Files");

/** The frame both composers share: autosizing textarea plus the same controls. */
export function ComposerFrame({
  surface,
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus = false,
  disabled = false,
  busy = false,
  onAbort,
  model,
  inputRef,
  selectionStart,
  selectionEnd,
  onSelectionChange,
  onFocusChange,
  suggestionCatalog,
  mentionFiles,
  hasConversationContext = false,
  attachments = [],
  attachmentBusy = false,
  attachmentError,
  onFilesSelected,
  onAttachmentRemove,
}: ComposerFrameProps): ReactElement {
  const frameRef = useRef<HTMLFormElement>(null);
  const areaRef = useRef<ComposerEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestionListRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [editorNeedsExpansion, setEditorNeedsExpansion] = useState(false);
  const [chips, setChips] = useState<readonly ComposerChip[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [suggestionMenu, setSuggestionMenu] = useState<SuggestionMenuState>();
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const suggestionPopupId = useId();
  const [suggestionPreviewHandle] = useState(() => PreviewCard.createHandle<ComposerSuggestion>());
  const canAttach = onFilesSelected !== undefined;
  const hasInstructionChip = chips.some((chip) => chip.kind !== "mention");
  const canSubmit =
    !disabled &&
    !submitting &&
    !attachmentBusy &&
    (value.trim() !== "" || attachments.length > 0 || hasInstructionChip);
  const deferredSuggestionQuery = useDeferredValue(suggestionMenu?.query ?? "");
  const commands = suggestionCatalog.status === "ready" ? suggestionCatalog.data.commands : NONE;
  const skills = suggestionCatalog.status === "ready" ? suggestionCatalog.data.skills : NONE;
  const files = mentionFiles.status === "ready" ? mentionFiles.data : NONE;
  const suggestionMenuKind = suggestionMenu?.kind;
  // Up to thousands of files rank per keystroke; keep that off the render path
  // for renders that changed nothing the ranking reads.
  const suggestions = useMemo(
    () =>
      suggestionMenuKind === undefined
        ? NONE
        : suggestionsFor(
            suggestionMenuKind,
            deferredSuggestionQuery,
            commands,
            skills,
            files,
            hasConversationContext,
          ),
    [suggestionMenuKind, deferredSuggestionQuery, commands, skills, files, hasConversationContext],
  );
  const activeSuggestionIndex = Math.min(suggestionIndex, Math.max(0, suggestions.length - 1));
  const externallyExpanded =
    dragging || attachments.length > 0 || attachmentError !== undefined || chips.length > 0;
  const geometry: ComposerGeometry =
    surface === "new-chat"
      ? "new-chat"
      : editorNeedsExpansion || externallyExpanded
        ? "follow-up-expanded"
        : "follow-up-compact";
  const compact = geometry === "follow-up-compact";
  const followUpExpanded = geometry === "follow-up-expanded";
  const openSuggestionPreview = (index: number): void => {
    requestAnimationFrame(() => {
      const optionId = `${suggestionPopupId}-${String(index)}`;
      const option = document.getElementById(optionId);
      if (option === null) return;
      revealSuggestion(suggestionListRef.current, option);
      suggestionPreviewHandle.open(optionId);
      // The textarea owns the combobox. PreviewCard associates its popup with
      // a result trigger, but that result must never become the typing target.
      areaRef.current?.focus({ preventScroll: true });
    });
  };
  const showSuggestions = (next: SuggestionMenuState | undefined): void => {
    const continuesCurrentToken =
      suggestionMenu !== undefined &&
      next !== undefined &&
      suggestionMenu.kind === next.kind &&
      suggestionMenu.start === next.start;
    if (!continuesCurrentToken) {
      suggestionPreviewHandle.close();
      setSuggestionIndex(0);
      if (next !== undefined) openSuggestionPreview(0);
    }
    setSuggestionMenu(next);
  };
  const activateSuggestion = (nextIndex: number): void => {
    setSuggestionIndex(nextIndex);
    openSuggestionPreview(nextIndex);
  };

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (area === null || selectionStart === undefined || selectionEnd === undefined) return;
    if (area.selectionStart === selectionStart && area.selectionEnd === selectionEnd) return;
    area.setSelectionRange(selectionStart, selectionEnd);
  }, [selectionEnd, selectionStart, value]);

  const resize = useCallback(
    (area: HTMLDivElement): void => {
      area.style.height = "auto";
      area.style.height = `${String(Math.min(area.scrollHeight, 180))}px`;
      if (surface === "new-chat") return;
      if (area.textContent?.length === 0) {
        setEditorNeedsExpansion(false);
        return;
      }
      if (externallyExpanded && !editorNeedsExpansion) return;
      if (
        area.innerText.includes("\n") ||
        area.scrollWidth > area.clientWidth ||
        area.scrollHeight > 24
      ) {
        setEditorNeedsExpansion(true);
      }
    },
    [editorNeedsExpansion, externallyExpanded, surface],
  );

  useLayoutEffect(() => {
    const area = areaRef.current?.element;
    if (area === null || area === undefined) return;
    resize(area);
  }, [resize, value]);

  useLayoutEffect(() => {
    const area = areaRef.current?.element;
    if (area === null || area === undefined) return undefined;
    const observer = new ResizeObserver(() => resize(area));
    observer.observe(area);
    return () => observer.disconnect();
  }, [resize]);

  const focusAt = (caret: number): void => {
    requestAnimationFrame(() => {
      const area = areaRef.current;
      if (area === null) return;
      area.focus();
      area.setSelectionRange(caret, caret);
      if (area.element !== null) resize(area.element);
    });
  };

  const addSuggestionChip = (suggestion: ChipSuggestion, start?: number, end?: number): void => {
    const tokenId = crypto.randomUUID();
    if (
      suggestion.kind !== "file" &&
      chips.some((chip) => chip.kind === suggestion.kind && chip.id === suggestion.id)
    ) {
      if (start !== undefined) areaRef.current?.replaceText(start, end ?? start, "");
      return;
    }
    switch (suggestion.kind) {
      case "command":
        areaRef.current?.insertChip(
          {
            kind: "command",
            id: suggestion.id,
            label: suggestion.label,
            instruction: suggestion.instruction,
            tokenId,
          },
          start,
          end,
        );
        return;
      case "skill":
        areaRef.current?.insertChip(
          {
            kind: "skill",
            id: suggestion.id,
            label: suggestion.label,
            skill: suggestion.skill,
            tokenId,
          },
          start,
          end,
        );
        return;
      case "mention":
        areaRef.current?.insertChip(
          { kind: "mention", id: suggestion.id, label: suggestion.label, tokenId },
          start,
          end,
        );
        return;
      case "file":
        areaRef.current?.insertChip(
          {
            kind: "file",
            id: suggestion.id,
            label: suggestion.label,
            file: suggestion.file,
            tokenId,
          },
          start,
          end,
        );
        return;
      default: {
        const exhaustive: never = suggestion;
        return exhaustive;
      }
    }
  };

  const selectSuggestion = (suggestion: ComposerSuggestion): void => {
    if (suggestionMenu === undefined) return;
    if (suggestion.kind === "plugin-command") {
      areaRef.current?.replaceText(
        suggestionMenu.start,
        suggestionMenu.end,
        `/${suggestion.command.name} `,
      );
    } else {
      addSuggestionChip(suggestion, suggestionMenu.start, suggestionMenu.end);
    }
    showSuggestions(undefined);
    areaRef.current?.focus();
  };

  const selectQuickSuggestion = (suggestion: CommandSuggestion): void => {
    addSuggestionChip(suggestion);
    areaRef.current?.focus();
  };

  const insertTrigger = (trigger: "@" | "/"): void => {
    const area = areaRef.current;
    const start = area?.selectionStart ?? value.length;
    const end = area?.selectionEnd ?? start;
    const leadingSpace = start > 0 && !/\s/.test(value[start - 1] ?? "") ? " " : "";
    const insertion = `${leadingSpace}${trigger}`;
    const caret = start + insertion.length;
    areaRef.current?.replaceText(start, end, insertion);
    showSuggestions({
      kind: trigger === "@" ? "mention" : "slash",
      start: caret - 1,
      end: caret,
      query: "",
    });
    focusAt(caret);
  };

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (!(await onSubmit(chips))) return;
      setChips([]);
      areaRef.current?.clear();
      setEditorNeedsExpansion(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <form
        ref={frameRef}
        aria-label="Message composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onDragEnter={(event) => {
          if (!disabled && canAttach && carriesFiles(event)) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragOver={(event) => {
          if (!disabled && canAttach && carriesFiles(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          setDragging(false);
          if (disabled || !canAttach || !carriesFiles(event)) return;
          event.preventDefault();
          onFilesSelected(Array.from(event.dataTransfer.files));
        }}
        onDragEnd={() => setDragging(false)}
        {...stylex.props(
          composerStyles.frame,
          geometry === "new-chat" && composerStyles.frameNewChat,
          compact && composerStyles.frameFollowUpCompact,
          followUpExpanded && composerStyles.frameFollowUpExpanded,
          dragging && composerStyles.frameDragging,
        )}
      >
        {dragging && <span aria-hidden="true" {...stylex.props(composerStyles.dropGuard)} />}
        {canAttach && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/gif,image/jpeg,image/png,image/webp"
            multiple
            disabled={disabled}
            tabIndex={-1}
            {...stylex.props(composerStyles.fileInput)}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (files.length > 0) onFilesSelected(files);
            }}
          />
        )}
        {attachments.length > 0 && (
          <ul
            aria-label="Image attachments"
            {...stylex.props(
              composerStyles.attachments,
              followUpExpanded && composerStyles.attachmentsInset,
            )}
          >
            {attachments.map((attachment) => (
              <li key={attachment.id} {...stylex.props(composerStyles.attachment)}>
                <ImagePreview src={attachment.previewUrl} name={attachment.name} compact />
                {onAttachmentRemove !== undefined && (
                  <Button
                    unstyled
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    disabled={disabled}
                    onClick={() => onAttachmentRemove(attachment.id)}
                    {...stylex.props(composerStyles.attachmentRemove, focus.ring)}
                  >
                    <Icon name="x" size={12} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {attachmentError !== undefined && (
          <div
            role="alert"
            {...stylex.props(
              composerStyles.attachmentError,
              followUpExpanded && composerStyles.attachmentErrorInset,
            )}
          >
            {attachmentError}
          </div>
        )}
        <div
          {...stylex.props(
            composerStyles.layout,
            geometry === "new-chat" && composerStyles.layoutNewChat,
            compact && composerStyles.layoutCompact,
          )}
        >
          <div
            {...stylex.props(
              composerStyles.editor,
              compact && composerStyles.editorCompact,
              followUpExpanded && composerStyles.editorExpanded,
            )}
          >
            <ComposerEditor
              ref={areaRef}
              inputRef={inputRef}
              className={
                stylex.props(
                  composerStyles.input,
                  geometry === "new-chat" && composerStyles.inputNewChat,
                  compact && composerStyles.inputCompact,
                ).className
              }
              files={files}
              expanded={suggestionMenu !== undefined}
              popupId={suggestionMenu === undefined ? undefined : suggestionPopupId}
              activeOption={
                suggestionMenu === undefined || suggestions.length === 0
                  ? undefined
                  : `${suggestionPopupId}-${String(activeSuggestionIndex)}`
              }
              placeholder={dragging ? DROP_PLACEHOLDER : placeholder}
              value={value}
              autoFocus={autoFocus && !disabled}
              disabled={disabled}
              onChange={(next, start, end, nextChips) => {
                onChange(next);
                setChips(nextChips);
                onSelectionChange?.(start, end);
                const area = areaRef.current?.element;
                if (area !== null && area !== undefined) resize(area);
                showSuggestions(start === end ? suggestionAt(next, start) : undefined);
              }}
              onFilesSelected={onFilesSelected}
              onFocusChange={onFocusChange}
              onKeyDown={(event) => {
                if (suggestionMenu !== undefined) {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    showSuggestions(undefined);
                    return;
                  }
                  const down =
                    event.key === "ArrowDown" ||
                    (event.ctrlKey && (event.key === "n" || event.key === "j"));
                  const up =
                    event.key === "ArrowUp" ||
                    (event.ctrlKey && (event.key === "p" || event.key === "k"));
                  if (down || up) {
                    event.preventDefault();
                    if (suggestions.length === 0) return;
                    const direction = down ? 1 : -1;
                    activateSuggestion(
                      Math.max(
                        0,
                        Math.min(suggestions.length - 1, activeSuggestionIndex + direction),
                      ),
                    );
                    return;
                  }
                  if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    activateSuggestion(
                      event.key === "Home" ? 0 : Math.max(0, suggestions.length - 1),
                    );
                    return;
                  }
                  if (event.key === "PageDown" || event.key === "PageUp") {
                    event.preventDefault();
                    const direction = event.key === "PageDown" ? 9 : -9;
                    activateSuggestion(
                      Math.max(
                        0,
                        Math.min(suggestions.length - 1, activeSuggestionIndex + direction),
                      ),
                    );
                    return;
                  }
                  const activeSuggestion = suggestions[activeSuggestionIndex];
                  const usesModeShortcut =
                    event.key === "Enter" &&
                    event.altKey &&
                    activeSuggestion !== undefined &&
                    (activeSuggestion.kind === "command" || activeSuggestion.kind === "skill");
                  const activatesSuggestion =
                    (event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.altKey) ||
                    (event.key === "Tab" && !event.shiftKey) ||
                    usesModeShortcut;
                  if (activatesSuggestion && !event.isComposing) {
                    if (activeSuggestion !== undefined) {
                      event.preventDefault();
                      selectSuggestion(activeSuggestion);
                    }
                    return;
                  }
                }
                if (
                  surface === "new-chat" &&
                  suggestionMenu === undefined &&
                  event.key === "Tab" &&
                  event.shiftKey
                ) {
                  event.preventDefault();
                  selectQuickSuggestion(PLAN_SUGGESTION);
                  return;
                }
                if (
                  event.key === "Enter" &&
                  suggestionMenu === undefined &&
                  !event.shiftKey &&
                  !event.isComposing
                ) {
                  event.preventDefault();
                  void submit();
                }
                if (
                  event.key === "Escape" &&
                  suggestionMenu === undefined &&
                  busy &&
                  value.trim() === "" &&
                  attachments.length === 0 &&
                  chips.length === 0 &&
                  !disabled &&
                  onAbort !== undefined
                ) {
                  event.preventDefault();
                  onAbort();
                }
              }}
            />
          </div>
          <Popover.Root
            open={suggestionMenu !== undefined}
            modal={false}
            onOpenChange={(open, details) => {
              if (open) return;
              // The textarea drives this popup. A press or focus move inside
              // the frame is editing, not dismissal; `onSelect` decides then.
              const target = details.event.target;
              if (
                (details.reason === "outside-press" || details.reason === "focus-out") &&
                target instanceof Node &&
                frameRef.current?.contains(target) === true
              ) {
                details.cancel();
                return;
              }
              showSuggestions(undefined);
            }}
          >
            <Popover.Portal>
              <Popover.Positioner
                positionMethod="fixed"
                anchor={frameRef}
                side={surface === "new-chat" ? "bottom" : "top"}
                align="start"
                sideOffset={8}
                collisionPadding={8}
                collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
                {...stylex.props(composerStyles.suggestionPositioner)}
              >
                <Popover.Popup
                  id={suggestionPopupId}
                  role="listbox"
                  initialFocus={false}
                  finalFocus={false}
                  aria-busy={
                    suggestionMenu?.kind === "mention"
                      ? mentionFiles.status === "loading"
                      : suggestionCatalog.status === "loading"
                  }
                  aria-label={
                    suggestionMenu?.kind === "mention"
                      ? "Mention files and context"
                      : "Commands, skills, and prompts"
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  {...stylex.props(floatingSurfaceStyles.popup, composerStyles.suggestionMenu)}
                >
                  <div ref={suggestionListRef} {...stylex.props(composerStyles.suggestionList)}>
                    {suggestions.length === 0 ? (
                      <div role="status" {...stylex.props(composerStyles.suggestionEmpty)}>
                        {suggestionMenu === undefined
                          ? undefined
                          : suggestionEmptyText(
                              suggestionMenu.kind,
                              suggestionMenu.kind === "mention" ? mentionFiles : suggestionCatalog,
                            )}
                      </div>
                    ) : (
                      suggestions.map((suggestion, index) => {
                        const previous = suggestions[index - 1];
                        const optionId = `${suggestionPopupId}-${String(index)}`;
                        const selected = activeSuggestionIndex === index;
                        const query = deferredSuggestionQuery;
                        const description = descriptionExcerpt(suggestion.description, query);
                        return (
                          <Fragment key={suggestion.id}>
                            {previous !== undefined &&
                              suggestionGroup(previous) !== suggestionGroup(suggestion) && (
                                <div
                                  role="separator"
                                  {...stylex.props(composerStyles.suggestionDivider)}
                                />
                              )}
                            <PreviewCard.Trigger
                              id={optionId}
                              handle={suggestionPreviewHandle}
                              payload={suggestion}
                              delay={0}
                              closeDelay={100}
                              render={
                                <div
                                  role="option"
                                  tabIndex={-1}
                                  aria-selected={selected}
                                  {...stylex.props(composerStyles.suggestionItem)}
                                  onPointerMove={() => {
                                    if (!selected) setSuggestionIndex(index);
                                  }}
                                  onPointerDown={(event) => event.preventDefault()}
                                  onClick={() => selectSuggestion(suggestion)}
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
                                        query={query}
                                      />
                                    </span>
                                    <span {...stylex.props(composerStyles.suggestionDescription)}>
                                      <HighlightedSuggestionText text={description} query={query} />
                                    </span>
                                  </span>
                                  {selected &&
                                    (suggestion.kind === "command" ||
                                      suggestion.kind === "skill") && (
                                      <span {...stylex.props(composerStyles.suggestionShortcut)}>
                                        ⌥↵ to Use as Mode
                                      </span>
                                    )}
                                </div>
                              }
                            />
                          </Fragment>
                        );
                      })
                    )}
                  </div>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          <PreviewCard.Root handle={suggestionPreviewHandle}>
            {({ payload }) =>
              payload === undefined ? null : (
                <PreviewCard.Portal>
                  <PreviewCard.Positioner
                    positionMethod="fixed"
                    side="right"
                    align="end"
                    sideOffset={6}
                    collisionPadding={8}
                    collisionAvoidance={{
                      side: "flip",
                      align: "shift",
                      fallbackAxisSide: "none",
                    }}
                    {...stylex.props(composerStyles.suggestionPreviewPositioner)}
                  >
                    <PreviewCard.Popup
                      aria-label={`Details for ${payload.label}`}
                      {...stylex.props(
                        floatingSurfaceStyles.popup,
                        composerStyles.suggestionPreview,
                      )}
                    >
                      <SuggestionPreview suggestion={payload} />
                    </PreviewCard.Popup>
                  </PreviewCard.Positioner>
                </PreviewCard.Portal>
              )
            }
          </PreviewCard.Root>
          <div
            {...stylex.props(
              composerStyles.controls,
              compact && composerStyles.controlsCompact,
              followUpExpanded && composerStyles.controlsInset,
            )}
          >
            <Menu
              label="Add agents, context, tools"
              popupStyle={composerStyles.addMenu}
              trigger={
                <Button
                  unstyled
                  type="button"
                  aria-label="Add agents, context, tools"
                  title="Modes, skills, MCPs and more (/)"
                  disabled={disabled}
                  {...stylex.props(
                    composerStyles.addButton,
                    composerStyles.controlHitArea,
                    compact && composerStyles.addButtonCompact,
                    focus.ring,
                  )}
                >
                  <Icon name="plus" size={17} />
                </Button>
              }
            >
              <MenuItem icon="search" meta="/" onSelect={() => insertTrigger("/")}>
                Search skills and prompts…
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={PLAN_SUGGESTION.icon}
                onSelect={() => selectQuickSuggestion(PLAN_SUGGESTION)}
              >
                Plan
              </MenuItem>
              <MenuItem
                icon={DEBUG_SUGGESTION.icon}
                onSelect={() => selectQuickSuggestion(DEBUG_SUGGESTION)}
              >
                Debug
              </MenuItem>
              <MenuItem
                icon={MULTITASK_SUGGESTION.icon}
                onSelect={() => selectQuickSuggestion(MULTITASK_SUGGESTION)}
              >
                Multitask
              </MenuItem>
              <MenuItem
                icon={ASK_SUGGESTION.icon}
                onSelect={() => selectQuickSuggestion(ASK_SUGGESTION)}
              >
                Ask
              </MenuItem>
              <MenuSeparator />
              {canAttach && (
                <>
                  <MenuItem icon="paperclip" onSelect={() => fileInputRef.current?.click()}>
                    Files
                  </MenuItem>
                  <MenuSeparator />
                </>
              )}
              <MenuItem icon="more" meta="@" onSelect={() => insertTrigger("@")}>
                Mention context
              </MenuItem>
              <MenuItem icon="skills" meta="/" onSelect={() => insertTrigger("/")}>
                Use a skill or prompt
              </MenuItem>
            </Menu>
            <span
              {...stylex.props(
                composerStyles.modelSlot,
                compact && composerStyles.modelSlotCompact,
              )}
            >
              {model}
            </span>
            <span
              {...stylex.props(composerStyles.spacer, compact && composerStyles.spacerCompact)}
            />
            {busy &&
            value.trim() === "" &&
            attachments.length === 0 &&
            chips.length === 0 &&
            onAbort !== undefined ? (
              <Button
                unstyled
                type="button"
                aria-label="Stop"
                title="Stop (Esc)"
                disabled={disabled}
                onClick={onAbort}
                {...stylex.props(
                  composerStyles.send,
                  composerStyles.controlHitArea,
                  compact && composerStyles.sendCompact,
                  focus.ring,
                  composerStyles.stop,
                )}
              >
                <Icon name="square" size={12} />
              </Button>
            ) : (
              <Button
                unstyled
                type="submit"
                aria-label="Send"
                title="Send (Enter)"
                disabled={!canSubmit}
                {...stylex.props(
                  composerStyles.send,
                  composerStyles.controlHitArea,
                  compact && composerStyles.sendCompact,
                  focus.ring,
                )}
              >
                <Icon name="arrow-up" size={15} />
              </Button>
            )}
          </div>
        </div>
      </form>
      {surface === "new-chat" && (
        <div aria-label="Prompt modes" {...stylex.props(composerStyles.quickActions)}>
          <Button
            unstyled
            type="button"
            disabled={disabled}
            {...stylex.props(composerStyles.quickAction, focus.ring)}
            onClick={() => selectQuickSuggestion(PLAN_SUGGESTION)}
          >
            Plan New Idea
            <span aria-hidden="true" {...stylex.props(composerStyles.quickActionMeta)}>
              ⇧Tab
            </span>
          </Button>
          <Button
            unstyled
            type="button"
            disabled={disabled}
            {...stylex.props(composerStyles.quickAction, focus.ring)}
            onClick={() => selectQuickSuggestion(MULTITASK_SUGGESTION)}
          >
            Multitask
          </Button>
        </div>
      )}
    </>
  );
}

function pendingText(content: PendingItem["content"]): string {
  if (!Array.isArray(content)) return content;
  const text = content.map((part) => (part.type === "text" ? part.text : "")).join("");
  if (text !== "") return text;
  const imageCount = content.filter((part) => part.type === "image").length;
  return imageCount === 1 ? "1 image" : `${String(imageCount)} images`;
}

function unsentStateText(state: OutboxRowState): string {
  switch (state.kind) {
    case "saving":
      return "Saving…";
    case "sending":
      return "Sending…";
    case "failed":
      return `Couldn't send: ${state.reason}. Retrying…`;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

type CommandFeedback =
  | { readonly kind: "status"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export function Composer({
  sessionId,
  working,
  pending,
  unsent,
  disabled = false,
  viewState,
  onViewStateChange,
  inputRef,
  autoFocus = true,
}: {
  sessionId: SessionId;
  working: boolean;
  /** Durable queue items waiting behind a live run. */
  pending: readonly PendingItem[];
  /** Outbox rows the strip shows; rows landing as the next turn belong to the transcript. */
  unsent: readonly OutboxRow[];
  disabled?: boolean;
  viewState?: ComposerViewState;
  onViewStateChange?: (update: (current: ComposerViewState) => ComposerViewState) => void;
  inputRef?: (element: HTMLDivElement | null) => void;
  autoFocus?: boolean;
}): ReactElement {
  const [localViewState, setLocalViewState] = useState<ComposerViewState>({
    draft: "",
    selectionStart: 0,
    selectionEnd: 0,
    focused: false,
  });
  const [attachments, setAttachments] = useState<readonly ComposerImageAttachment[]>([]);
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [commandFeedback, setCommandFeedback] = useState<CommandFeedback>();
  const pluginCatalog = usePluginCatalog();
  const suggestionCatalog = composerSource(pluginCatalog.data, pluginCatalog.isError);
  // A thread always has an open project behind it.
  const workspaceFiles = useMentionFiles(true);
  const mentionFiles = composerSource(workspaceFiles.data, workspaceFiles.isError);
  const currentViewState = viewState ?? localViewState;

  const updateViewState = (update: (current: ComposerViewState) => ComposerViewState): void => {
    if (viewState === undefined) setLocalViewState(update);
    onViewStateChange?.(update);
  };

  const addFiles = async (files: readonly File[]): Promise<void> => {
    setAttachmentReads((count) => count + 1);
    try {
      const result = await readComposerImageAttachments(files);
      if (result.attachments.length > 0) {
        setAttachments((current) => [...current, ...result.attachments]);
      }
      setAttachmentError(result.error);
    } finally {
      setAttachmentReads((count) => count - 1);
    }
  };

  const send = async (chips: readonly ComposerChip[]): Promise<boolean> => {
    const text = currentViewState.draft.trim();
    const sentAttachments = attachments;
    const prompt = composerPromptText(text, chips);
    if (disabled || attachmentReads !== 0 || (prompt === "" && sentAttachments.length === 0)) {
      return false;
    }
    const command =
      chips.every((chip) => chip.kind === "file") && sentAttachments.length === 0
        ? parsePluginCommand(text, pluginCatalog.data?.commands ?? [])
        : undefined;
    if (command !== undefined) {
      try {
        const outcome = await nyte.plugins.commands.run({ sessionId, ...command });
        switch (outcome.kind) {
          case "ran":
            updateViewState((current) => ({
              ...current,
              draft: "",
              selectionStart: 0,
              selectionEnd: 0,
            }));
            setCommandFeedback(
              outcome.output === undefined
                ? undefined
                : { kind: "status", message: outcome.output },
            );
            refreshThread(sessionId);
            void queryClient.invalidateQueries({
              queryKey: keys.pluginSettings(sessionId),
              exact: true,
            });
            return true;
          case "prompt":
            await outbox.submitDurably({ sessionId, content: outcome.prompt });
            updateViewState((current) => ({
              ...current,
              draft: "",
              selectionStart: 0,
              selectionEnd: 0,
            }));
            setCommandFeedback(undefined);
            return true;
          case "not_found":
            break;
          case "failed":
            setCommandFeedback({ kind: "error", message: outcome.message });
            return false;
          default: {
            const _exhaustive: never = outcome;
            return _exhaustive;
          }
        }
      } catch (cause: unknown) {
        setCommandFeedback({
          kind: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
        return false;
      }
    }
    const content = composerMessageContent(text, sentAttachments, chips);
    try {
      await outbox.submitDurably({ sessionId, content });
      updateViewState((current) => ({ ...current, draft: "", selectionStart: 0, selectionEnd: 0 }));
      setAttachments([]);
      setAttachmentError(undefined);
      setCommandFeedback(undefined);
      return true;
    } catch (cause: unknown) {
      setCommandFeedback({
        kind: "error",
        message:
          cause instanceof Error
            ? `Couldn't save the message: ${cause.message}`
            : "Couldn't save the message.",
      });
      return false;
    }
  };

  const abort = (): void => {
    if (disabled) return;
    void nyte.runs.abort({ sessionId });
  };

  return (
    <div role="region" aria-label="Conversation input" {...stylex.props(composerStyles.region)}>
      {pending.map((item) => (
        <div role="status" key={item.change} {...stylex.props(composerStyles.queued)}>
          <Icon name="clock" size={12} />
          <span {...stylex.props(composerStyles.queuedText)}>{pendingText(item.content)}</span>
          {item.lane !== STEER_LANE && (
            <Button
              unstyled
              type="button"
              {...stylex.props(composerStyles.queuedAction, focus.ring)}
              onClick={() =>
                void nyte.messages.redeliver({
                  sessionId,
                  change: item.change,
                  lane: STEER_LANE,
                })
              }
            >
              Send now
            </Button>
          )}
          <IconButton
            icon="x"
            label="Cancel queued message"
            size={12}
            onClick={() => void nyte.messages.cancel({ sessionId, change: item.change })}
          />
        </div>
      ))}
      {unsent.map((row) => (
        <div role="status" key={row.key} {...stylex.props(composerStyles.queued)}>
          <Icon name="clock" size={12} />
          <span {...stylex.props(composerStyles.queuedText)}>{pendingText(row.content)}</span>
          <span {...stylex.props(composerStyles.queuedState)}>{unsentStateText(row.state)}</span>
          <IconButton
            icon="x"
            label="Cancel unsent message"
            size={12}
            onClick={() => outbox.cancel(row.key)}
          />
        </div>
      ))}
      {commandFeedback !== undefined && (
        <div
          role={commandFeedback.kind === "error" ? "alert" : "status"}
          {...stylex.props(composerStyles.queued)}
        >
          <Icon name={commandFeedback.kind === "error" ? "bubble-question" : "sparkle"} size={12} />
          <span {...stylex.props(composerStyles.queuedText)}>{commandFeedback.message}</span>
        </div>
      )}

      <ComposerFrame
        surface="follow-up"
        value={currentViewState.draft}
        onChange={(draft) => {
          setCommandFeedback(undefined);
          updateViewState((current) => ({
            ...current,
            draft,
            selectionStart: Math.min(current.selectionStart, draft.length),
            selectionEnd: Math.min(current.selectionEnd, draft.length),
          }));
        }}
        onSubmit={send}
        placeholder={FOLLOW_UP_PLACEHOLDER}
        autoFocus={autoFocus}
        disabled={disabled}
        busy={working}
        onAbort={abort}
        suggestionCatalog={suggestionCatalog}
        mentionFiles={mentionFiles}
        hasConversationContext
        attachments={attachments}
        attachmentBusy={attachmentReads !== 0}
        attachmentError={attachmentError}
        onFilesSelected={(files) => void addFiles(files)}
        onAttachmentRemove={(id) => {
          setAttachments((current) => current.filter((attachment) => attachment.id !== id));
          setAttachmentError(undefined);
        }}
        model={disabled ? undefined : <SessionModelChip sessionId={sessionId} />}
        inputRef={inputRef}
        selectionStart={currentViewState.selectionStart}
        selectionEnd={currentViewState.selectionEnd}
        onSelectionChange={(selectionStart, selectionEnd) =>
          updateViewState((current) => ({ ...current, selectionStart, selectionEnd }))
        }
        onFocusChange={(focused) => updateViewState((current) => ({ ...current, focused }))}
      />
    </div>
  );
}
