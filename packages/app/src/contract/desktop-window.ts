import { idSchema } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export interface DesktopWindow {
  readonly id: string;
  readonly launch: { readonly windowIds: readonly string[] } | undefined;
  /** What Finder opened this window to show in the Editor, as JSON; `parseWindowOpen` reads it. */
  readonly open: string | undefined;
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

export function parseWindowOpen(argument: string): DesktopWindowOpen {
  const open: unknown = JSON.parse(argument);

  if (!Value.Check(DesktopWindowOpenType, open))
    throw new Error("The main process opened this window for something it can't show.");

  return open;
}
