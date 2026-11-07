import { useEffect, useRef, useState } from "react";
import { Value } from "typebox/value";
import { createFileStructure } from "./file-structure.ts";
import type { FileStructure } from "./file-structure.ts";
import { structureLanguage } from "./file-structure-profiles.ts";
import { structureResponse } from "./file-structure-protocol.ts";
import type { StructureRequest } from "./file-structure-protocol.ts";

export type FileStructureState =
  | { readonly kind: "inactive" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "pending" }
  | { readonly kind: "error"; readonly error: Error }
  | { readonly kind: "ready"; readonly value: FileStructure };

export function useFileStructure(input: {
  readonly language: string;
  readonly contents: string;
  readonly active: boolean;
}): FileStructureState {
  const language = structureLanguage(input.language);
  const worker = useRef<Worker | null>(null);
  const request = useRef<StructureRequest | undefined>(undefined);
  const generation = useRef(0);

  const [report, setReport] = useState<{
    readonly request: StructureRequest;
    readonly result: Extract<FileStructureState, { readonly kind: "ready" | "error" }>;
  }>();

  // oxlint-disable-next-line nyte-code/no-direct-effect -- owns the worker for the active supported document and releases it on language changes
  useEffect(() => {
    if (!input.active || language === undefined) return;

    const instance = new Worker(new URL("./file-structure.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.current = instance;

    const fail = (error: Error): void => {
      const current = request.current;

      if (current !== undefined) setReport({ request: current, result: { kind: "error", error } });
    };

    const receive = (event: MessageEvent<unknown>): void => {
      const message = event.data;

      if (!Value.Check(structureResponse, message)) {
        fail(new Error("Invalid file structure response."));

        return;
      }

      const current = request.current;

      if (
        current === undefined ||
        message.generation !== current.generation ||
        message.language !== current.language ||
        message.contents !== current.contents
      )
        return;
      setReport({
        request: current,
        result:
          message.kind === "ready"
            ? { kind: "ready", value: createFileStructure(message) }
            : { kind: "error", error: new Error(message.error) },
      });
    };

    const failed = (event: ErrorEvent): void => {
      fail(new Error(event.message || "File structure worker failed."));
    };

    instance.addEventListener("message", receive);
    instance.addEventListener("error", failed);

    return () => {
      instance.removeEventListener("message", receive);
      instance.removeEventListener("error", failed);
      instance.terminate();
      worker.current = null;
      request.current = undefined;
    };
  }, [input.active, language]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- sends the current source to the worker; render rejects earlier source results immediately
  useEffect(() => {
    if (!input.active || language === undefined || worker.current === null) return;
    generation.current += 1;
    const next = { language, contents: input.contents, generation: generation.current };
    request.current = next;
    worker.current.postMessage(next);
  }, [input.active, input.contents, language]);

  if (!input.active) return { kind: "inactive" };

  if (language === undefined) return { kind: "unsupported" };

  if (report?.request.contents !== input.contents || report.request.language !== language)
    return { kind: "pending" };

  return report.result;
}
