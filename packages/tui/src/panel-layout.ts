import {
  bold,
  BoxRenderable,
  CliRenderEvents,
  fg,
  InputRenderable,
  RenderableEvents,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import type { CliTheme } from "./theme.ts";
import { wrappedRows } from "./width.ts";

export class PanelLayout {
  readonly container: BoxRenderable;
  readonly searchRow: BoxRenderable;
  readonly body: BoxRenderable;
  private readonly heading: TextRenderable;
  private title: string;
  private loadVersion = 0;
  private loadAfterFrame: (() => void) | undefined;

  private readonly renderer: CliRenderer;
  private readonly theme: CliTheme;
  private readonly nextId: (prefix?: string) => string;

  constructor(options: {
    readonly renderer: CliRenderer;
    readonly theme: CliTheme;
    readonly nextId: (prefix?: string) => string;
    readonly title: string;
  }) {
    this.renderer = options.renderer;
    this.theme = options.theme;
    this.nextId = options.nextId;
    this.title = options.title;
    this.container = new BoxRenderable(this.renderer, {
      id: this.nextId("panel"),
      height: "100%",
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      overflow: "hidden",
      flexDirection: "column",
      backgroundColor: this.theme.transparent,
      marginLeft: 1,
      marginRight: 1,
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
    });
    this.heading = new TextRenderable(this.renderer, {
      id: this.nextId("panel-title"),
      content: new StyledText([bold(fg(this.theme.accent)(options.title))]),
      wrapMode: "word",
      flexShrink: 0,
      selectable: false,
    });
    this.searchRow = new BoxRenderable(this.renderer, {
      id: this.nextId("panel-search"),
      height: 1,
      flexShrink: 0,
      flexDirection: "row",
      visible: false,
    });
    this.body = new BoxRenderable(this.renderer, {
      id: this.nextId("panel-body"),
      flexDirection: "column",
      flexGrow: 1,
      minHeight: 0,
    });
    this.container.add(this.heading);
    this.container.add(this.searchRow);
    this.container.add(this.body);
    this.container.once(RenderableEvents.DESTROYED, () => this.cancelLoad());
  }

  get rows(): number {
    return (
      2 +
      wrappedRows(
        this.title,
        this.container.width > 0 ? this.container.width - 3 : this.renderer.width - 5,
        this.renderer.widthMethod,
      ) +
      (this.searchRow.visible ? 1 : 0)
    );
  }

  cancelLoad(): void {
    this.loadVersion += 1;
    if (this.loadAfterFrame !== undefined) {
      this.renderer.off(CliRenderEvents.FRAME, this.loadAfterFrame);
      this.loadAfterFrame = undefined;
    }
  }

  load<T>(
    source: () => Promise<T>,
    apply: (value: T) => void,
    onError: (cause: unknown) => void,
  ): void {
    this.cancelLoad();
    const version = this.loadVersion;
    const current = (): boolean => !this.container.isDestroyed && this.loadVersion === version;
    const afterFrame = (): void => {
      if (this.container.parent === null || this.container.height === 0) return;
      this.renderer.off(CliRenderEvents.FRAME, afterFrame);
      this.loadAfterFrame = undefined;
      void Promise.resolve()
        .then(async () => {
          if (!current()) return;
          const value = await source();
          if (current()) apply(value);
        })
        .catch((cause: unknown) => {
          if (current()) onError(cause);
        });
    };
    this.loadAfterFrame = afterFrame;
    this.renderer.on(CliRenderEvents.FRAME, afterFrame);
    this.renderer.requestRender();
  }

  setTitle(title: string): void {
    this.title = title;
    this.heading.content = new StyledText([bold(fg(this.theme.accent)(title))]);
  }

  addSearch(placeholder: string): InputRenderable {
    const input = new InputRenderable(this.renderer, {
      id: this.nextId("panel-query"),
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 1,
      placeholder,
      placeholderColor: this.theme.muted,
      backgroundColor: this.theme.transparent,
      focusedBackgroundColor: this.theme.transparent,
      textColor: this.theme.foreground,
      focusedTextColor: this.theme.foreground,
      cursorColor: this.theme.accent,
      selectionBg: this.theme.selectionBackground,
      selectionFg: this.theme.selectionForeground,
    });
    this.searchRow.visible = true;
    this.searchRow.add(input);
    return input;
  }
}
