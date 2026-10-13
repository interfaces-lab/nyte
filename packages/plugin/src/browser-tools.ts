import type { BrowserApi, Page, ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import { asId, standard } from "@nyte-ai/schema";
import type { Infer, PageOutcome, PageSnapshot } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import type { Plugin } from "./core.ts";

const page = Type.Optional(
  Type.String({ description: "The page id; omit for the page opened last." }),
);

const ref = Type.String({ description: "A node's ref from the latest snapshot." });

/** Returns a tool's parameters: an optional page id and the given properties. */
function on<P extends Record<string, TSchema>>(properties: P) {
  return standard(Type.Object({ page, ...properties }));
}

/** Returns the workspace's browser, or throws why there is none. */
async function browserOf(invocation: ToolInvocation): Promise<BrowserApi> {
  const capability = await invocation.workspace.browser();

  if (capability.kind !== "available")
    throw new Error(`No browser is available here: ${capability.reason}`);

  return capability.api;
}

/** Runs `use` on a transient hold of the page named, or of the page opened last, and releases the hold. */
async function withPage<T>(
  invocation: ToolInvocation,
  id: string | undefined,
  use: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await browserOf(invocation);
  const target = id ?? (await browser.list()).at(-1)?.id;

  if (target === undefined) throw new Error("No page is open. Call browser_open first.");
  await using held = await browser.adopt(asId(target));

  return use(held);
}

/** Returns a snapshot as one line per node: indent, ref, role and name. */
function render(snapshot: PageSnapshot): string {
  return [
    `Revision ${snapshot.revision}`,
    ...snapshot.nodes.map(
      (node) =>
        `${"  ".repeat(node.depth)}[${node.ref}] ${node.role} "${node.name}"${node.editable ? " (editable)" : ""}`,
    ),
  ].join("\n");
}

/** Returns a page action's outcome as tool text. */
function outcomeText(outcome: PageOutcome): string {
  if (outcome.kind === "applied") return render(outcome.snapshot);

  if (outcome.kind === "stale")
    return `The page changed (now revision ${outcome.revision}). Take a snapshot and try again.`;

  return outcome.kind === "refused"
    ? `Refused: ${outcome.reason}.`
    : `The page is closed: ${outcome.reason}.`;
}

/** Returns a tool over the browser: the given name, description and parameters, its result as text. */
function browserTool<S extends ReturnType<typeof on>>(input: {
  readonly name: string;
  readonly description: string;
  readonly parameters: S;
  readonly replay: "safe" | "never";
  run(args: Infer<S>, invocation: ToolInvocation): Promise<string>;
}): ToolDefinition<Infer<S>> {
  return {
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    class: () => ({ kind: "custom", label: input.name.replace("browser_", "Browser: ") }),
    replay: input.replay,
    execute: async (args, invocation) => ({
      content: [{ kind: "text", text: await input.run(args, invocation) }],
    }),
  };
}

const open: ToolDefinition<{ url: string }> = {
  name: "browser_open",
  description: "Open a URL in a new browser page and return the page id and its snapshot.",
  parameters: standard(
    Type.Object({ url: Type.String({ minLength: 1, description: "The URL to open." }) }),
  ),
  class: (args) => ({ kind: "custom", label: `Opening ${args.url}` }),
  replay: "safe",
  async execute(args, invocation) {
    const opened = await (await browserOf(invocation)).open({ url: args.url });
    const view = await opened.view();

    return {
      content: [
        {
          kind: "text",
          text: `Page ${opened.id}: ${view.title} (${view.url})\n${render(await opened.snapshot())}`,
        },
      ],
    };
  },
};

const capture: ToolDefinition<{ page?: string }> = {
  name: "browser_capture",
  description: "Take a screenshot of the page.",
  parameters: on({}),
  class: () => ({ kind: "custom", label: "Browser: capture" }),
  replay: "safe",
  execute: (args, invocation) =>
    withPage(invocation, args.page, async (held) => {
      const image = await held.capture();

      try {
        const blob = await invocation.env.files.upload(image.chunks());

        return { content: [{ kind: "file", blob, mime: image.mime ?? "image/png" }] };
      } finally {
        await image.close();
      }
    }),
};

/**
 * The browser tools: open, snapshot, click, type, press, scroll, wait,
 * console, capture and evaluate, over the workspace's browser capability
 * (`workspace.browser()`, which a desktop adds through `wrapEnv`). Actions
 * address nodes by the refs of the latest snapshot.
 *
 * @category plugins
 * @since 0.1.0
 */
export const browserTools: readonly ToolDefinition[] = [
  open,
  browserTool({
    name: "browser_snapshot",
    description:
      "Read the page's accessibility tree: one line per node with its ref, role and name.",
    parameters: on({ ref: Type.Optional(ref) }),
    replay: "safe",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) =>
        render(await held.snapshot({ ref: args.ref })),
      ),
  }),
  browserTool({
    name: "browser_click",
    description: "Click a node by its ref.",
    parameters: on({
      ref,
      button: Type.Optional(
        Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]),
      ),
      double: Type.Optional(Type.Boolean()),
    }),
    replay: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) =>
        outcomeText(await held.click({ ref: args.ref, button: args.button, double: args.double })),
      ),
  }),
  browserTool({
    name: "browser_type",
    description: "Type text into a node by its ref.",
    parameters: on({
      ref,
      text: Type.String(),
      clear: Type.Optional(Type.Boolean()),
      submit: Type.Optional(Type.Boolean()),
    }),
    replay: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) =>
        outcomeText(
          await held.type({
            ref: args.ref,
            text: args.text,
            clear: args.clear,
            submit: args.submit,
          }),
        ),
      ),
  }),
  browserTool({
    name: "browser_press",
    description: "Press a key or chord, such as Enter or Control+a, on a node or the page.",
    parameters: on({ key: Type.String(), ref: Type.Optional(ref) }),
    replay: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) =>
        outcomeText(await held.press({ key: args.key, ref: args.ref })),
      ),
  }),
  browserTool({
    name: "browser_scroll",
    description: "Scroll the page or a node.",
    parameters: on({
      direction: Type.Union([
        Type.Literal("up"),
        Type.Literal("down"),
        Type.Literal("top"),
        Type.Literal("bottom"),
      ]),
      ref: Type.Optional(ref),
      pages: Type.Optional(Type.Number({ minimum: 0.1 })),
    }),
    replay: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) =>
        outcomeText(
          await held.scroll({ direction: args.direction, ref: args.ref, pages: args.pages }),
        ),
      ),
  }),
  browserTool({
    name: "browser_wait",
    description:
      "Wait for the page to load, for text to appear or disappear, or for a delay in milliseconds.",
    parameters: on({
      for: Type.Union([Type.Literal("loaded"), Type.Literal("text"), Type.Literal("delay")]),
      text: Type.Optional(Type.String()),
      gone: Type.Optional(Type.Boolean({ description: "With text: wait for it to disappear." })),
      ms: Type.Optional(Type.Number({ minimum: 0 })),
    }),
    replay: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) =>
        outcomeText(
          await held.wait(
            args.for === "text"
              ? { kind: "text", text: args.text ?? "", present: args.gone !== true }
              : args.for === "delay"
                ? { kind: "delay", ms: args.ms ?? 1000 }
                : { kind: "loaded" },
          ),
        ),
      ),
  }),
  browserTool({
    name: "browser_console",
    description: "Read the page's console, newest first.",
    parameters: on({
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      clear: Type.Optional(Type.Boolean()),
    }),
    replay: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) => {
        const entries = await held.console({ limit: args.limit, clear: args.clear });

        return entries.length === 0
          ? "The console is empty."
          : entries.map((entry) => `[${entry.level}] ${entry.text}`).join("\n");
      }),
  }),
  capture,
  browserTool({
    name: "browser_evaluate",
    description: "Evaluate a JavaScript expression in the page; with a ref, the node is `this`.",
    parameters: on({ expression: Type.String(), ref: Type.Optional(ref) }),
    replay: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) => {
        const result = await held.evaluate(args.expression, { ref: args.ref });

        return result.kind === "value" ? JSON.stringify(result.value) : `Threw: ${result.message}`;
      }),
  }),
];

/**
 * Adds the browser tools to every session; a session whose workspace has no
 * browser answers each call with why.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "browser-tools",
  contribute: { tools: browserTools },
} satisfies Plugin;
