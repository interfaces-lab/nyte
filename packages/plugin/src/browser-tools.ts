import { attachFile } from "@nyte-ai/core";
import type { BrowserApi, Page, ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { Infer, PageOutcome, PageSnapshot } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/core";
import { browserParameters } from "./browser/schema.ts";
import type { BrowserTool } from "./browser/schema.ts";

async function requireBrowser(invocation: ToolInvocation): Promise<BrowserApi> {
  const capability = await invocation.workspace.browser();

  if (capability.kind !== "available")
    throw new Error(`No browser is available here: ${capability.reason}`);

  return capability.api;
}

async function withPage<T>(
  invocation: ToolInvocation,
  id: string | undefined,
  operate: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await requireBrowser(invocation);
  const target = id ?? (await browser.list()).at(-1)?.id;

  if (target === undefined) throw new Error("No page is open. Call browser_open first.");
  await using held = await browser.adopt(asId(target));

  return operate(held);
}

function render(snapshot: PageSnapshot): string {
  return [
    `Revision ${snapshot.revision}`,
    ...snapshot.nodes.map(
      (node) =>
        `${"  ".repeat(node.depth)}[${node.ref}] ${node.role} "${node.name}"${node.editable ? " (editable)" : ""}`,
    ),
  ].join("\n");
}

function outcomeText(outcome: PageOutcome): string {
  if (outcome.kind === "applied") return render(outcome.snapshot);

  if (outcome.kind === "stale")
    return `The page changed (now revision ${outcome.revision}). Take a snapshot and try again.`;

  return outcome.kind === "refused"
    ? `Refused: ${outcome.reason}.`
    : `The page is closed: ${outcome.reason}.`;
}

function browserTool<T extends Exclude<BrowserTool, "browser_open" | "browser_capture">>(input: {
  readonly name: T;
  readonly description: string;
  readonly replay: "safe" | "never";
  readonly approval?: ToolDefinition["approval"];
  run(args: Infer<(typeof browserParameters)[T]>, invocation: ToolInvocation): Promise<string>;
}): ToolDefinition<Infer<(typeof browserParameters)[T]>> {
  return {
    name: input.name,
    description: input.description,
    parameters: browserParameters[input.name],
    class: () => ({ kind: "custom", label: input.name }),
    effects: "none",
    approval: input.approval,
    replay: input.replay,
    execute: async (args, invocation) => ({
      content: [{ kind: "text", text: await input.run(args, invocation) }],
    }),
  };
}

const open: ToolDefinition<{ url: string }> = {
  name: "browser_open",
  description: "Open a URL in a new browser page and return the page id and its snapshot.",
  parameters: browserParameters.browser_open,
  class: () => ({ kind: "custom", label: "browser_open" }),
  effects: "none",
  approval: "never",
  replay: "safe",
  async execute(args, invocation) {
    const opened = await (await requireBrowser(invocation)).open({ url: args.url });
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
  parameters: browserParameters.browser_capture,
  class: () => ({ kind: "custom", label: "browser_capture" }),
  effects: "none",
  approval: "never",
  replay: "safe",
  execute: (args, invocation) =>
    withPage(invocation, args.page, async (held) => {
      const image = await held.capture();

      try {
        return {
          content: [
            await attachFile(invocation.env.files, image.chunks(), {
              mime: image.mime ?? "image/png",
            }),
          ],
        };
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
    replay: "safe",
    approval: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) =>
        render(await held.snapshot({ ref: args.ref })),
      ),
  }),
  browserTool({
    name: "browser_click",
    description: "Click a node by its ref.",
    replay: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) =>
        outcomeText(await held.click({ ref: args.ref, button: args.button, double: args.double })),
      ),
  }),
  browserTool({
    name: "browser_type",
    description: "Type text into a node by its ref.",
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
    replay: "never",
    run: (args, invocation) =>
      withPage(invocation, args.page, async (held) =>
        outcomeText(await held.press({ key: args.key, ref: args.ref })),
      ),
  }),
  browserTool({
    name: "browser_scroll",
    description: "Scroll the page or a node.",
    replay: "never",
    approval: "never",
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
    replay: "never",
    approval: "never",
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
    replay: "never",
    approval: "never",
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
