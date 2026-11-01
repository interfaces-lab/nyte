import { Type } from "typebox";
import {
  ConsoleEntryType,
  PageInfoSchema,
  PageInfoType,
  PageOutcomeSchema,
  PageSnapshotSchema,
  PageViewSchema,
} from "../../browser.ts";
import { idSchema } from "../../ids.ts";
import { JsonType } from "../../json.ts";
import { BYTES, NOTHING, ON_WORKSPACE, wireObject, wireSchema, WORKSPACE } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const BROWSER = { authority: "participant", scope: "workspace", capability: "browser" } as const;

const PAGE = { ...WORKSPACE, page: idSchema<"page">() };

const ON_PAGE = wireObject(PAGE);

const PAGES = wireSchema(Type.Array(PageInfoType));

export const BROWSER_OPERATIONS = {
  "browser.open": {
    ...BROWSER,
    summary: "Opens a page at a URL in the workspace's browser.",
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
    summary: "Takes control of a page that is already open in the workspace's browser.",
    kind: "command",
    input: wireObject({ ...WORKSPACE, id: idSchema<"page">() }),
    output: PageInfoSchema,
  },
  "browser.list": {
    ...BROWSER,
    summary: "Lists the open pages in the workspace's browser.",
    kind: "query",
    input: ON_WORKSPACE,
    output: PAGES,
  },
  "browser.watch": {
    ...BROWSER,
    summary: "Streams the workspace's open pages each time they change.",
    kind: "watch",
    input: ON_WORKSPACE,
    output: PAGES,
  },
  "page.view": {
    ...BROWSER,
    summary: "Reads a page's URL, title and loading state.",
    kind: "query",
    input: ON_PAGE,
    output: PageViewSchema,
  },
  "page.watch": {
    ...BROWSER,
    summary: "Streams a page's URL, title and loading state each time they change.",
    kind: "watch",
    input: ON_PAGE,
    output: PageViewSchema,
  },
  "page.snapshot": {
    ...BROWSER,
    summary: "Returns a page's accessibility tree, or the subtree under one node.",
    kind: "query",
    input: wireObject({ ...PAGE, ref: Type.Optional(Type.String()) }),
    output: PageSnapshotSchema,
  },
  "page.navigate": {
    ...BROWSER,
    summary: "Loads a URL in a page.",
    kind: "command",
    input: wireObject({ ...PAGE, url: Type.String() }),
    output: PageOutcomeSchema,
  },
  "page.back": {
    ...BROWSER,
    summary: "Goes back one entry in a page's history.",
    kind: "command",
    input: ON_PAGE,
    output: PageOutcomeSchema,
  },
  "page.forward": {
    ...BROWSER,
    summary: "Goes forward one entry in a page's history.",
    kind: "command",
    input: ON_PAGE,
    output: PageOutcomeSchema,
  },
  "page.reload": {
    ...BROWSER,
    summary: "Reloads a page.",
    kind: "command",
    input: ON_PAGE,
    output: PageOutcomeSchema,
  },
  "page.stopLoading": {
    ...BROWSER,
    summary: "Stops a page from loading.",
    kind: "command",
    input: ON_PAGE,
    output: PageOutcomeSchema,
  },
  "page.click": {
    ...BROWSER,
    summary: "Clicks a node on a page.",
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
    summary: "Types text into a node on a page.",
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
    summary: "Presses a key or chord on a page or one of its nodes.",
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
    summary: "Scrolls a page or one of its nodes.",
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
    summary: "Waits until a page loads, text appears or disappears, or a delay passes.",
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
    summary: "Reads a page's console messages and can clear them.",
    kind: "command",
    input: wireObject({
      ...PAGE,
      limit: Type.Optional(Type.Number()),
      clear: Type.Optional(Type.Boolean()),
    }),
    output: wireSchema(Type.Array(ConsoleEntryType)),
  },
  "page.capture": {
    ...BROWSER,
    summary: "Streams the bytes of a screenshot of a page.",
    kind: "stream",
    input: ON_PAGE,
    output: BYTES,
  },
  "page.evaluate": {
    ...BROWSER,
    summary: "Runs a JavaScript expression in a page and returns its value or error.",
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
  "page.close": {
    ...BROWSER,
    summary: "Closes a page.",
    kind: "command",
    input: ON_PAGE,
    output: NOTHING,
  },
} as const satisfies OperationRows;
