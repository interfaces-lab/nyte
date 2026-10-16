import { Type } from "typebox";
import {
  ConsoleEntryType,
  PageInfoSchema,
  PageInfoType,
  PageOutcomeSchema,
  PageSnapshotSchema,
  PageViewSchema,
} from "../browser.ts";
import { idSchema } from "../ids.ts";
import { JsonType } from "../json.ts";
import { BYTES, NOTHING, ON_WORKSPACE, wireObject, wireSchema, WORKSPACE } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const BROWSER = { authority: "participant", scope: "workspace", capability: "browser" } as const;

const PAGE = { ...WORKSPACE, page: idSchema<"page">() };

const ON_PAGE = wireObject(PAGE);

const PAGES = wireSchema(Type.Array(PageInfoType));

export const BROWSER_OPERATIONS = {
  "browser.open": {
    ...BROWSER,
    kind: "command",
    recovery: "replay",
    input: wireObject({
      ...WORKSPACE,
      url: Type.String(),
      id: Type.Optional(Type.String()),
    }),
    output: PageInfoSchema,
  },
  "browser.adopt": {
    ...BROWSER,
    kind: "command",
    input: wireObject({ ...WORKSPACE, id: idSchema<"page">() }),
    output: PageInfoSchema,
  },
  "browser.list": { ...BROWSER, kind: "query", input: ON_WORKSPACE, output: PAGES },
  "browser.watch": { ...BROWSER, kind: "watch", input: ON_WORKSPACE, output: PAGES },
  "page.view": { ...BROWSER, kind: "query", input: ON_PAGE, output: PageViewSchema },
  "page.watch": { ...BROWSER, kind: "watch", input: ON_PAGE, output: PageViewSchema },
  "page.snapshot": {
    ...BROWSER,
    kind: "query",
    input: wireObject({ ...PAGE, ref: Type.Optional(Type.String()) }),
    output: PageSnapshotSchema,
  },
  "page.navigate": {
    ...BROWSER,
    kind: "command",
    input: wireObject({ ...PAGE, url: Type.String() }),
    output: PageOutcomeSchema,
  },
  "page.back": { ...BROWSER, kind: "command", input: ON_PAGE, output: PageOutcomeSchema },
  "page.forward": { ...BROWSER, kind: "command", input: ON_PAGE, output: PageOutcomeSchema },
  "page.reload": { ...BROWSER, kind: "command", input: ON_PAGE, output: PageOutcomeSchema },
  "page.stopLoading": { ...BROWSER, kind: "command", input: ON_PAGE, output: PageOutcomeSchema },
  "page.click": {
    ...BROWSER,
    kind: "command",
    recovery: "never",
    input: wireObject({
      ...PAGE,
      ref: Type.String(),
      button: Type.Optional(Type.Enum(["left", "right", "middle"])),
      double: Type.Optional(Type.Boolean()),
      expect: Type.Optional(idSchema<"document-revision">()),
    }),
    output: PageOutcomeSchema,
  },
  "page.type": {
    ...BROWSER,
    kind: "command",
    recovery: "never",
    input: wireObject({
      ...PAGE,
      ref: Type.String(),
      text: Type.String(),
      clear: Type.Optional(Type.Boolean()),
      submit: Type.Optional(Type.Boolean()),
      expect: Type.Optional(idSchema<"document-revision">()),
    }),
    output: PageOutcomeSchema,
  },
  "page.press": {
    ...BROWSER,
    kind: "command",
    recovery: "never",
    input: wireObject({
      ...PAGE,
      key: Type.String(),
      ref: Type.Optional(Type.String()),
    }),
    output: PageOutcomeSchema,
  },
  "page.scroll": {
    ...BROWSER,
    kind: "command",
    recovery: "never",
    input: wireObject({
      ...PAGE,
      direction: Type.Enum(["up", "down", "top", "bottom"]),
      ref: Type.Optional(Type.String()),
      pages: Type.Optional(Type.Number()),
    }),
    output: PageOutcomeSchema,
  },
  "page.wait": {
    ...BROWSER,
    kind: "query",
    input: wireObject({
      ...PAGE,
      condition: Type.Union([
        Type.Object({ kind: Type.Literal("loaded") }),
        Type.Object({ kind: Type.Literal("text"), text: Type.String(), present: Type.Boolean() }),
        Type.Object({ kind: Type.Literal("delay"), ms: Type.Number() }),
      ]),
    }),
    output: PageOutcomeSchema,
  },
  "page.console": {
    ...BROWSER,
    kind: "command",
    input: wireObject({
      ...PAGE,
      limit: Type.Optional(Type.Number()),
      clear: Type.Optional(Type.Boolean()),
    }),
    output: wireSchema(Type.Array(ConsoleEntryType)),
  },
  "page.capture": { ...BROWSER, kind: "stream", input: ON_PAGE, output: BYTES },
  "page.evaluate": {
    ...BROWSER,
    kind: "command",
    recovery: "never",
    input: wireObject({
      ...PAGE,
      expression: Type.String(),
      options: Type.Optional(Type.Object({ ref: Type.Optional(Type.String()) })),
    }),
    output: wireSchema(
      Type.Union([
        Type.Object({ kind: Type.Literal("value"), value: JsonType }),
        Type.Object({ kind: Type.Literal("threw"), message: Type.String() }),
      ]),
    ),
  },
  "page.close": { ...BROWSER, kind: "command", input: ON_PAGE, output: NOTHING },
} as const satisfies OperationRows;
