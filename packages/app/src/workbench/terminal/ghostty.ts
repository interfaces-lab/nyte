import { loadEngine } from "@nyte-ai/vt";
import type { Engine } from "@nyte-ai/vt";
import wasmUrl from "@nyte-ai/vt/ghostty-vt.wasm?url";

let ghostty: Promise<Engine> | undefined;

async function fetchEngine(): Promise<Engine> {
  const response = await fetch(wasmUrl);

  if (!response.ok)
    throw new Error(`Couldn't load the terminal engine (${String(response.status)})`);

  return loadEngine(await response.arrayBuffer());
}

export function loadGhostty(): Promise<Engine> {
  ghostty ??= fetchEngine().catch((cause: unknown) => {
    ghostty = undefined;
    throw cause;
  });

  return ghostty;
}
