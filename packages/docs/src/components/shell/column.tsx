import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { shell, withShell, type ShellSkin } from "~/shell.stylex";

export function ShellColumnBody({ children }: { children: ReactNode }) {
  return (
    <>
      <div {...withShell("shell-scroll", stylex.props(shell.column))}>{children}</div>
      <div {...stylex.props(shell.columnCover)} aria-hidden />
    </>
  );
}

/*
 * The article column. The skin name only chooses classes; the locked
 * columnWrap + scroll + fade structure is the shell's.
 */
export function ShellMain({ skin, children }: { skin: ShellSkin; children: ReactNode }) {
  return (
    <main {...withShell(`${skin}-main`, stylex.props(shell.columnWrap))}>
      <ShellColumnBody>{children}</ShellColumnBody>
    </main>
  );
}
