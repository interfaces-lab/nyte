import "../test/window-bridge.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import type { ReactElement, ReactNode } from "react";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import "../src/theme/tokens.stylex.ts";
import explain from "./fixtures/assistant-explain.md?raw";
import review from "./fixtures/assistant-review.md?raw";
import simd from "./fixtures/simd.md?raw";

declare global {
  interface Window {
    readonly benchCase: unknown;
  }
}

export const FIXTURES = [
  { name: "assistant-review", markdown: review },
  { name: "assistant-explain", markdown: explain },
  { name: "simd", markdown: simd },
] as const;

export const SIMD = simd;

export const STEP_CHARS = 32;

const RUNS = 5;

const client = new QueryClient();

applyDisplayMode("light");

export function Page({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

/** The case `bench/run.ts` wrote into the page's setup script. */
export function readCase<T extends TSchema>(schema: T): Static<T> {
  return Value.Parse(schema, window.benchCase);
}

export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** One warmup run, then the measured runs. */
export async function measure<T>(once: () => Promise<T>): Promise<T[]> {
  await once();
  const runs: T[] = [];

  for (let run = 0; run < RUNS; run += 1) runs.push(await once());

  return runs;
}
