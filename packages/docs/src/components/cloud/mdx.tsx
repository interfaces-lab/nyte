import type { MDXComponents } from "mdx/types";
import { shellMdxComponents } from "~/components/shell/mdx";
import { CloudFeatures } from "./features";
import { Preview } from "./preview";
import { TokenTable } from "./token-table";
import { ButtonSizesDemo, ButtonStatesDemo, ButtonVariantsDemo } from "./demos/button";
import { AvatarDemo, AvatarTonesDemo } from "./demos/avatar";
import { InputDemo, TextareaDemo } from "./demos/input";
import { AlertDialogDemo, DialogDemo } from "./demos/dialog";
import { DropdownMenuDemo } from "./demos/dropdown-menu";
import { AutocompleteDemo } from "./demos/autocomplete";
import { CollapsibleDemo } from "./demos/collapsible";
import { ContextMenuDemo } from "./demos/context-menu";
import { NumberFieldDemo } from "./demos/number-field";
import { PopoverDemo } from "./demos/popover";
import { PreviewCardDemo } from "./demos/preview-card";
import { RowDemo } from "./demos/row";
import { SelectDemo } from "./demos/select";
import { SliderDemo } from "./demos/slider";
import { SwitchDemo } from "./demos/switch";
import { TabsDemo } from "./demos/tabs";
import { ToggleDemo, ToggleGroupDemo, ToggleGroupMultipleDemo } from "./demos/toggle";
import { ToolbarDemo } from "./demos/toolbar";
import { TooltipDemo } from "./demos/tooltip";

/*
 * Cloud renders MDX with the shared shell elements plus its own demo
 * surfaces, none from fumadocs-ui.
 */
export function cloudMdxComponents(): MDXComponents {
  return {
    ...shellMdxComponents(),
    CloudFeatures,
    Preview,
    TokenTable,
    ButtonVariantsDemo,
    ButtonSizesDemo,
    ButtonStatesDemo,
    AvatarDemo,
    AvatarTonesDemo,
    InputDemo,
    TextareaDemo,
    DialogDemo,
    AlertDialogDemo,
    DropdownMenuDemo,
    AutocompleteDemo,
    CollapsibleDemo,
    ContextMenuDemo,
    NumberFieldDemo,
    PopoverDemo,
    PreviewCardDemo,
    RowDemo,
    SelectDemo,
    SliderDemo,
    SwitchDemo,
    TabsDemo,
    ToggleDemo,
    ToggleGroupDemo,
    ToggleGroupMultipleDemo,
    ToolbarDemo,
    TooltipDemo,
  };
}
