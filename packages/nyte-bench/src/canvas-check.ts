import { files as shellFiles } from "@nyte-ai/canvas/shell-files";
import { chromiumCanvasPreview } from "@nyte-ai/host/canvas-preview";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";

const RenderArgs = Type.Object({
  title: Type.String(),
  source: Type.String(),
  files: Type.Optional(Type.Record(Type.String(), Type.String())),
});

/** A literal colour a canvas should have taken from the kit: a hex beside a colour property, or a colour function. */
const HARD_CODED_COLOUR =
  /(?:color|colour|background|fill|stroke|border)[^;\n]{0,40}#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/giu;

const PREVIEW_TIMEOUT_MS = 30_000;

const preview = chromiumCanvasPreview(shellFiles);

/** How a canvas the chat rendered holds up when the user sees it. */
export interface CanvasCheck {
  readonly title: string;
  /** Load and render errors in a real canvas runtime; null when no Chromium could preview it. */
  readonly errors: readonly string[] | null;
  /** Colours written into the source instead of read from the theme. */
  readonly colours: readonly string[];
  readonly usesKit: boolean;
  readonly bytes: number;
}

/** Compiles a `canvas_render` call's arguments the way the tool does and renders them in headless Chromium, in the light theme at the chat's width. */
export async function checkCanvas(args: Json): Promise<CanvasCheck> {
  if (!Value.Check(RenderArgs, args))
    return {
      title: "",
      errors: ["The call's arguments are not a canvas."],
      colours: [],
      usesKit: false,
      bytes: 0,
    };

  const sources = [args.source, ...Object.values(args.files ?? {})];
  const text = sources.join("\n");

  const shared = {
    title: args.title,
    colours: [...text.matchAll(HARD_CODED_COLOUR)].map((match) => match[0]),
    usesKit: /from\s+["']nyte\/canvas["']/u.test(text),
    bytes: new TextEncoder().encode(text).byteLength,
  };

  const compiled = await compileCanvas(args.source, args.files);

  if (compiled.kind === "failed")
    return { ...shared, errors: compiled.errors.map((error) => error.text) };

  const outcome = await preview(
    {
      module: { runtime: compiled.runtime, code: compiled.code, title: args.title },
      theme: "light",
    },
    AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
  );

  if (outcome.kind === "unavailable") return { ...shared, errors: null };

  return {
    ...shared,
    errors: outcome.report.errors.map((error) => `${error.phase}: ${error.message}`),
  };
}
