import { SpanType } from "@nyte-ai/plugin/design/board-protocol";
import { idSchema } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { DesktopApp } from "./desktop-app.ts";

export const DesktopAppType = Type.Union([
  Type.Literal("nyte"),
  Type.Literal("code"),
  Type.Literal("studio"),
] as const);

/** Where a switch goes: an app, or `last`, the other app the person was last in on the same project. */
export type AppSwitch = DesktopApp | "last";

export const DESKTOP_APP_LABELS = {
  nyte: "Nyte",
  code: "Code",
  studio: "Studio",
} as const satisfies Record<DesktopApp, string>;

/** What the person's selection is on when they switch apps, as the light names it: a file, or a range of one. */
export const ArrivalSubjectType = Type.Union([
  Type.Object(
    { kind: Type.Literal("file"), path: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("span"), ...SpanType.properties, path: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
]);

export type ArrivalSubject = Static<typeof ArrivalSubjectType>;

export interface DesktopWindow {
  readonly id: string;
  readonly app: DesktopApp;
  readonly launch: { readonly windowIds: readonly string[] } | undefined;
  readonly open: string | undefined;
  readonly reloaded: boolean;
}

export const SelectedWorkspaceType = Type.Object(
  {
    id: idSchema<"workspace">(),
    path: Type.String({ minLength: 1 }),
    name: Type.String(),
  },
  { additionalProperties: false },
);

const DesktopWindowOpenType = Type.Union([
  Type.Object({ kind: Type.Literal("folder"), workspace: SelectedWorkspaceType }),
  Type.Object({
    kind: Type.Literal("file"),
    path: Type.String(),
    workspace: Type.Optional(SelectedWorkspaceType),
  }),
  Type.Object({
    kind: Type.Literal("app"),
    workspace: Type.Optional(SelectedWorkspaceType),
    subject: Type.Optional(ArrivalSubjectType),
  }),
]);

export type DesktopWindowOpen = Static<typeof DesktopWindowOpenType>;

export interface WindowOpening {
  readonly window: DesktopWindow;
  readonly workspace: DesktopWindowOpen["workspace"];
}

export function windowOpening(window: DesktopWindow): WindowOpening {
  return {
    window: window.reloaded ? { ...window, open: undefined } : window,
    workspace: window.open === undefined ? undefined : parseWindowOpen(window.open).workspace,
  };
}

export function parseWindowOpen(argument: string): DesktopWindowOpen {
  const open: unknown = JSON.parse(argument);

  if (!Value.Check(DesktopWindowOpenType, open)) {
    throw new Error("The main process opened this window for something it can't show.");
  }

  return open;
}
