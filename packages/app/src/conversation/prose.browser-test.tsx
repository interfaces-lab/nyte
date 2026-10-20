import "../../test/window-bridge.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../theme/tokens.stylex.ts";
import { Prose } from "./prose.tsx";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const painted = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await painted();
  }
}

const ANSWER = "The test **fails** because `sum` subtracts.\n\nFix the operator and rerun.";

const OPEN_DIAGRAM = "Flow:\n\n```mermaid\ngraph TD\n  A --> B\n";

const DIAGRAM = `${OPEN_DIAGRAM}\`\`\`\n`;

export async function run(): Promise<string> {
  applyDisplayMode("light");
  const host = document.createElement("div");
  host.style.width = "640px";
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();

  const draw = (markdown: string, streaming: boolean): void =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <Prose markdown={markdown} streaming={streaming} />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

  try {
    draw(ANSWER, true);
    await until(() => host.textContent?.includes("rerun.") === true, "the streamed answer");
    const paragraph = host.querySelector("p");
    draw(ANSWER, false);
    await painted();
    check(paragraph?.isConnected === true, "Settling keeps the streamed paragraph mounted");
    check(host.textContent?.includes("rerun.") === true, "The settled answer is whole");

    flushSync(() => root.render(null));
    draw(OPEN_DIAGRAM, true);
    await until(() => host.textContent?.includes("A --> B") === true, "the streamed fence");
    check(
      host.querySelector('[aria-label="Mermaid diagram"]') === null,
      "A streaming Mermaid fence draws as source",
    );
    draw(DIAGRAM, false);
    await painted();
    check(
      host.querySelector('[aria-label="Mermaid diagram"]') !== null ||
        host.textContent?.includes("A --> B") === true,
      "A settled Mermaid fence draws a diagram or its source",
    );

    return "passed";
  } finally {
    root.unmount();
    host.remove();
  }
}
