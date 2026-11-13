import { standard } from "@nyte-ai/schema";
import type { Infer, Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { TSchema } from "typebox";

const page = Type.Optional(
  Type.String({ description: "The page id; omit for the page opened last." }),
);

const ref = Type.String({ description: "A node's ref from the latest snapshot." });

function on<P extends Record<string, TSchema>>(properties: P) {
  return standard(Type.Object({ page, ...properties }));
}

export const browserParameters = {
  browser_open: standard(
    Type.Object({ url: Type.String({ minLength: 1, description: "The URL to open." }) }),
  ),
  browser_snapshot: on({ ref: Type.Optional(ref) }),
  browser_click: on({
    ref,
    button: Type.Optional(
      Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]),
    ),
    double: Type.Optional(Type.Boolean()),
  }),
  browser_type: on({
    ref,
    text: Type.String(),
    clear: Type.Optional(Type.Boolean()),
    submit: Type.Optional(Type.Boolean()),
  }),
  browser_press: on({ key: Type.String(), ref: Type.Optional(ref) }),
  browser_scroll: on({
    direction: Type.Union([
      Type.Literal("up"),
      Type.Literal("down"),
      Type.Literal("top"),
      Type.Literal("bottom"),
    ]),
    ref: Type.Optional(ref),
    pages: Type.Optional(Type.Number({ minimum: 0.1 })),
  }),
  browser_wait: on({
    for: Type.Union([Type.Literal("loaded"), Type.Literal("text"), Type.Literal("delay")]),
    text: Type.Optional(Type.String()),
    gone: Type.Optional(Type.Boolean({ description: "With text: wait for it to disappear." })),
    ms: Type.Optional(Type.Number({ minimum: 0 })),
  }),
  browser_console: on({
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    clear: Type.Optional(Type.Boolean()),
  }),
  browser_capture: on({}),
  browser_evaluate: on({ expression: Type.String(), ref: Type.Optional(ref) }),
};

type BrowserParameters = typeof browserParameters;

export type BrowserTool = keyof BrowserParameters;

export type BrowserStep = {
  readonly [T in BrowserTool]: { readonly tool: T; readonly args: Infer<BrowserParameters[T]> };
}[BrowserTool];

/**
 * A recorded browser call's step, or null when the tool isn't a browser tool or its arguments
 * don't parse.
 *
 * @category plugins
 */
export function readBrowserStep(name: string, args: Json): BrowserStep | null {
  switch (name) {
    case "browser_open":
      return step(name, args);
    case "browser_snapshot":
      return step(name, args);
    case "browser_click":
      return step(name, args);
    case "browser_type":
      return step(name, args);
    case "browser_press":
      return step(name, args);
    case "browser_scroll":
      return step(name, args);
    case "browser_wait":
      return step(name, args);
    case "browser_console":
      return step(name, args);
    case "browser_capture":
      return step(name, args);
    case "browser_evaluate":
      return step(name, args);
    default:
      return null;
  }
}

function step<T extends BrowserTool>(
  tool: T,
  args: Json,
): { readonly tool: T; readonly args: Infer<BrowserParameters[T]> } | null {
  const checked = browserParameters[tool]["~standard"].validate(args);

  if (checked instanceof Promise || checked.issues !== undefined) return null;

  return { tool, args: checked.value };
}
