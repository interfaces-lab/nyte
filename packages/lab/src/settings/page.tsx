/**
 * A draft of the desktop Settings with a description on every row and the
 * settings the app already decides somewhere but never shows. Rows render with
 * the real settings patterns and controls; values live in local state only.
 *
 * Sources sit under each row so a reviewer can see what backs it before
 * agreeing to ship it. Data lives in `catalog.ts`.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { appearanceStyles as appearance } from "@nyte-ai/app/settings/appearance.stylex.ts";
import { settingsStyles as shell } from "@nyte-ai/app/settings/settings.stylex.ts";
import { settings as settingsSchema } from "@nyte-ai/app/theme/schema.stylex.ts";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@nyte-ai/ui/number-field";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Slider } from "@nyte-ai/ui/slider";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { Switch } from "@nyte-ai/ui/switch";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { SECTIONS, type Control, type Setting, type Status } from "./catalog";

const FILTERS = ["all", "shipped", "wire", "new"] as const;

type Filter = (typeof FILTERS)[number];

const STATUS_LABEL: Readonly<Record<Status, string>> = {
  shipped: "Shipped",
  wire: "Wire up",
  new: "New",
};

const STATUS_INTENT = {
  shipped: intent.success,
  wire: intent.primary,
  new: intent.warning,
} as const satisfies Readonly<Record<Status, (typeof intent)[keyof typeof intent]>>;

const ALL_SETTINGS = SECTIONS.flatMap((section) =>
  section.groups.flatMap((group) => group.settings),
);

function count(filter: Filter): number {
  return filter === "all"
    ? ALL_SETTINGS.length
    : ALL_SETTINGS.filter((setting) => setting.status === filter).length;
}

function visible(setting: Setting, filter: Filter): boolean {
  return filter === "all" || setting.status === filter;
}

function SliderControl({
  label,
  value,
  max,
  valueText,
  onValueChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly valueText: string;
  readonly onValueChange: (value: number) => void;
}): ReactElement {
  return (
    <Slider.Root
      max={max}
      value={value}
      xstyle={appearance.tintSlider}
      onValueChange={onValueChange}
    >
      <Slider.Control>
        <Slider.Track>
          <Slider.Thumb aria-label={label} aria-valuetext={valueText} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

function SettingControl({
  title,
  control,
}: {
  readonly title: string;
  readonly control: Control;
}): ReactElement {
  switch (control.kind) {
    case "switch":
      return <SwitchControl title={title} initial={control.value} />;
    case "select":
      return (
        <SelectControl
          title={title}
          options={control.options}
          initial={control.value}
          wide={control.wide}
        />
      );
    case "steps":
      return <StepsControl title={title} options={control.options} initial={control.value} />;
    case "number":
      return (
        <NumberField
          defaultValue={control.value}
          min={control.min}
          max={control.max}
          step={control.step}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement />
            <NumberFieldInput aria-label={title} />
            <NumberFieldIncrement />
          </NumberFieldGroup>
        </NumberField>
      );
    case "hue":
      return <HueControl title={title} initial={control.value} />;
    case "percent":
      return <PercentControl title={title} initial={control.value} />;
    case "action":
      return (
        <span {...props(styles.action)}>
          <span {...props(styles.actionValue)}>{control.value}</span>
          <Button variant="outline">{control.label}</Button>
        </span>
      );
    case "text":
      return <Input aria-label={title} placeholder={control.placeholder} xstyle={styles.text} />;
    default: {
      const _exhaustive: never = control;

      return _exhaustive;
    }
  }
}

function SwitchControl({
  title,
  initial,
}: {
  readonly title: string;
  readonly initial: boolean;
}): ReactElement {
  const [checked, setChecked] = useState(initial);

  return <Switch label={title} checked={checked} onCheckedChange={setChecked} />;
}

function SelectControl({
  title,
  options,
  initial,
  wide,
}: {
  readonly title: string;
  readonly options: readonly string[];
  readonly initial: string;
  readonly wide: boolean | undefined;
}): ReactElement {
  const [value, setValue] = useState(initial);
  const items = options.map((option) => ({ value: option, label: option }));

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) setValue(next);
      }}
    >
      <SelectTrigger aria-label={title} width={wide === true ? "wide" : undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} label={item.label}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StepsControl({
  title,
  options,
  initial,
}: {
  readonly title: string;
  readonly options: readonly [string, ...string[]];
  readonly initial: string;
}): ReactElement {
  const [index, setIndex] = useState(Math.max(0, options.indexOf(initial)));

  return (
    <span {...props(shell.steps)}>
      <Slider.Root
        max={options.length - 1}
        value={index}
        xstyle={shell.stepsSlider}
        onValueChange={setIndex}
      >
        <Slider.Control>
          <Slider.Track>
            <Slider.Thumb aria-label={title} aria-valuetext={options[index]} />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <span aria-hidden="true" {...props(shell.stepsLabels)}>
        <span>{options[0]}</span>
        <span>{options.at(-1)}</span>
      </span>
    </span>
  );
}

function HueControl({
  title,
  initial,
}: {
  readonly title: string;
  readonly initial: number;
}): ReactElement {
  const [hue, setHue] = useState(initial);

  return (
    <span {...props(appearance.tintControl)}>
      <SliderControl
        label={title}
        value={hue}
        max={360}
        valueText={`${String(hue)} degrees`}
        onValueChange={setHue}
      />
      <span aria-hidden="true" {...props(appearance.tintSlot)}>
        <span
          // The custom ramp reads the hue where its class is applied, so the swatch carries its own.
          ref={(node) => node?.style.setProperty("--nyte-custom-hue", String(hue))}
          {...props(surfaceTheme.custom, appearance.tintSwatch, appearance.tintSwatchActive)}
        />
      </span>
    </span>
  );
}

function PercentControl({
  title,
  initial,
}: {
  readonly title: string;
  readonly initial: number;
}): ReactElement {
  const [value, setValue] = useState(initial);

  return (
    <span {...props(appearance.tintControl)}>
      <SliderControl
        label={title}
        value={value}
        max={100}
        valueText={`${String(value)} percent`}
        onValueChange={setValue}
      />
      <span {...props(appearance.tintSlot, styles.percent)}>{value}%</span>
    </span>
  );
}

function Chip({ status }: { readonly status: Status }): ReactElement {
  return <span {...props(STATUS_INTENT[status], styles.chip)}>{STATUS_LABEL[status]}</span>;
}

function Sources({ setting }: { readonly setting: Setting }): ReactElement {
  const before =
    setting.status !== "shipped"
      ? undefined
      : setting.before === null
        ? "Had no description"
        : setting.before === setting.description
          ? "Copy unchanged"
          : `Was: ${setting.before}`;

  return (
    <div {...props(styles.sources)}>
      <div {...props(styles.sourceLine)}>
        <Chip status={setting.status} />
        {setting.platform !== undefined && (
          <span {...props(styles.platform)}>{setting.platform}</span>
        )}
        <code {...props(styles.source)}>{setting.source}</code>
      </div>
      {before !== undefined && <span {...props(styles.sourceText)}>{before}</span>}
      {setting.note !== undefined && <span {...props(styles.sourceText)}>{setting.note}</span>}
    </div>
  );
}

function SettingRow({
  setting,
  annotated,
}: {
  readonly setting: Setting;
  readonly annotated: boolean;
}): ReactElement {
  const wide = setting.control.kind === "select" && setting.control.wide === true;

  return (
    <div {...props(settingsPatterns.row, annotated && settingsPatterns.rowDetailed)}>
      <span {...props(settingsPatterns.rowCopy)}>
        <span {...props(settingsPatterns.rowTitle)}>{setting.title}</span>
        <span {...props(settingsPatterns.rowDescription)}>{setting.description}</span>
      </span>
      <span {...props(settingsPatterns.rowControl, wide && settingsPatterns.rowControlWide)}>
        <SettingControl title={setting.title} control={setting.control} />
      </span>
      {annotated && (
        <div {...props(settingsPatterns.rowDetail)}>
          <Sources setting={setting} />
        </div>
      )}
    </div>
  );
}

export function SettingsPage(): ReactElement {
  const [filter, setFilter] = useState<Filter>("all");
  const [annotated, setAnnotated] = useState(true);

  const sections = SECTIONS.map((section) => ({
    ...section,
    groups: section.groups
      .map((group) => ({
        ...group,
        settings: group.settings.filter((setting) => visible(setting, filter)),
      }))
      .filter((group) => group.settings.length > 0),
  })).filter((section) => section.groups.length > 0);

  return (
    <div {...props(styles.page)}>
      <nav aria-label="Settings sections" {...props(styles.rail)}>
        {sections.map((section) => (
          <Row key={section.id} variant="nav" render={<a href={`#${section.id}`} />}>
            <Row.Leading>
              <Icon name={section.icon} size={14} />
            </Row.Leading>
            <Row.Label>{section.title}</Row.Label>
            <Row.Meta>
              {section.groups.reduce((total, group) => total + group.settings.length, 0)}
            </Row.Meta>
          </Row>
        ))}
      </nav>

      <main {...props(styles.content)}>
        <div {...props(styles.contentInner)}>
          <header {...props(styles.header)}>
            <h1 {...props(settingsPatterns.pageTitle)}>Settings draft</h1>
            <p {...props(settingsPatterns.sectionDescription)}>
              Every row has a description and a source in code. Shipped rows exist today and only
              get copy. Wire up rows exist as a constant, menu toggle, file, or env var with no row.
              New rows need new behaviour. Profile, Providers sign-ins, and Usage don't change.
            </p>
            <div {...props(styles.toolbar)}>
              <ToggleGroup
                aria-label="Status"
                value={[filter]}
                onValueChange={(values) => {
                  const next = FILTERS.find((candidate) => candidate === values[0]);

                  if (next !== undefined) setFilter(next);
                }}
              >
                {FILTERS.map((candidate) => (
                  <Toggle key={candidate} value={candidate}>
                    {candidate === "all" ? "All" : STATUS_LABEL[candidate]} {count(candidate)}
                  </Toggle>
                ))}
              </ToggleGroup>
              <label {...props(styles.sourcesToggle)}>
                <Switch label="Show sources" checked={annotated} onCheckedChange={setAnnotated} />
                Show sources
              </label>
            </div>
          </header>

          {sections.map((section) => (
            <section key={section.id} id={section.id} {...props(styles.section)}>
              <div {...props(styles.sectionTitleRow)}>
                <h2 {...props(settingsPatterns.pageTitle)}>{section.title}</h2>
                {section.note !== undefined && annotated && (
                  <p {...props(settingsPatterns.sectionDescription)}>{section.note}</p>
                )}
              </div>
              {section.groups.map((group, index) => (
                <div key={group.title ?? index} {...props(settingsPatterns.section)}>
                  {group.title !== undefined && (
                    <div {...props(settingsPatterns.sectionHeader)}>
                      <h3 {...props(settingsPatterns.sectionTitle)}>{group.title}</h3>
                    </div>
                  )}
                  <div {...props(settingsPatterns.group)}>
                    {group.settings.map((setting) => (
                      <SettingRow key={setting.title} setting={setting} annotated={annotated} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

const styles = create({
  page: {
    display: "flex",
    height: "100%",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  rail: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: 220,
    flexShrink: 0,
    paddingBlock: 48,
    paddingInline: 8,
    backgroundColor: role.bgChrome,
  },
  content: {
    flex: 1,
    minWidth: 0,
    overflowY: "auto",
    scrollPaddingBlockStart: 24,
  },
  contentInner: {
    display: "flex",
    flexDirection: "column",
    containerType: "inline-size",
    gap: settingsSchema.sectionGap,
    width: `min(${settingsSchema.contentWidth}, calc(100% - 2 * ${settingsSchema.contentGutter}))`,
    marginInline: "auto",
    paddingBlock: "48px 120px",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingInline: 4,
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sourcesToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: settingsSchema.sectionGap,
    paddingBlockStart: 24,
  },
  sectionTitleRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingInline: 4,
  },
  sources: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingBlockStart: 2,
  },
  sourceLine: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  chip: {
    paddingBlock: 1,
    paddingInline: 6,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    color: role.contentInteractivePrimary,
    fontSize: type.fontXs,
    fontWeight: 500,
    lineHeight: type.leadingXs,
  },
  platform: {
    paddingBlock: 1,
    paddingInline: 6,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  source: {
    minWidth: 0,
    overflowWrap: "anywhere",
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  sourceText: {
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  percent: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
    lineHeight: type.leadingSm,
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    gap: 12,
  },
  actionValue: {
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  text: { width: 220 },
});
