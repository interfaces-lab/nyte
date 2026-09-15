/**
 * Inline slash and file completion under the composer. It mounts in the
 * ephemeral slot, which is why it reports its rows.
 *
 * Based on https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/src/views/slash_dropdown.rs
 */
import { BoxRenderable, CliRenderEvents, TextRenderable } from "@opentui/core";
import type { CliRenderer, TextareaRenderable } from "@opentui/core";
import { commandBindings } from "@opentui/keymap/extras";
import { isComposerTextKey } from "./keymap.ts";
import { CHAT_KEYBINDS, COMPLETION_METHODS } from "./constants.ts";
import type { Shell } from "./app/ui.ts";
import { completionTrigger } from "@nyte-ai/core";
import { explicitMentionFile, fileMentionSuggestions } from "./composer.ts";
import type { FileMentionSuggestions, MentionFile } from "./composer.ts";
import {
  DirectoryListing,
  directoryCompletionQuery,
  directorySuggestions,
} from "./directory-completion.ts";
import type { DirectoryQuery } from "./directory-completion.ts";
import { MenuList } from "./menu-list.ts";
import type { MenuItem } from "./menu-list.ts";
import { acceptSlashCommand, slashCommandLabel, slashCompletion, SLASH_COMMANDS } from "./slash.ts";
import type { SlashCommand } from "./slash.ts";
import type { CliTheme } from "./theme.ts";
import { cellOffset } from "./width.ts";

type SlashInput = Pick<
  TextareaRenderable,
  "plainText" | "cursorOffset" | "clear" | "focus" | "setText" | "editBuffer"
>;

interface SlashAutocompleteOptions {
  readonly renderer: CliRenderer;
  readonly keymap: Shell["keymap"];
  readonly enabled: () => boolean;
  readonly input: SlashInput;
  /** The draft before a key resolves; defaults to the editor's own text. */
  readonly readText?: () => string;
  readonly widthMethod: CliRenderer["widthMethod"];
  readonly theme: CliTheme;
  readonly nextId: (prefix?: string) => string;
  readonly onCommand: (command: SlashCommand) => void;
  /** Register the picked file with the composer's parts and return its marker. */
  readonly onFile: (path: string) => string;
  /** The dropdown's row count as it opens, filters, and closes. Zero means hidden. */
  readonly onRows: (rows: number) => void;
}

type AutocompleteSuggestion =
  | { readonly kind: "command"; readonly command: SlashCommand; readonly leading: boolean }
  | { readonly kind: "file"; readonly file: MentionFile }
  | { readonly kind: "directory"; readonly path: string };

interface TokenSpan {
  readonly start: number;
  readonly end: number;
}

const MAX_ROWS = 10;
const CHROME_ROWS = 6;
const PANEL_CHROME_ROWS = 2;
const PADDING_LEFT = 2;
const PADDING_RIGHT = 1;

export class SlashAutocomplete {
  readonly container: BoxRenderable;
  private readonly unregister: () => void;

  private readonly renderer: CliRenderer;
  private readonly input: SlashInput;
  private readonly widthMethod: CliRenderer["widthMethod"];
  private readonly list: MenuList;
  private readonly empty: TextRenderable;
  private readonly onCommand: (command: SlashCommand) => void;
  private readonly onFile: (path: string) => string;
  private readonly onRows: (rows: number) => void;
  private commands: readonly SlashCommand[] = SLASH_COMMANDS;
  private completionRequest = 0;
  private readonly directoryListing = new DirectoryListing();
  private files: readonly MentionFile[] = [];
  private cwd = "";
  private suggestions: readonly AutocompleteSuggestion[] = [];
  private span: TokenSpan | undefined;
  private hasMatches = false;
  private value: string | undefined;
  private rawCursor: number | undefined;
  private dismissed = false;

  constructor(options: SlashAutocompleteOptions) {
    this.renderer = options.renderer;
    this.input = options.input;
    this.widthMethod = options.widthMethod;
    this.onCommand = options.onCommand;
    this.onFile = options.onFile;
    this.onRows = options.onRows;
    this.container = new BoxRenderable(options.renderer, {
      id: options.nextId("slash-menu"),
      visible: false,
      flexShrink: 0,
      flexDirection: "column",
      backgroundColor: options.theme.transparent,
      marginLeft: 1,
      marginRight: 1,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      paddingTop: 1,
      paddingBottom: 1,
    });
    this.list = new MenuList({
      renderer: options.renderer,
      theme: options.theme,
      nextId: options.nextId,
      background: options.theme.transparent,
      maxVisible: this.maxVisibleForHeight(options.renderer.height),
      onSelect: (_item, index) => this.run(this.suggestions[index], COMPLETION_METHODS.accept),
      onHighlight: () => this.onRows(this.rows),
    });
    this.empty = new TextRenderable(options.renderer, {
      id: options.nextId("slash-empty"),
      content: "no matching commands",
      fg: options.theme.dim,
      visible: false,
    });
    this.container.add(this.list.container);
    this.container.add(this.empty);
    const actions = [
      {
        name: "completion.accept",
        title: "accept",
        placement: "primary",
        run: () => this.run(this.suggestions[this.list.selectedIndex], COMPLETION_METHODS.accept),
      },
      {
        name: "completion.fill",
        title: "complete",
        placement: "primary",
        run: () => this.run(this.suggestions[this.list.selectedIndex], COMPLETION_METHODS.fill),
      },
      {
        name: "completion.close",
        title: "close",
        placement: "cancel",
        run: () => {
          this.hide();
          this.dismissed = true;
        },
      },
      {
        name: "completion.previous",
        title: "previous",
        placement: "primary",
        run: () => this.list.navigate("previous"),
      },
      {
        name: "completion.next",
        title: "next",
        placement: "secondary",
        run: () => this.list.navigate("next"),
      },
      {
        name: "completion.page.up",
        title: "page up",
        placement: "secondary",
        run: () => this.list.navigate("page-up"),
      },
      {
        name: "completion.page.down",
        title: "page down",
        placement: "secondary",
        run: () => this.list.navigate("page-down"),
      },
    ] as const;
    const readText = options.readText ?? (() => this.input.plainText);
    const refresh = options.keymap.intercept("key", ({ event }) => {
      if (!options.enabled()) return;
      const text = readText();
      // A clear and the next text key can precede the coalesced native content notification.
      if (this.dismissed && isComposerTextKey(event) && text === "") this.close();
      // Native content notifications can trail keys in the same input batch.
      // Synchronize before keymap resolution, including rebound navigation and acceptance.
      // An unchanged query supplied without a cursor still means end-of-text.
      if (text === this.value && this.rawCursor === undefined) return;
      this.update(text, this.commands, this.files, this.cwd, this.input.cursorOffset);
    });
    const unregister = options.keymap.registerLayer({
      priority: 5,
      enabled: () => options.enabled() && this.visible,
      commands: actions.map((action) => {
        const unavailable = () =>
          action.name === "completion.close" || this.hasMatches
            ? undefined
            : "No completion matches";
        return {
          name: action.name,
          namespace: "completion",
          title: action.title,
          hint: action.title,
          placement: action.placement,
          enabled: () => unavailable() === undefined,
          get unavailable() {
            return unavailable();
          },
          run: action.run,
        };
      }),
      bindings: commandBindings(
        Object.fromEntries(actions.map((action) => [action.name, CHAT_KEYBINDS[action.name]])),
      ),
    });
    this.unregister = () => {
      refresh();
      unregister();
    };
    this.renderer.on(CliRenderEvents.RESIZE, this.onResize);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  /** Whether the dropdown would take Enter or Tab. An open menu with nothing in it claims nothing. */
  get accepting(): boolean {
    return this.visible && this.hasMatches;
  }

  /** Based on OpenCode #46414: complete a prompt before admitting it to the queue. */
  completeQueueableCommand(): boolean {
    this.update(this.input.plainText, this.commands, this.files, this.cwd, this.input.cursorOffset);
    if (!this.queueable) return false;
    this.run(this.suggestions[this.list.selectedIndex], COMPLETION_METHODS.fill);
    return true;
  }

  get rows(): number {
    if (!this.container.visible) return 0;
    return (
      PANEL_CHROME_ROWS +
      Math.max(1, Math.min(this.suggestions.length, this.maxVisibleForHeight(this.renderer.height)))
    );
  }

  retheme(theme: CliTheme): void {
    this.container.backgroundColor = theme.transparent;
    this.list.retheme(theme, theme.transparent);
    this.empty.fg = theme.dim;
  }

  /**
   * `cursor` is a cell offset. Commands and files are immutable snapshots:
   * reuse their arrays until the namespace or file index changes.
   */
  update(
    value: string,
    commands: readonly SlashCommand[],
    files: readonly MentionFile[],
    cwd: string,
    cursor?: number,
  ): void {
    if (
      value === this.value &&
      cursor === this.rawCursor &&
      commands === this.commands &&
      files === this.files &&
      cwd === this.cwd
    ) {
      return;
    }
    const request = ++this.completionRequest;
    this.commands = commands;
    this.value = value;
    this.rawCursor = cursor;
    this.files = files;
    this.cwd = cwd;

    // Most drafts cannot complete. Avoid allocating a native prefix just to rule them out.
    if (!value.includes("/") && !value.includes("@")) {
      this.hide();
      return;
    }
    const index =
      cursor === undefined ? value.length : this.input.editBuffer.getTextRange(0, cursor).length;
    const directory = directoryCompletionQuery(value, index);
    if (this.dismissed) {
      if (directory === undefined && completionTrigger(value, index) === undefined) this.hide();
      return;
    }
    if (directory !== undefined) {
      this.span = directory;
      this.suggestions = [];
      this.renderSuggestions("loading directories…");
      void this.loadDirectories(directory, cwd, request);
      return;
    }

    this.directoryListing.clear();
    const slash = slashCompletion(value, commands, index);
    if (slash !== undefined) {
      // Mid-prompt, an empty menu is just a path or a fraction being typed.
      if (!slash.leading && slash.commands.length === 0) {
        this.hide();
        return;
      }
      this.span = { start: slash.start, end: slash.end };
      this.suggestions = slash.commands.map((command) => ({
        kind: "command",
        command,
        leading: slash.leading,
      }));
      this.renderSuggestions("no matching commands");
      return;
    }

    const mention = fileMentionSuggestions(value, files, index);
    if (mention === undefined) {
      this.hide();
      return;
    }
    this.span = { start: mention.query.start, end: mention.query.end };
    this.suggestions = mention.files.map((file) => ({ kind: "file", file }));
    this.renderSuggestions("no matching files or folders");
    void this.loadExplicitMention(mention, cwd, request);
  }

  private async loadExplicitMention(
    mention: FileMentionSuggestions,
    cwd: string,
    request: number,
  ): Promise<void> {
    if (request !== this.completionRequest) return;
    const file = await explicitMentionFile(mention.query.query, cwd);
    if (request !== this.completionRequest || file === undefined) return;
    if (mention.files.some((match) => match.path === file.path)) return;
    this.suggestions = [file, ...mention.files].map((match) => ({ kind: "file", file: match }));
    this.renderSuggestions("no matching files or folders");
  }

  private async loadDirectories(
    query: DirectoryQuery,
    cwd: string,
    request: number,
  ): Promise<void> {
    if (request !== this.completionRequest) return;
    const paths = await directorySuggestions({ path: query.path, cwd }, this.directoryListing);
    if (request !== this.completionRequest) return;
    this.suggestions = paths.map((path) => ({ kind: "directory", path }));
    this.renderSuggestions("no matching directories");
  }

  get queueable(): boolean {
    const selected = this.suggestions[this.list.selectedIndex];
    return this.accepting && selected?.kind === "command" && selected.command.kind === "prompt";
  }

  private renderSuggestions(emptyContent: string): void {
    this.hasMatches = this.suggestions.length > 0;
    this.list.setItems(
      this.suggestions.map((suggestion, index) => this.menuItem(suggestion, index)),
    );
    this.empty.content = emptyContent;
    this.list.container.visible = this.hasMatches;
    this.empty.visible = !this.hasMatches;
    this.container.visible = true;
    this.onRows(this.rows);
  }

  private menuItem(suggestion: AutocompleteSuggestion, index: number): MenuItem {
    switch (suggestion.kind) {
      case "command":
        return {
          id: `command:${String(index)}`,
          label: slashCommandLabel(suggestion.command),
          description: suggestion.command.description,
        };
      case "directory":
        return { id: `directory:${String(index)}`, label: suggestion.path };
      case "file":
        return {
          id: `file:${String(index)}`,
          label: suggestion.file.label,
          description: suggestion.file.displayPath,
        };
      default: {
        const _exhaustive: never = suggestion;
        return _exhaustive;
      }
    }
  }

  private run(
    suggestion: AutocompleteSuggestion | undefined,
    via: (typeof COMPLETION_METHODS)[keyof typeof COMPLETION_METHODS],
  ): void {
    const span = this.span;
    if (suggestion === undefined || span === undefined) return;
    if (suggestion.kind === "file") {
      this.splice(span, `${this.onFile(suggestion.file.path)} `);
      return;
    }
    if (suggestion.kind === "directory") {
      this.splice(span, suggestion.path);
      if (via === COMPLETION_METHODS.fill) this.browseDirectories();
      return;
    }
    if (suggestion.command.name === "cd") {
      this.splice(span, "/cd ");
      this.browseDirectories();
      return;
    }
    const acceptance = acceptSlashCommand(
      suggestion.command,
      via,
      suggestion.leading ? this.input.plainText.slice(span.end).trim() : "",
    );
    if (acceptance.action === "complete") {
      this.splice(span, acceptance.token);
      return;
    }
    if (!suggestion.leading) {
      this.removeInlineToken(span);
      this.onCommand(suggestion.command);
      return;
    }
    this.close();
    this.value = "";
    this.rawCursor = 0;
    this.input.clear();
    this.onCommand(suggestion.command);
  }

  private browseDirectories(): void {
    this.value = undefined;
    this.update(this.input.plainText, this.commands, this.files, this.cwd, this.input.cursorOffset);
  }

  /** Remove an inline action and one redundant horizontal separator. */
  private removeInlineToken(span: TokenSpan): void {
    const value = this.input.plainText;
    if (/^[ \t]$/.test(value[span.end] ?? "")) {
      this.splice({ start: span.start, end: span.end + 1 }, "");
      return;
    }
    if (/^[ \t]$/.test(value[span.start - 1] ?? "")) {
      this.splice({ start: span.start - 1, end: span.end }, "");
      return;
    }
    this.splice(span, "");
  }

  /** Replace the completed token, keeping whatever the draft holds around it. */
  private splice(span: TokenSpan, insert: string): void {
    const value = this.input.plainText;
    const tail = value.slice(span.end);
    const text = insert.endsWith(" ") && /^\s/.test(tail) ? insert.slice(0, -1) : insert;
    const next = `${value.slice(0, span.start)}${text}${tail}`;
    const cursor = cellOffset(
      next,
      span.start + text.length,
      this.widthMethod,
      this.input.editBuffer.getTabWidth(),
    );
    this.close();
    this.value = next;
    this.rawCursor = cursor;
    this.input.setText(next);
    this.input.cursorOffset = cursor;
    this.input.focus();
  }

  /** A help panel can borrow focus without changing the completion it describes. */
  preserveSelection(): () => void {
    const value = this.input.plainText;
    const cursor = this.input.cursorOffset;
    const commands = this.commands;
    const selected = this.list.selectedIndex;
    return () => {
      if (this.container.isDestroyed) return;
      this.update(
        this.input.plainText,
        this.commands,
        this.files,
        this.cwd,
        this.input.cursorOffset,
      );
      if (
        this.visible &&
        this.input.plainText === value &&
        this.input.cursorOffset === cursor &&
        this.commands === commands
      )
        this.list.selectedIndex = selected;
    };
  }

  close(): void {
    this.value = undefined;
    this.hide();
  }

  /** Hide a negative result without invalidating the query that produced it. */
  private hide(): void {
    this.completionRequest += 1;
    this.directoryListing.clear();
    this.span = undefined;
    this.dismissed = false;
    if (!this.container.visible) return;
    this.container.visible = false;
    this.onRows(0);
  }

  destroy(): void {
    this.unregister();
    this.completionRequest += 1;
    this.directoryListing.clear();
    this.renderer.off(CliRenderEvents.RESIZE, this.onResize);
    this.container.visible = false;
    this.onRows(0);
    this.container.destroyRecursively();
  }

  private maxVisibleForHeight(height: number): number {
    return Math.max(1, Math.min(MAX_ROWS, height - CHROME_ROWS));
  }

  private readonly onResize = (_width: number, height: number): void => {
    this.list.setMaxVisible(this.maxVisibleForHeight(height));
    this.onRows(this.rows);
  };
}
