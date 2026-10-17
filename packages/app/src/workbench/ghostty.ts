import { Ghostty } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";

let ghostty: Promise<Ghostty> | undefined;

/** Compiles Ghostty's wasm once for every terminal; a failed load is forgotten so the next call retries. */
export function loadGhostty(): Promise<Ghostty> {
  ghostty ??= Ghostty.load(wasmUrl).catch((cause: unknown) => {
    ghostty = undefined;
    throw cause;
  });

  return ghostty;
}
