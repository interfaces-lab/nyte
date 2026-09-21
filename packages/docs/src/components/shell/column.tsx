import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { shell, withShell } from "~/shell.stylex";

export function ShellColumnBody({ children }: { children: ReactNode }) {
  return (
    <>
      <div {...withShell("shell-scroll", stylex.props(shell.column))}>{children}</div>
      <div {...stylex.props(shell.columnCover)} aria-hidden />
    </>
  );
}

/*
 * The article column. The locked columnWrap + scroll + fade structure is
 * the shell's; src/shell.css paints it for both sections.
 */
export function ShellMain({ children }: { children: ReactNode }) {
  return (
    <main {...withShell("shell-main", stylex.props(shell.columnWrap))}>
      <ShellColumnBody>{children}</ShellColumnBody>
    </main>
  );
}
