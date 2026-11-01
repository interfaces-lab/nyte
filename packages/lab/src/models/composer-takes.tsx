/** Takes on the composer's model control. Each owns its own chat choice; none share state. */
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import type { Thinking } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Popover } from "@nyte-ai/ui/popover";
import { Toggle } from "@nyte-ai/ui/toggle";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { appearance, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { media, menu, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { ModelPicker } from "@nyte-ai/app/chat/composer/model-picker.tsx";
import { THINKING_LABELS } from "@nyte-ai/app/chat/composer/model-picker-state.ts";
import type { DesktopModelOption } from "@nyte-ai/app/data/catalog.ts";
import { catalog } from "./fixtures";
import {
  ChipFace,
  ComposerStage,
  FastRow,
  ModelGlyph,
  ModelSearch,
  ReasoningField,
  chipDescription,
  contextMeta,
  partStyles,
} from "./parts";
import { compactTokens, useChoice, type Choice } from "./state";

const styles = create({
  pageRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    alignItems: "center",
    columnGap: space.s1_5,
    width: "100%",
    minHeight: row.heightMd,
    margin: 0,
    paddingBlock: 0,
    paddingInline: menu.itemPaddingInline,
    borderStyle: "none",
    borderRadius: menu.itemRadius,
    backgroundColor: {
      default: "transparent",
      ":hover": { [media.hover]: role.bgHover },
      ":focus-visible": role.bgHover,
    },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
    color: role.contentPrimary,
    font: "inherit",
    textAlign: "start",
    cursor: "default",
  },
  pageValue: {
    minWidth: 0,
    maxWidth: 150,
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pageValueGlyph: { display: "inline-flex", alignItems: "center", gap: space.s1_5, minWidth: 0 },
  chevron: { display: "inline-flex", color: role.contentTertiary },
  back: { gridTemplateColumns: "auto minmax(0, 1fr)", color: role.contentSecondary },
  pages: { display: "flex", flexDirection: "column", minHeight: 0 },
  check: { display: "inline-flex", color: role.contentSecondary },

  wide: {
    display: "flex",
    width: "min(540px, var(--available-width))",
    height: `min(360px, var(--available-height))`,
    padding: 0,
    overflow: "clip",
  },
  wideGrid: {
    display: "grid",
    flex: 1,
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    minWidth: 0,
  },
  wideList: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    padding: menu.padding,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: role.borderSecondaryTranslucent,
  },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
    paddingBlock: space.s3,
    paddingInline: space.s3,
    overflowY: "auto",
  },
  detailHead: { display: "flex", flexDirection: "column", gap: space.s0_5 },
  detailName: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    color: role.contentPrimary,
    fontWeight: type.weightMedium,
  },
  facts: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: space.s3,
    rowGap: space.s1,
    margin: 0,
  },
  factTerm: { color: role.contentSecondary },
  factValue: { margin: 0, color: role.contentPrimary, fontVariantNumeric: "tabular-nums" },
  section: { display: "flex", flexDirection: "column", gap: space.s1 },
  radios: {
    display: "flex",
    flexDirection: "column",
    marginInline: `calc(${space.s1} * -1)`,
  },
});

/** What ships today, rendered from the app's own component. */
export function Today(): ReactElement {
  const choice = useChoice();

  return (
    <ComposerStage>
      <ModelPicker
        catalog={catalog}
        current={choice.current}
        thinkingLevel={choice.thinking}
        fast={choice.fast}
        onChange={(change) => {
          if (change.kind === "model") choice.pick(change.option);

          if (change.kind === "thinking") choice.setThinking(change.thinkingLevel);

          if (change.kind === "fast") choice.setFast(change.enabled);
        }}
      />
    </ComposerStage>
  );
}

/** An element, not a component: the popover's trigger merges its props and ref into it. */
function trigger(choice: Choice, detail = true): ReactElement {
  return (
    <Button size="sm" aria-description={chipDescription(choice)}>
      <ChipFace choice={choice} detail={detail} />
    </Button>
  );
}

/** One popover. Search is focused on open; reasoning and Fast sit under the list. */
export function Palette(): ReactElement {
  const choice = useChoice();
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  return (
    <ComposerStage>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger render={trigger(choice)} />
        <Popover.Portal>
          <Popover.Positioner side="top" align="start" sideOffset={6}>
            <Popover.Popup aria-label="Model" initialFocus={search} xstyle={partStyles.palette}>
              <ModelSearch
                catalog={catalog}
                current={choice.current}
                inputRef={search}
                onPick={(option) => {
                  choice.pick(option);
                  setOpen(false);
                }}
              />
              <Parameters choice={choice} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </ComposerStage>
  );
}

function Parameters({ choice }: { readonly choice: Choice }): ReactElement | null {
  if (!choice.reasons && !choice.fastAvailable) return null;

  return (
    <>
      <div {...props(partStyles.rule)} />
      <div {...props(partStyles.footer)}>
        {choice.reasons && (
          <ReasoningField
            levels={choice.levels}
            value={choice.thinking}
            onChange={choice.setThinking}
          />
        )}
        {choice.fastAvailable && <FastRow checked={choice.fast} onChange={choice.setFast} />}
      </div>
    </>
  );
}

/** Three controls, one job each. The model opens a list; reasoning is a plain menu; Fast toggles. */
export function Chips(): ReactElement {
  const choice = useChoice();
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  return (
    <ComposerStage>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger render={trigger(choice, false)} />
        <Popover.Portal>
          <Popover.Positioner side="top" align="start" sideOffset={6}>
            <Popover.Popup aria-label="Model" initialFocus={search} xstyle={partStyles.palette}>
              <ModelSearch
                catalog={catalog}
                current={choice.current}
                inputRef={search}
                onPick={(option) => {
                  choice.pick(option);
                  setOpen(false);
                }}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {choice.reasons && (
        <Menu>
          <MenuTrigger
            render={
              <Button size="sm" aria-description={`Reasoning: ${THINKING_LABELS[choice.thinking]}`}>
                <span {...props(partStyles.quiet)}>
                  {choice.thinking === "off" ? "No reasoning" : THINKING_LABELS[choice.thinking]}
                </span>
                <span aria-hidden="true" {...props(styles.chevron)}>
                  <Icon name="chevron-down" size="2xs" />
                </span>
              </Button>
            }
          />
          <MenuContent side="top" align="start" sideOffset={6}>
            <MenuRadioGroup
              value={choice.thinking}
              onValueChange={(value) => {
                const level = choice.levels.find((candidate) => candidate === value);

                if (level !== undefined) choice.setThinking(level);
              }}
            >
              {choice.levels.map((level) => (
                <MenuRadioItem key={level} value={level} layout="plain">
                  {THINKING_LABELS[level]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      )}
      {choice.fastAvailable && (
        <Toggle
          iconOnly
          size="sm"
          icon="bolt"
          aria-label="Fast"
          pressed={choice.fast}
          onPressedChange={choice.setFast}
        />
      )}
    </ComposerStage>
  );
}

type Page =
  | { readonly kind: "root" }
  | { readonly kind: "reasoning" }
  | {
      readonly kind: "model";
      readonly search: string;
    };

/** Today's three rows, but each opens in place on click. Typing on the first page searches. */
export function Pages(): ReactElement {
  const choice = useChoice();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>({ kind: "root" });

  return (
    <ComposerStage>
      <Popover.Root
        open={open}
        onOpenChange={(next, details) => {
          if (!next && details.reason === "escape-key" && page.kind !== "root") {
            details.cancel();
            setPage({ kind: "root" });

            return;
          }

          setOpen(next);
        }}
        onOpenChangeComplete={(next) => {
          if (!next) setPage({ kind: "root" });
        }}
      >
        <Popover.Trigger render={trigger(choice)} />
        <Popover.Portal>
          <Popover.Positioner side="top" align="start" sideOffset={6}>
            <Popover.Popup
              aria-label="Model"
              xstyle={partStyles.palette}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (page.kind !== "root") return;

                if (event.key.length !== 1 || event.key === " ") return;

                if (event.metaKey || event.ctrlKey || event.altKey) return;
                event.preventDefault();
                setPage({ kind: "model", search: event.key });
              }}
            >
              <div {...props(styles.pages)}>
                {page.kind === "root" && (
                  <RootPage
                    choice={choice}
                    onModel={() => setPage({ kind: "model", search: "" })}
                    onReasoning={() => setPage({ kind: "reasoning" })}
                  />
                )}
                {page.kind === "reasoning" && (
                  <>
                    <BackRow label="Reasoning" onBack={() => setPage({ kind: "root" })} />
                    <div {...props(partStyles.rule)} />
                    <RadioRows
                      label="Reasoning"
                      focusChosen
                      levels={choice.levels}
                      value={choice.thinking}
                      onChange={(level) => {
                        choice.setThinking(level);
                        setPage({ kind: "root" });
                      }}
                    />
                  </>
                )}
                {page.kind === "model" && (
                  <>
                    <BackRow label="Model" onBack={() => setPage({ kind: "root" })} />
                    <div {...props(partStyles.rule)} />
                    <ModelPage
                      choice={choice}
                      search={page.search}
                      onPick={(option) => {
                        choice.pick(option);
                        setOpen(false);
                      }}
                    />
                  </>
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </ComposerStage>
  );
}

/** Opens with the typed letter in the field and the caret after it. */
function ModelPage({
  choice,
  search,
  onPick,
}: {
  readonly choice: Choice;
  readonly search: string;
  readonly onPick: (option: DesktopModelOption) => void;
}): ReactElement {
  const input = useRef<HTMLInputElement>(null);

  useMountEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(search.length, search.length);
  });

  return (
    <ModelSearch
      catalog={catalog}
      current={choice.current}
      initialSearch={search}
      inputRef={input}
      onPick={onPick}
    />
  );
}

function RootPage({
  choice,
  onModel,
  onReasoning,
}: {
  readonly choice: Choice;
  readonly onModel: () => void;
  readonly onReasoning: () => void;
}): ReactElement {
  return (
    <>
      <PageRow
        label="Model"
        value={
          <span {...props(styles.pageValueGlyph)}>
            <ModelGlyph option={choice.current} />
            {choice.current.name}
          </span>
        }
        onClick={onModel}
        autoFocus
      />
      {choice.reasons && (
        <PageRow label="Reasoning" value={THINKING_LABELS[choice.thinking]} onClick={onReasoning} />
      )}
      {choice.fastAvailable && <FastRow checked={choice.fast} onChange={choice.setFast} />}
    </>
  );
}

function PageRow({
  label,
  value,
  onClick,
  autoFocus = false,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly onClick: () => void;
  readonly autoFocus?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      {...props(text.base, styles.pageRow)}
    >
      <span>{label}</span>
      <span {...props(styles.pageValue)}>{value}</span>
      <span aria-hidden="true" {...props(styles.chevron)}>
        <Icon name="chevron-right" size="xs" />
      </span>
    </button>
  );
}

function BackRow({
  label,
  onBack,
}: {
  readonly label: string;
  readonly onBack: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={`Back from ${label}`}
      onClick={onBack}
      {...props(text.base, styles.pageRow, styles.back)}
    >
      <Icon name="arrow-left" size="xs" />
      <span>{label}</span>
    </button>
  );
}

/** A radio list drawn as menu rows: arrows move, Enter or a click picks. */
function RadioRows({
  label,
  levels,
  value,
  onChange,
  focusChosen = false,
}: {
  readonly label: string;
  readonly levels: readonly Thinking[];
  readonly value: Thinking;
  readonly onChange: (level: Thinking) => void;
  readonly focusChosen?: boolean;
}): ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      {...props(styles.radios)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const radios = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='radio']")];
        const at = radios.findIndex((radio) => radio === document.activeElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        radios[(at + step + radios.length) % radios.length]?.focus();
      }}
    >
      {levels.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={level === value}
          tabIndex={level === value ? 0 : -1}
          autoFocus={focusChosen && level === value}
          onClick={() => onChange(level)}
          {...props(text.base, styles.pageRow)}
        >
          <span>{THINKING_LABELS[level]}</span>
          <span />
          <span aria-hidden="true" {...props(styles.check)}>
            {level === value && <Icon name="checkmark" size="2xs" />}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A wide popover: the list on the left, everything about the chosen model on the right. */
export function SideBySide(): ReactElement {
  const choice = useChoice();
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const provider = catalog.providers.find((entry) => entry.id === choice.current.provider);
  const cost = choice.current.cost;

  return (
    <ComposerStage>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger render={trigger(choice)} />
        <Popover.Portal>
          <Popover.Positioner side="top" align="start" sideOffset={6}>
            <Popover.Popup aria-label="Model" initialFocus={search} xstyle={styles.wide}>
              <div {...props(styles.wideGrid)}>
                <div {...props(styles.wideList)}>
                  <ModelSearch
                    catalog={catalog}
                    current={choice.current}
                    inputRef={search}
                    meta={contextMeta}
                    onPick={choice.pick}
                  />
                </div>
                <div {...props(text.base, styles.detail)}>
                  <div {...props(styles.detailHead)}>
                    <span {...props(styles.detailName)}>
                      <ModelGlyph option={choice.current} />
                      {choice.current.name}
                    </span>
                    <span {...props(text.sm, partStyles.quiet)}>{provider?.name}</span>
                  </div>
                  <dl {...props(text.sm, styles.facts)}>
                    <dt {...props(styles.factTerm)}>Context</dt>
                    <dd {...props(styles.factValue)}>
                      {compactTokens(choice.current.contextWindow)} tokens
                    </dd>
                    <dt {...props(styles.factTerm)}>Input</dt>
                    <dd {...props(styles.factValue)}>
                      {choice.current.input.includes("image") ? "Text and images" : "Text"}
                    </dd>
                    {cost !== undefined && (
                      <>
                        <dt {...props(styles.factTerm)}>Price</dt>
                        <dd {...props(styles.factValue)}>
                          ${cost.input} in · ${cost.output} out per 1M
                        </dd>
                      </>
                    )}
                  </dl>
                  {choice.reasons && (
                    <div {...props(styles.section)}>
                      <span {...props(text.sm, partStyles.quiet)}>Reasoning</span>
                      <RadioRows
                        label="Reasoning"
                        levels={choice.levels}
                        value={choice.thinking}
                        onChange={choice.setThinking}
                      />
                    </div>
                  )}
                  {choice.fastAvailable && (
                    <FastRow checked={choice.fast} onChange={choice.setFast} />
                  )}
                </div>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </ComposerStage>
  );
}
