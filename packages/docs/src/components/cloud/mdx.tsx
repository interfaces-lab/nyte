import Link from "next/link";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { CodeFrame } from "./shell/code-frame";
import { Preview } from "./preview";
import { TokenTable } from "./token-table";
import { HostMatrix } from "./host-matrix";
import { ButtonSizesDemo, ButtonStatesDemo, ButtonVariantsDemo } from "./demos/button";
import { AvatarDemo, AvatarTonesDemo } from "./demos/avatar";
import { InputDemo, TextareaDemo } from "./demos/input";
import { AlertDialogDemo, DialogDemo } from "./demos/dialog";
import { DropdownMenuDemo } from "./demos/dropdown-menu";

function Anchor({ href = "", ...props }: ComponentProps<"a">) {
  if (href.startsWith("/") || href.startsWith("#")) return <Link href={href} {...props} />;
  return <a href={href} rel="noreferrer" target="_blank" {...props} />;
}

function Table(props: ComponentProps<"table">) {
  return (
    <div className="cloud-table-scroll">
      <table {...props} />
    </div>
  );
}

/*
 * Cloud renders MDX with its own elements, none from fumadocs-ui. Headings
 * keep the ids fumadocs-mdx assigns so the TOC and deep links line up.
 */
export function cloudMdxComponents(): MDXComponents {
  return {
    a: Anchor,
    pre: CodeFrame,
    table: Table,
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
