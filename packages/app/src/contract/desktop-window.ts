import { idSchema } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export interface DesktopWindow {
  readonly id: string;
  readonly launch: { readonly windowIds: readonly string[] } | undefined;
  /** What Finder opened this window to show in the Editor, as JSON; `parseWindowOpen` reads it. */
  readonly open: string | undefined;
  /** Whether this page reloads the window, rather than being the first page it showed. */
  readonly reloaded: boolean;
}

/** A `SelectedWorkspace` read from outside the renderer. */
export const SelectedWorkspaceType = Type.Object(
  {
    id: idSchema<"workspace">(),
    path: Type.String({ minLength: 1 }),
    name: Type.String(),
  },
  { additionalProperties: false },
);

/** `workspace` is the window's workspace, whose path keys its workbench view. */
const DesktopWindowOpenType = Type.Union([
  Type.Object({ kind: Type.Literal("folder"), workspace: SelectedWorkspaceType }),
  Type.Object({
    kind: Type.Literal("file"),
    path: Type.String(),
    workspace: Type.Optional(SelectedWorkspaceType),
  }),
]);

export type DesktopWindowOpen = Static<typeof DesktopWindowOpenType>;

export interface WindowOpening {
  /** The window as this page starts it, opening what Finder asked only on its first page. */
  readonly window: DesktopWindow;
  /** The folder every page of the window starts on, as main expects after each load. */
  readonly workspace: DesktopWindowOpen["workspace"];
}

/**
 * A window Finder opened, as one of its pages starts: every page starts on Finder's folder, and
 * only the first opens what Finder asked in the Editor, so a reload doesn't repeat it.
 */
export function windowOpening(window: DesktopWindow): WindowOpening {
  return {
    window: window.reloaded ? { ...window, open: undefined } : window,
    workspace: window.open === undefined ? undefined : parseWindowOpen(window.open).workspace,
  };
}

export function parseWindowOpen(argument: string): DesktopWindowOpen {
  const open: unknown = JSON.parse(argument);

  if (!Value.Check(DesktopWindowOpenType, open))
    throw new Error("The main process opened this window for something it can't show.");

  return open;
}
