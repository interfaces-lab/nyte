import "core-js/actual/typed-array/from-base64";
import "core-js/actual/typed-array/to-base64";
import { getRandomValues, randomUUID } from "expo-crypto";

if (globalThis.crypto === undefined)
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues, randomUUID },
  });

if (typeof AbortSignal.prototype.throwIfAborted !== "function")
  Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
    configurable: true,
    value(this: AbortSignal) {
      if (this.aborted) throw this.reason ?? new DOMException("Aborted", "AbortError");
    },
  });
