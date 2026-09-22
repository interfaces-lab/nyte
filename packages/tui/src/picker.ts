import { matchesKeyName } from "./keymap.ts";
import {
  bold,
  BoxRenderable,
  CliRenderEvents,
  fg,
  InputRenderable,
  InputRenderableEvents,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import type { CliRenderer, KeyEvent } from "@opentui/core";
import { CHAT_KEYBINDS, GLYPHS, keycap } from "./constants.ts";
import type { ChatCommand } from "./constants.ts";
import type { createChatKeymap } from "./keymap.ts";
import { commandBindings } from "@opentui/keymap/extras";
import { MenuList } from "./menu-list.ts";
import type { MenuItem } from "./menu-list.ts";
import type { CliTheme } from "./theme.ts";

export type Choice = MenuItem;

export class PickerCancelled extends Error {
  constructor() {
    super("Selection cancelled");
    this.name = "PickerCancelled";
  }
}

/** An extra key bound to the highlighted row. It acts on that row and closes the menu. */
export interface ChoiceAction {
  readonly command: ChatCommand;
  readonly label: string;
  readonly keepOpen?: boolean;
  readonly run: (id: string) => void | Promise<void>;
}

/**
 * One list the menu shows. Screens swap in place, and `load` lets a screen
 * paint cached choices before its slower source finishes.
 */
export interface MenuScreen {
  readonly title: string;
  readonly choices: readonly Choice[];
  readonly load?: () => Promise<readonly Choice[]>;
  readonly selectedId?: string;
  readonly maxVisible?: number;
  readonly actions?: readonly ChoiceAction[];
  /** Verb on the enter keycap. */
  readonly selectLabel?: string;
  /** Verb on the escape keycap; sub-screens go "back", top screens "close". */
  readonly cancelLabel?: string;
  /**
   * The text field takes an answer of its own instead of a filter: typing
   * leaves the rows alone, and Enter with text submits it in place of a row.
   */
  readonly typed?: {
    readonly placeholder: string;
    readonly onSubmit: (text: string) => void | Promise<void>;
  };
  readonly onSelect: (id: string) => void | Promise<void>;
  readonly onCancel: () => void;
  readonly onHighlight?: (id: string) => void;
}

interface InlineMenuOptions {
  readonly renderer: CliRenderer;
  readonly keymap: ReturnType<typeof createChatKeymap>;
  readonly theme: CliTheme;
  readonly nextId: (prefix?: string) => string;
  readonly onError: (cause: unknown) => void;
  /** The panel's row count, whenever filtering or a new screen changes it. */
  readonly onRows: (rows: number) => void;
}

function consume(key: KeyEvent): void {
  key.preventDefault();
  key.stopPropagation();
}

const FILTER_PLACEHOLDER = "type to filter";

function filterChoices(choices: readonly Choice[], value: string): readonly Choice[] {
  const query = value.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);

  if (query.length === 0) return choices;

  return choices.filter((choice) => {
    const searchable =
      `${choice.label} ${choice.description ?? ""} ${choice.status?.text ?? ""} ${choice.id}`.toLocaleLowerCase();

    return query.every((part) => searchable.includes(part));
  });
}

const MAX_ROWS = 10;

const CHROME_ROWS = 7;

/** The panel's own rows: padding above, the search row, padding below. */
const PANEL_CHROME_ROWS = 3;

const COUNT_MIN_WIDTH = 48;

const TITLE_MIN_WIDTH = 32;

const PADDING_LEFT = 2;

const PADDING_RIGHT = 1;

/**
 * Searchable choices under the composer. Settings, thinking levels, and
 * slash commands share this menu; model configuration has its own panel.
 *
 * Based on https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/src/views/slash_dropdown.rs
 */
export class InlineMenu {
  readonly container: BoxRenderable;
  readonly queryInput: InputRenderable;

  private readonly renderer: CliRenderer;
  private readonly theme: CliTheme;
  private readonly title: TextRenderable;
  private readonly list: MenuList;
  private readonly count: TextRenderable;
  private readonly empty: TextRenderable;
  private readonly onError: (cause: unknown) => void;
  private readonly onRows: (rows: number) => void;
  private screen: MenuScreen;
  private choices: readonly Choice[];
  private matches: readonly Choice[];
  private loading = false;
  private filtering = true;
  private busy = false;
  private destroyed = false;
  private readonly options: InlineMenuOptions;
  private unregisterActions: (() => void) | undefined;

  constructor(options: InlineMenuOptions, screen: MenuScreen) {
    this.options = options;
    this.renderer = options.renderer;
    this.theme = options.theme;
    this.onError = options.onError;
    this.onRows = options.onRows;
    this.screen = screen;
    this.choices = screen.choices;
    this.matches = screen.choices;
    const { theme, nextId } = options;

    this.container = new BoxRenderable(options.renderer, {
      id: nextId("menu-panel"),
      flexShrink: 0,
      flexDirection: "column",
      backgroundColor: theme.transparent,
      marginLeft: 1,
      marginRight: 1,
      paddingLeft: PADDING_LEFT,
      paddingRight: PADDING_RIGHT,
      paddingTop: 1,
      paddingBottom: 1,
    });

    const queryRow = new BoxRenderable(options.renderer, {
      id: nextId("menu-query-row"),
      height: 1,
      flexShrink: 0,
      flexDirection: "row",
    });

    this.title = new TextRenderable(options.renderer, {
      id: nextId("menu-title"),
      content: this.titleText(screen.title),
      wrapMode: "none",
      flexShrink: 0,
    });
    queryRow.add(this.title);
    this.queryInput = new InputRenderable(options.renderer, {
      id: nextId("menu-query"),
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 1,
      placeholder: screen.typed?.placeholder ?? FILTER_PLACEHOLDER,
      placeholderColor: theme.muted,
      backgroundColor: theme.transparent,
      focusedBackgroundColor: theme.transparent,
      textColor: theme.foreground,
      focusedTextColor: theme.foreground,
      cursorColor: theme.accent,
      selectionBg: theme.selectionBackground,
      selectionFg: theme.selectionForeground,
    });
    queryRow.add(this.queryInput);
    this.count = new TextRenderable(options.renderer, {
      id: nextId("menu-count"),
      content: this.countText(),
      fg: theme.dim,
      wrapMode: "none",
      flexShrink: 0,
    });
    queryRow.add(this.count);

    this.list = new MenuList({
      renderer: options.renderer,
      theme,
      nextId,
      background: theme.transparent,
      maxVisible: this.maxVisibleForHeight(options.renderer.height),
      items: this.matches,
      selectedIndex: this.indexOf(screen.selectedId),
      onSelect: (item) => this.activate(item.id),
      onHighlight: (item) => this.screen.onHighlight?.(item.id),
    });
    this.empty = new TextRenderable(options.renderer, {
      id: nextId("menu-empty"),
      content: "no matches",
      fg: theme.dim,
      visible: false,
    });

    this.container.add(queryRow);
    this.container.add(this.list.container);
    this.container.add(this.empty);

    options.renderer.keyInput.on("keypress", this.onKeyPress);
    options.renderer.on(CliRenderEvents.RESIZE, this.onResize);
    this.queryInput.on(InputRenderableEvents.INPUT, this.onInput);
    this.applyWidth(options.renderer.width);
    this.repaintStatus();
    this.startLoad();
    this.registerActions();
  }

  /** Rows the panel needs right now: declared, never measured. */
  get rows(): number {
    return (
      PANEL_CHROME_ROWS +
      Math.max(1, Math.min(this.matches.length, this.maxVisibleForHeight(this.renderer.height)))
    );
  }

  /** Keycap row for the shell's hint line while this menu owns the input. */
  get hints(): string {
    return [
      `${keycap("picker.accept")} ${this.screen.selectLabel ?? "select"}`,
      ...(this.screen.actions ?? []).map((action) => `${keycap(action.command)} ${action.label}`),
      `${keycap("picker.previous", "symbol")}${keycap("picker.next", "symbol")} move`,
      `${keycap("picker.close")} ${this.screen.cancelLabel ?? "close"}`,
    ].join(" · ");
  }

  show(screen: MenuScreen): void {
    if (this.destroyed) return;
    this.screen = screen;
    this.choices = screen.choices;
    this.title.content = this.titleText(screen.title);
    this.queryInput.placeholder = screen.typed?.placeholder ?? FILTER_PLACEHOLDER;
    this.setQuery("");
    this.matches = screen.choices;
    this.list.setMaxVisible(this.maxVisibleForHeight(this.renderer.height));
    this.list.setItems(this.matches, this.indexOf(screen.selectedId));
    this.repaintStatus();
    this.startLoad();
    this.registerActions();
  }

  /** Refresh a live list without throwing away its filter or highlighted item. */
  setChoices(choices: readonly Choice[], selectedId?: string): void {
    if (this.destroyed) return;
    const selected = selectedId ?? this.list.selectedItem?.id;
    this.choices = choices;
    this.matches = filterChoices(choices, this.queryInput.value);
    this.list.setItems(this.matches, this.indexOf(selected));
    this.repaintStatus();
  }

  focus(): void {
    this.queryInput.focus();
  }

  blur(): void {
    this.queryInput.blur();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unregisterActions?.();
    this.renderer.keyInput.off("keypress", this.onKeyPress);
    this.renderer.off(CliRenderEvents.RESIZE, this.onResize);
    this.queryInput.off(InputRenderableEvents.INPUT, this.onInput);
    this.container.parent?.remove(this.container);
    this.container.destroyRecursively();
  }

  /** Fills a screen from its slow source, dropping results the user moved past. */
  private startLoad(): void {
    const { screen } = this;

    if (screen.load === undefined) return;
    this.loading = true;
    this.repaintStatus();
    void screen
      .load()
      .then((choices) => {
        if (this.destroyed || this.screen !== screen) return;
        const highlighted = this.list.selectedItem?.id;
        this.choices = choices;
        this.matches = filterChoices(choices, this.queryInput.value);
        this.list.setItems(this.matches, this.indexOf(highlighted ?? screen.selectedId));
        this.onRows(this.rows);
      })
      .catch(this.onError)
      .finally(() => {
        if (this.destroyed || this.screen !== screen) return;
        this.loading = false;
        this.repaintStatus();
        this.renderer.requestRender();
      });
  }

  private registerActions(): void {
    this.unregisterActions?.();
    const actions = this.screen.actions ?? [];
    this.unregisterActions = this.options.keymap.registerLayer({
      priority: 2,
      enabled: () => !this.destroyed && this.container.visible && !this.busy,
      commands: actions.map((action) => ({
        name: action.command,
        title: action.label,
        run: () => {
          const selected = this.list.selectedItem;

          if (selected === undefined) return false;

          if (!action.keepOpen) this.screen.onCancel();
          this.run(() => action.run(selected.id));

          return true;
        },
      })),
      bindings: commandBindings(
        Object.fromEntries(
          actions.map((action) => [action.command, CHAT_KEYBINDS[action.command]]),
        ),
      ),
    });
  }

  private titleText(title: string): StyledText {
    return new StyledText([
      bold(fg(this.theme.accent)(title)),
      fg(this.theme.muted)(`  ${GLYPHS.separator} `),
    ]);
  }

  private countText(): string {
    const total = this.choices.length;

    return this.matches.length === total
      ? ` ${String(total)}`
      : ` ${String(this.matches.length)}/${String(total)}`;
  }

  private indexOf(id: string | undefined): number {
    return Math.max(
      0,
      this.matches.findIndex((choice) => choice.id === id),
    );
  }

  private setQuery(value: string): void {
    this.filtering = false;
    this.queryInput.value = value;
    this.filtering = true;
  }

  private repaintStatus(): void {
    this.count.content = this.countText();
    // A match count describes a filter; a typed answer has nothing to count.
    this.count.visible = this.screen.typed === undefined && this.renderer.width >= COUNT_MIN_WIDTH;
    this.empty.content = this.loading ? "loading" : "no matches";
    this.list.container.visible = this.matches.length > 0;
    this.empty.visible = this.matches.length === 0;
    this.onRows(this.rows);
  }

  private maxVisibleForHeight(height: number): number {
    const cap = Math.max(1, Math.floor(this.screen.maxVisible ?? MAX_ROWS));

    return Math.max(1, Math.min(cap, height - CHROME_ROWS));
  }

  private applyWidth(width: number): void {
    this.title.visible = width >= TITLE_MIN_WIDTH;
    this.count.visible = this.screen.typed === undefined && width >= COUNT_MIN_WIDTH;
  }

  private readonly onResize = (width: number, height: number): void => {
    this.applyWidth(width);
    this.list.setMaxVisible(this.maxVisibleForHeight(height));
    this.onRows(this.rows);
  };

  private readonly onInput = (value: string): void => {
    if (!this.filtering || this.screen.typed !== undefined) return;
    this.matches = filterChoices(this.choices, value);
    this.list.setItems(this.matches);
    const top = this.list.selectedItem;

    if (top !== undefined) this.screen.onHighlight?.(top.id);
    this.repaintStatus();
  };

  /**
   * Runs the selection in the dispatch that picked it, so the shell can close
   * the menu and refocus the composer before the next typed character lands.
   * Only an async handler holds the menu busy while it applies.
   */
  private activate(id: string): void {
    this.run(() => this.screen.onSelect(id));
  }

  private run(handler: () => void | Promise<void>): void {
    if (this.busy) return;

    try {
      const applied = handler();

      if (applied instanceof Promise) {
        this.busy = true;
        void applied.catch(this.onError).finally(() => {
          this.busy = false;
        });
      }
    } catch (cause) {
      this.onError(cause);
    }
  }

  private readonly onKeyPress = (key: KeyEvent): void => {
    if (this.destroyed || !this.container.visible || key.defaultPrevented) return;

    if (matchesKeyName("picker.close", key)) {
      consume(key);

      if (this.queryInput.value === "") this.screen.onCancel();
      else this.queryInput.value = "";

      return;
    }

    if (this.busy) {
      consume(key);

      return;
    }

    const { typed } = this.screen;
    const text = this.queryInput.value;

    if (matchesKeyName("picker.accept", key) && typed !== undefined && text.trim() !== "") {
      consume(key);
      this.run(() => typed.onSubmit(text));

      return;
    }

    if (this.matches.length === 0) return;

    if (matchesKeyName("picker.accept", key)) {
      consume(key);
      this.list.selectCurrent();

      return;
    }

    if (this.list.handleNavigationKey(key)) consume(key);
  };
}
