import {
  clampThinkingLevel,
  getFastModeCostMultiplier,
  getSupportedThinkingLevels,
} from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/ai";
import type { ThinkingLevel } from "@nyte-ai/core";
import { fastModeSettingId } from "@nyte-ai/plugin/examples/fast-mode";
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
import type { EphemeralPanel } from "./ephemeral.ts";
import { GLYPHS } from "./constants.ts";
import type { CliTheme } from "./theme.ts";
import { padDisplay, truncateDisplay } from "./width.ts";

export interface ModelSelection {
  readonly model: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
  readonly fast: { readonly settingId: string; readonly enabled: boolean } | undefined;
}

interface ModelPickerOptions {
  readonly renderer: CliRenderer;
  readonly theme: CliTheme;
  readonly nextId: (prefix?: string) => string;
  readonly models: readonly Model<Api>[];
  readonly current: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
  readonly fastModes: ReadonlyMap<string, boolean>;
  readonly load: () => Promise<readonly Model<Api>[]>;
  readonly onSelect: (selection: ModelSelection) => void;
  readonly onCancel: () => void;
  readonly onRows: (rows: number) => void;
  readonly onHints: (hints: string) => void;
  readonly onError: (cause: unknown) => void;
}

type Field = "effort" | "fast";

function identity(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function effortLabel(level: ThinkingLevel): string {
  return level === "xhigh" ? "XHigh" : level[0].toUpperCase() + level.slice(1);
}

function price(rate: number): string {
  return `$${String(rate)} / 1M`;
}

function truncate(text: string, width: number): string {
  return truncateDisplay(text, width, width <= 1 ? "" : GLYPHS.ellipsis);
}

function arrows(text: string): string {
  return `← ${text} →`;
}

/** Model and request options are drafts until Enter accepts the highlighted row. */
export class ModelPicker implements EphemeralPanel {
  readonly container: BoxRenderable;
  readonly queryInput: InputRenderable;
  private readonly options: ModelPickerOptions;
  private readonly above: TextRenderable;
  private readonly below: TextRenderable;
  private readonly list: BoxRenderable;
  private readonly details: TextRenderable;
  private readonly count: TextRenderable;
  private readonly rowViews: TextRenderable[] = [];
  private readonly efforts = new Map<string, ThinkingLevel>();
  private readonly fastModes: Map<string, boolean>;
  private models: readonly Model<Api>[];
  private matches: readonly Model<Api>[];
  private selected = 0;
  private offset = 0;
  private field: Field = "effort";
  private catalogStatus: "loading" | "ready" | "failed" = "loading";
  private destroyed = false;

  constructor(options: ModelPickerOptions) {
    this.options = options;
    this.models = options.models;
    this.matches = options.models;
    this.fastModes = new Map(options.fastModes);
    this.selected = Math.max(
      0,
      this.matches.findIndex((model) => identity(model) === identity(options.current)),
    );
    const { renderer, theme, nextId } = options;
    this.container = new BoxRenderable(renderer, {
      id: nextId("model-picker"),
      flexDirection: "column",
      flexShrink: 0,
      marginLeft: 1,
      marginRight: 1,
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
    });
    const query = new BoxRenderable(renderer, {
      id: nextId("model-search"),
      flexDirection: "row",
      height: 1,
      flexShrink: 0,
    });
    query.add(
      new TextRenderable(renderer, {
        id: nextId("model-search-prefix"),
        content: "/ ",
        fg: theme.accent,
      }),
    );
    this.queryInput = new InputRenderable(renderer, {
      id: nextId("model-query"),
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 1,
      placeholder: "Type to search",
      placeholderColor: theme.muted,
      backgroundColor: theme.transparent,
      focusedBackgroundColor: theme.transparent,
      textColor: theme.foreground,
      focusedTextColor: theme.foreground,
      cursorColor: theme.accent,
      selectionBg: theme.selectionBackground,
      selectionFg: theme.selectionForeground,
    });
    query.add(this.queryInput);
    this.count = new TextRenderable(renderer, {
      id: nextId("model-count"),
      fg: theme.dim,
      flexShrink: 0,
    });
    query.add(this.count);
    this.above = new TextRenderable(renderer, {
      id: nextId("model-above"),
      height: 1,
      flexShrink: 0,
      fg: theme.dim,
    });
    this.below = new TextRenderable(renderer, {
      id: nextId("model-below"),
      height: 1,
      flexShrink: 0,
      fg: theme.dim,
    });
    this.list = new BoxRenderable(renderer, {
      id: nextId("model-rows"),
      flexDirection: "column",
      flexShrink: 0,
      onMouseScroll: (event) => {
        if (event.scroll?.direction !== "up" && event.scroll?.direction !== "down") return;
        event.preventDefault();
        event.stopPropagation();
        this.move(event.scroll.direction === "up" ? -1 : 1);
      },
    });
    this.details = new TextRenderable(renderer, {
      id: nextId("model-details"),
      wrapMode: "none",
      flexShrink: 0,
    });
    this.container.add(query);
    this.container.add(this.above);
    this.container.add(this.list);
    this.container.add(this.below);
    this.container.add(this.details);
    renderer.keyInput.on("keypress", this.onKeyPress);
    renderer.on(CliRenderEvents.RESIZE, this.repaint);
    this.queryInput.on(InputRenderableEvents.INPUT, this.filter);
    this.repaint();
    void options
      .load()
      .then((models) => {
        if (this.destroyed) return;
        this.catalogStatus = "ready";
        this.models = models;
        this.filter();
      })
      .catch((cause: unknown) => {
        if (this.destroyed) return;
        this.catalogStatus = "failed";
        options.onError(cause);
      })
      .finally(() => {
        if (this.destroyed) return;
        this.repaint();
      });
  }

  private get selectedModel(): Model<Api> | undefined {
    return this.matches[this.selected];
  }

  private get detailRows(): number {
    return this.options.renderer.height >= 19 ? 6 : 1;
  }

  private get visibleCount(): number {
    return Math.max(
      1,
      Math.min(10, this.options.renderer.height - 10 - this.detailRows, this.matches.length),
    );
  }

  get rows(): number {
    return 5 + this.visibleCount + this.detailRows;
  }

  private fields(model: Model<Api>): readonly Field[] {
    const fields: Field[] = [];
    if (getSupportedThinkingLevels(model).length > 1) fields.push("effort");
    if (this.fastSetting(model) !== undefined) fields.push("fast");
    return fields;
  }

  private activeField(model: Model<Api>): Field | undefined {
    const fields = this.fields(model);
    return fields.includes(this.field) ? this.field : fields[0];
  }

  get hints(): string {
    const model = this.selectedModel;
    const fields = model === undefined ? [] : this.fields(model);
    const active = model === undefined ? undefined : this.activeField(model);
    if (this.options.renderer.width < 80) {
      return [
        "↑↓",
        ...(active === undefined ? [] : [`←→ ${active === "effort" ? "effort" : "fast"}`]),
        ...(fields.length > 1 ? ["tab"] : []),
        "↵ confirm",
        "esc",
      ].join(" · ");
    }
    return [
      "↑↓ select",
      ...(fields.length > 1
        ? [`tab ${active === "effort" ? "fast mode" : "reasoning effort"}`]
        : []),
      ...(active === undefined
        ? []
        : [`←→ ${active === "effort" ? "reasoning effort" : "fast mode"}`]),
      "enter confirm",
      "esc cancel",
    ].join(" · ");
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
    this.options.renderer.keyInput.off("keypress", this.onKeyPress);
    this.options.renderer.off(CliRenderEvents.RESIZE, this.repaint);
    this.queryInput.off(InputRenderableEvents.INPUT, this.filter);
    this.container.parent?.remove(this.container);
    this.container.destroyRecursively();
  }

  private effort(model: Model<Api>): ThinkingLevel {
    return clampThinkingLevel(
      model,
      this.efforts.get(identity(model)) ?? this.options.thinkingLevel,
    );
  }

  private fastSetting(model: Model<Api>): string | undefined {
    const settingId = fastModeSettingId(model.provider);
    return model.modes?.includes("fast") === true && this.fastModes.has(settingId)
      ? settingId
      : undefined;
  }

  private fastEnabled(model: Model<Api>): boolean {
    const settingId = this.fastSetting(model);
    return settingId !== undefined && this.fastModes.get(settingId) === true;
  }

  private readonly filter = (): void => {
    const previous = this.selectedModel ?? this.options.current;
    const terms = this.queryInput.value.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
    this.matches = this.models.filter((model) => {
      const text = `${model.name} ${identity(model)}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
    this.selected = Math.max(
      0,
      this.matches.findIndex((model) => identity(model) === identity(previous)),
    );
    this.offset = 0;
    this.repaint();
  };

  private move(delta: number): void {
    const count = this.matches.length;
    if (count === 0) return;
    this.selected = (this.selected + delta + count) % count;
    this.repaint();
  }

  private change(delta: -1 | 1): void {
    const model = this.selectedModel;
    if (model === undefined) return;
    if (this.activeField(model) === "fast") {
      const settingId = this.fastSetting(model);
      if (settingId !== undefined) this.fastModes.set(settingId, delta === 1);
    } else {
      const levels = getSupportedThinkingLevels(model);
      const next =
        levels[
          Math.max(0, Math.min(levels.length - 1, levels.indexOf(this.effort(model)) + delta))
        ];
      if (next !== undefined) this.efforts.set(identity(model), next);
    }
    this.repaint();
  }

  private confirm(): void {
    const model = this.selectedModel;
    if (model === undefined) return;
    const settingId = this.fastSetting(model);
    this.options.onSelect({
      model,
      thinkingLevel: this.effort(model),
      fast: settingId === undefined ? undefined : { settingId, enabled: this.fastEnabled(model) },
    });
  }

  private readonly onKeyPress = (key: KeyEvent): void => {
    if (this.destroyed || key.defaultPrevented) return;
    if (key.name === "escape") this.options.onCancel();
    else if (key.name === "return") this.confirm();
    else if (key.name === "up" || (key.ctrl && key.name === "p")) this.move(-1);
    else if (key.name === "down" || (key.ctrl && key.name === "n")) this.move(1);
    else if (key.name === "pageup") this.move(-Math.min(this.selected, this.visibleCount));
    else if (key.name === "pagedown")
      this.move(Math.min(this.matches.length - this.selected - 1, this.visibleCount));
    else if (key.name === "left" && !key.ctrl && !key.meta) this.change(-1);
    else if (key.name === "right" && !key.ctrl && !key.meta) this.change(1);
    else if (key.name === "tab") this.field = this.field === "effort" ? "fast" : "effort";
    else return;
    key.preventDefault();
    key.stopPropagation();
    if (!this.destroyed) this.repaint();
  };

  private row(model: Model<Api>, selected: boolean, width: number): StyledText {
    const { theme } = this.options;
    const color = selected ? theme.accent : theme.foreground;
    const field = selected ? this.activeField(model) : undefined;
    const level = this.effort(model);
    const wide = width >= 62;
    const labelWidth = Math.max(1, wide ? Math.min(34, width - 45) : width - 16);
    const label = padDisplay(truncate(model.name || model.id, labelWidth), labelWidth);
    const levels = getSupportedThinkingLevels(model);
    const bars = "■".repeat(level === "off" ? 0 : Math.max(0, levels.indexOf(level) + 1));
    const emptyBars = "□".repeat(Math.max(0, levels.length - bars.length));
    const effort = wide
      ? `${padDisplay(bars + emptyBars, 7)} ${padDisplay(effortLabel(level), 7)}`
      : effortLabel(level);
    const fast =
      this.fastSetting(model) === undefined
        ? ""
        : `Fast mode ${this.fastEnabled(model) ? "On" : "Off"}`;
    return new StyledText([
      fg(color)(
        selected
          ? `${GLYPHS.prompt} `
          : identity(model) === identity(this.options.current)
            ? "· "
            : "  ",
      ),
      selected ? bold(fg(color)(label)) : fg(color)(label),
      fg(field === "effort" ? theme.accent : theme.dim)(
        `  ${field === "effort" ? arrows(effort) : `  ${effort}  `}`,
      ),
      fg(field === "fast" ? theme.accent : theme.dim)(
        wide && fast !== "" ? `  ${field === "fast" ? arrows(fast) : `  ${fast}`}` : "",
      ),
    ]);
  }

  private detail(model: Model<Api>, width: number): StyledText {
    const { theme } = this.options;
    const level = effortLabel(this.effort(model));
    const fast =
      this.fastSetting(model) === undefined
        ? ""
        : ` · Fast mode ${this.fastEnabled(model) ? "On" : "Off"}`;
    const info = `${identity(model)} · ${level}${fast}`;
    if (this.detailRows === 1)
      return new StyledText([
        fg(theme.dim)(truncate(`${level}${fast} · ${model.provider}`, width)),
      ]);
    const meterWidth = Math.min(34, width);
    const multiplier = this.fastEnabled(model) ? getFastModeCostMultiplier(model) : 1;
    const totals = this.models.map(
      (candidate) =>
        (candidate.cost.input + candidate.cost.output) *
        (getFastModeCostMultiplier(candidate) ?? 1),
    );
    const ceiling = Math.max(0, ...totals);
    const position =
      ceiling === 0
        ? 0
        : Math.round(
            ((meterWidth - 1) * (model.cost.input + model.cost.output) * (multiplier ?? 1)) /
              ceiling,
          );
    const meter = Array.from({ length: meterWidth }, (_, index) =>
      fg(index < meterWidth / 2 ? theme.ok : theme.thinking)(index === position ? "●" : "─"),
    );
    const column = Math.max(1, Math.min(17, Math.floor(width / 3)));
    const cells = (values: readonly string[]): string =>
      values.map((value) => padDisplay(truncate(value, column), column)).join("");
    const caption =
      multiplier === undefined
        ? "Fast-mode pricing unavailable"
        : `${String(model.contextWindow / 1000)}k context · ${this.fastEnabled(model) ? "Fast rates" : "USD per million tokens"}`;
    const rates =
      multiplier === undefined
        ? ["Unavailable", "Unavailable", "Unavailable"]
        : [model.cost.input, model.cost.cacheRead, model.cost.output].map((rate) =>
            price(Number((rate * multiplier).toPrecision(10))),
          );
    return new StyledText([
      fg(theme.dim)(`${truncate(info, width)}\n`),
      ...meter,
      fg(theme.dim)(`\n${cells(["Input", "Cached input", "Output"])}\n`),
      fg(theme.foreground)(`${cells(rates)}\n`),
      fg(theme.dim)(truncate(caption, width)),
    ]);
  }

  private readonly repaint = (): void => {
    if (this.destroyed) return;
    const { renderer, theme, nextId } = this.options;
    const width = Math.max(1, renderer.width - 5);
    const count = this.visibleCount;
    this.offset = Math.max(0, Math.min(this.offset, this.selected, this.matches.length - count));
    if (this.selected >= this.offset + count) this.offset = this.selected - count + 1;
    this.count.content = ` ${String(this.matches.length)}/${String(this.models.length)}`;
    this.count.visible = width >= 40;
    this.above.content = this.offset > 0 ? "  ↑ more above" : "";
    this.below.content = this.offset + count < this.matches.length ? "  ↓ more below" : "";
    while (this.rowViews.length < count) {
      const index = this.rowViews.length;
      const view = new TextRenderable(renderer, {
        id: nextId("model-row"),
        width: "100%",
        height: 1,
        flexShrink: 0,
        wrapMode: "none",
        onMouseDown: (event) => {
          if (event.button !== 0 || this.matches[this.offset + index] === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          this.selected = this.offset + index;
          this.repaint();
          this.focus();
        },
      });
      this.rowViews.push(view);
      this.list.add(view);
    }
    for (const [index, view] of this.rowViews.entries()) {
      view.visible = index < count;
      if (!view.visible) continue;
      const model = this.matches[this.offset + index];
      const selected = this.offset + index === this.selected;
      view.bg = model !== undefined && selected ? theme.selectionBackground : theme.transparent;
      view.content =
        model === undefined
          ? new StyledText([
              fg(theme.dim)(
                this.catalogStatus === "loading"
                  ? "Loading models…"
                  : this.catalogStatus === "failed"
                    ? "Could not load models. Close and try /model again."
                    : this.models.length === 0
                      ? "No models available. Use /login to connect a provider."
                      : "No matching models",
              ),
            ])
          : this.row(model, selected, width);
    }
    this.list.height = count;
    this.details.height = this.detailRows;
    this.details.content =
      this.selectedModel === undefined ? "" : this.detail(this.selectedModel, width);
    this.options.onRows(this.rows);
    this.options.onHints(this.hints);
    renderer.requestRender();
  };
}
