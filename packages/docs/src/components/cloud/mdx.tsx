import type { MDXComponents } from "mdx/types";
import { shellMdxComponents } from "~/components/shell/mdx";
import { CloudFeatures } from "./features";
import { Preview } from "./preview";
import { TokenTable } from "./token-table";
import { HostMatrix } from "./host-matrix";
import { ButtonSizesDemo, ButtonStatesDemo, ButtonVariantsDemo } from "./demos/button";
import { AvatarDemo, AvatarTonesDemo } from "./demos/avatar";
import { InputDemo, TextareaDemo } from "./demos/input";
import { AlertDialogDemo, DialogDemo } from "./demos/dialog";
import { DropdownMenuDemo } from "./demos/dropdown-menu";

/*
 * Cloud renders MDX with the shared shell elements plus its own demo
 * surfaces, none from fumadocs-ui.
 */
export function cloudMdxComponents(): MDXComponents {
  return {
    ...shellMdxComponents("cloud"),
    CloudFeatures,
    Preview,
    TokenTable,
    HostMatrix,
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
  };
}
