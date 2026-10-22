import type {
  CSSProperties,
  InlineStyles,
  StyleXArray,
  StyleXClassNameFor,
} from "@stylexjs/stylex";

import type { XStyle } from "../style.ts";

export const restyleCategories = {
  layout: [
    "margin",
    "marginBlock",
    "marginBlockStart",
    "marginBlockEnd",
    "marginInline",
    "marginInlineStart",
    "marginInlineEnd",
    "alignSelf",
    "justifySelf",
    "placeSelf",
    "flex",
    "flexGrow",
    "flexShrink",
    "flexBasis",
    "order",
    "gridArea",
    "gridColumn",
    "gridColumnStart",
    "gridColumnEnd",
    "gridRow",
    "gridRowStart",
    "gridRowEnd",
  ],
  width: ["width", "minWidth", "maxWidth"],
  height: ["height", "minHeight", "maxHeight"],
  inset: [
    "position",
    "inset",
    "insetBlock",
    "insetBlockStart",
    "insetBlockEnd",
    "insetInline",
    "insetInlineStart",
    "insetInlineEnd",
    "top",
    "right",
    "bottom",
    "left",
    "zIndex",
    "positionAnchor",
    "anchorName",
  ],
  text: [
    "fontSize",
    "lineHeight",
    "letterSpacing",
    "fontWeight",
    "fontFamily",
    "fontVariantNumeric",
    "textAlign",
    "textWrap",
    "whiteSpace",
    "overflow",
    "overflowWrap",
    "textOverflow",
  ],
  color: ["color"],
  contents: [
    "padding",
    "paddingBlock",
    "paddingBlockStart",
    "paddingBlockEnd",
    "paddingInline",
    "paddingInlineStart",
    "paddingInlineEnd",
    "gap",
    "rowGap",
    "columnGap",
    "display",
    "flexDirection",
    "flexWrap",
    "alignItems",
    "justifyContent",
    "textAlign",
    "overflow",
    "overflowX",
    "overflowY",
    "overscrollBehavior",
    "scrollbarWidth",
  ],
  motion: [
    "opacity",
    "visibility",
    "scale",
    "translate",
    "rotate",
    "transform",
    "transitionProperty",
    "transitionDuration",
    "transitionTimingFunction",
    "transitionDelay",
  ],
  interaction: ["cursor", "userSelect", "touchAction", "WebkitUserDrag", "WebkitAppRegion"],
} as const;

type Category = keyof typeof restyleCategories;

interface Contract {
  readonly file: string;
  readonly options: readonly string[];
  readonly allow: readonly Category[] | "host";
  readonly also?: readonly string[];
}

const host = (file: string) => ({ file, options: [], allow: "host" }) as const;

const placed = (file: string, options: readonly string[] = []) =>
  ({ file, options, allow: ["layout"] }) as const;

const sized = (file: string, options: readonly string[] = []) =>
  ({ file, options, allow: ["layout", "width"] }) as const;

const popup = (file: string, options: readonly string[] = ["tint"]) =>
  ({ file, options, allow: ["width", "height", "contents", "motion"] }) as const;

const heading = (file: string) =>
  ({ file, options: [], allow: ["layout", "width", "text", "color"] }) as const;

const button = {
  file: "packages/ui/src/button.tsx",
  options: ["variant", "size", "tone", "iconOnly", "pill"],
  allow: ["layout", "width", "inset"],
  also: ["borderRadius"],
} as const;

const dialog = "packages/ui/src/dialog.tsx";

const dialogPopup = {
  file: dialog,
  options: ["tint"],
  allow: ["width", "height", "inset", "contents", "motion"],
  also: ["borderStyle"],
} as const;

const menu = "packages/ui/src/menu.tsx";

const contextMenu = "packages/ui/src/context-menu.tsx";

const row = "packages/ui/src/row.tsx";

const autocomplete = "packages/ui/src/autocomplete.tsx";

const command = "packages/ui/src/command.tsx";

const collapsible = "packages/ui/src/collapsible.tsx";

const questionnaire = "packages/ui/src/questionnaire.tsx";

export const restyleContracts = {
  Questionnaire: { file: questionnaire, options: [], allow: ["layout", "width", "height"] },
  QuestionnaireProgress: sized(questionnaire),
  QuestionnaireItem: placed(questionnaire),
  QuestionnaireTitle: sized(questionnaire),
  QuestionnaireDescription: sized(questionnaire),
  QuestionnaireChoices: {
    file: questionnaire,
    options: [],
    allow: ["layout", "width", "height"],
    also: ["overflowY", "overscrollBehavior"],
  },
  QuestionnaireChoice: sized(questionnaire),
  QuestionnaireChoiceDescription: sized(questionnaire),
  QuestionnaireError: sized(questionnaire),
  QuestionnaireActions: sized(questionnaire),
  Button: button,
  ButtonLink: button,
  "SplitButton.Main": button,
  "SplitButton.MenuTrigger": button,
  "Toolbar.Button": button,
  Toggle: { ...button, file: "packages/ui/src/toggle.tsx", options: ["size", "indicator", "tone"] },
  SelectTrigger: { ...button, options: ["width"] },
  AutocompleteTrigger: { ...button, options: ["width"] },
  ButtonGroup: sized("packages/ui/src/button.tsx"),
  "SplitButton.Root": sized("packages/ui/src/button.tsx"),
  ToggleGroup: sized("packages/ui/src/toggle-group.tsx"),
  "Toolbar.Root": sized("packages/ui/src/toolbar.tsx"),
  "Toolbar.Group": sized("packages/ui/src/toolbar.tsx"),
  "Toolbar.Separator": placed("packages/ui/src/toolbar.tsx"),
  Icon: {
    file: "packages/ui/src/icon.tsx",
    options: ["size", "variant"],
    allow: ["layout", "color"],
  },
  Spinner: placed("packages/ui/src/spinner.tsx"),
  Kbd: placed("packages/ui/src/kbd.tsx", ["plain", "keycap", "held"]),
  Avatar: placed("packages/ui/src/avatar.tsx", ["size", "corners", "tone"]),
  AvatarImage: placed("packages/ui/src/avatar.tsx"),
  AvatarFallback: placed("packages/ui/src/avatar.tsx"),
  Checkbox: placed("packages/ui/src/checkbox.tsx", ["size", "attention"]),
  CheckboxField: {
    file: "packages/ui/src/checkbox.tsx",
    options: ["description"],
    allow: ["layout", "width", "contents"],
  },
  Switch: placed("packages/ui/src/switch.tsx"),
  SwitchField: {
    file: "packages/ui/src/switch.tsx",
    options: ["description"],
    allow: ["layout", "width", "contents"],
  },
  Input: {
    file: "packages/ui/src/input.tsx",
    options: ["variant", "size"],
    allow: ["layout", "width", "text"],
  },
  Textarea: {
    file: "packages/ui/src/input.tsx",
    options: ["variant", "size"],
    allow: ["layout", "width", "text"],
  },
  InputGroup: {
    file: "packages/ui/src/input.tsx",
    options: ["variant", "size"],
    allow: ["layout", "width", "inset", "contents"],
  },
  NumberFieldGroup: sized("packages/ui/src/number-field.tsx"),
  NumberFieldDecrement: placed("packages/ui/src/number-field.tsx"),
  NumberFieldInput: placed("packages/ui/src/number-field.tsx"),
  NumberFieldIncrement: placed("packages/ui/src/number-field.tsx"),
  "Dialog.Trigger": host(dialog),
  "Dialog.Close": host(dialog),
  "Dialog.Popup": dialogPopup,
  "Dialog.Header": placed(dialog),
  "Dialog.Title": heading(dialog),
  "Dialog.Description": heading(dialog),
  "Dialog.Footer": placed(dialog),
  "AlertDialog.Trigger": host("packages/ui/src/alert-dialog.tsx"),
  "AlertDialog.Close": host(dialog),
  "AlertDialog.Popup": dialogPopup,
  "AlertDialog.Header": placed(dialog),
  "AlertDialog.Title": heading(dialog),
  "AlertDialog.Description": heading(dialog),
  "AlertDialog.Footer": placed(dialog),
  "Command.Trigger": host(command),
  "Command.Close": host(command),
  "Command.Group": host(command),
  "Command.Popup": { ...dialogPopup, file: command },
  "Command.Input": placed(command),
  "Command.List": placed(command),
  "Command.Separator": placed(command),
  "Command.Item": placed(command),
  "Command.Empty": placed(command),
  "Popover.Backdrop": host("packages/ui/src/popover.tsx"),
  "Popover.Positioner": { file: "packages/ui/src/popover.tsx", options: [], allow: ["inset"] },
  "Popover.Popup": popup("packages/ui/src/popover.tsx"),
  "Popover.Title": heading("packages/ui/src/popover.tsx"),
  "Popover.Description": heading("packages/ui/src/popover.tsx"),
  PreviewCardContent: popup("packages/ui/src/preview-card.tsx"),
  TooltipContent: popup("packages/ui/src/tooltip.tsx", ["variant", "side", "tint"]),
  MenuContent: popup(menu),
  MenuSubContent: popup(menu),
  MenuItem: placed(menu, ["variant", "layout"]),
  MenuLinkItem: placed(menu, ["variant", "layout"]),
  MenuRadioItem: placed(menu, ["layout"]),
  MenuCheckboxItem: placed(menu, ["layout"]),
  MenuSwitchItem: placed(menu, ["layout"]),
  MenuSubTrigger: placed(menu, ["layout"]),
  MenuSeparator: placed(menu, ["inset"]),
  MenuGroupLabel: placed(menu),
  ContextMenuContent: popup(contextMenu),
  ContextMenuSubContent: popup(contextMenu),
  ContextMenuItem: placed(contextMenu, ["variant", "layout"]),
  ContextMenuLinkItem: placed(contextMenu, ["variant", "layout"]),
  ContextMenuRadioItem: placed(contextMenu, ["layout"]),
  ContextMenuCheckboxItem: placed(contextMenu, ["layout"]),
  ContextMenuSubTrigger: placed(contextMenu, ["layout"]),
  ContextMenuSeparator: placed(contextMenu, ["inset"]),
  ContextMenuGroupLabel: placed(contextMenu),
  SelectContent: popup("packages/ui/src/select.tsx"),
  SelectItem: placed("packages/ui/src/select.tsx"),
  AutocompleteContent: popup(autocomplete),
  AutocompleteClear: placed(autocomplete),
  AutocompleteInput: sized(autocomplete, ["variant"]),
  AutocompleteList: placed(autocomplete, ["variant"]),
  AutocompleteItem: placed(autocomplete, ["variant"]),
  AutocompleteGroupLabel: placed(autocomplete, ["variant"]),
  AutocompleteSeparator: placed(autocomplete),
  AutocompleteEmpty: placed(autocomplete),
  AutocompleteStatus: placed(autocomplete),
  "Meter.Root": sized("packages/ui/src/meter.tsx"),
  "Meter.Label": heading("packages/ui/src/meter.tsx"),
  "Meter.Value": heading("packages/ui/src/meter.tsx"),
  "Meter.Track": sized("packages/ui/src/meter.tsx"),
  "Meter.Indicator": placed("packages/ui/src/meter.tsx"),
  "Slider.Root": host("packages/ui/src/slider.tsx"),
  "Slider.Label": placed("packages/ui/src/slider.tsx"),
  "Slider.Value": placed("packages/ui/src/slider.tsx"),
  "Slider.Control": sized("packages/ui/src/slider.tsx"),
  "Slider.Track": placed("packages/ui/src/slider.tsx"),
  "Slider.Indicator": placed("packages/ui/src/slider.tsx"),
  "Slider.Thumb": placed("packages/ui/src/slider.tsx"),
  "Tabs.Root": host("packages/ui/src/tabs.tsx"),
  "Tabs.Panel": host("packages/ui/src/tabs.tsx"),
  "Tabs.List": {
    file: "packages/ui/src/tabs.tsx",
    options: ["variant"],
    allow: ["layout", "width", "height", "contents"],
    also: ["maskImage"],
  },
  "Tabs.Tab": placed("packages/ui/src/tabs.tsx", ["variant"]),
  "Tabs.Tab[variant=bare]": host("packages/ui/src/tabs.tsx"),
  "Tabs.Indicator": placed("packages/ui/src/tabs.tsx"),
  BarChart: {
    file: "packages/ui/src/chart.tsx",
    options: ["height", "tint"],
    allow: ["layout", "width"],
  },
  Sparkline: {
    file: "packages/ui/src/chart.tsx",
    options: ["height", "tint"],
    allow: ["layout", "width"],
  },
  "Collapsible.Root": host(collapsible),
  "Collapsible.Trigger": host(collapsible),
  "Collapsible.Panel": host(collapsible),
  "Collapsible.Preview": host(collapsible),
  "Collapsible.Chevron": {
    file: collapsible,
    options: ["size"],
    allow: ["layout", "width", "height", "color", "motion"],
    also: ["display"],
  },
  Row: {
    file: row,
    options: ["size", "variant", "interactive", "selected", "revealActions"],
    allow: ["layout", "width", "height", "text", "color", "contents", "interaction"],
    also: ["borderRadius", "opacity", "--_row-fill", "--_row-padding-inline"],
  },
  "Row[variant=bare]": host(row),
  "Row.Primary": host(row),
  "Row.Backdrop": host(row),
  "Row.Leading": {
    file: row,
    options: [],
    allow: ["layout", "width", "height", "inset", "color", "contents"],
  },
  "Row.Body": placed(row),
  "Row.Label": { file: row, options: [], allow: ["layout", "text", "color", "contents"] },
  "Row.Description": heading(row),
  "Row.Meta": {
    file: row,
    options: [],
    allow: ["layout", "width", "text", "color", "contents"],
    also: ["anchorName"],
  },
  "Row.Actions": { file: row, options: ["placement"], allow: ["layout", "inset", "height"] },
} as const satisfies Record<string, Contract>;

type Contracts = typeof restyleContracts;

type Allowed<Entry extends Contract> =
  | (Entry["allow"] extends readonly Category[]
      ? (typeof restyleCategories)[Entry["allow"][number]][number]
      : never)
  | (Entry extends { readonly also: readonly (infer Property)[] } ? Property : never);

type Scope = Readonly<{ theme: StyleXClassNameFor<unknown, unknown> }>;

type Restyled<Property extends string> = Readonly<
  { readonly [Key in Property]?: StyleXClassNameFor<Key, unknown> | null } & {
    readonly [Key in Exclude<keyof CSSProperties, Property>]?: never;
  } & { readonly [pseudo: `:${string}`]: never }
>;

export type Restyle<Name extends keyof Contracts> = Contracts[Name]["allow"] extends "host"
  ? XStyle
  : StyleXArray<
      | null
      | undefined
      | false
      | Scope
      | Restyled<Allowed<Contracts[Name]>>
      | readonly [Restyled<Allowed<Contracts[Name]>>, InlineStyles]
    >;
