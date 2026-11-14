import { nyte } from "../../contract/nyte.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { mentionFileAt } from "../../data/files.ts";
import type { ComposerFile } from "../../references/composer-file-drop.ts";
import type { MessageReference } from "../../references/message-references.ts";
import type { ComposerImageAttachment } from "../../panes/session-view-state.ts";

const INLINE_IMAGE_TYPE_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["bmp", "image/bmp"],
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set(INLINE_IMAGE_TYPE_BY_EXTENSION.values());

type ComposerFileIntake =
  | { readonly kind: "image"; readonly file: File; readonly mimeType: string }
  | { readonly kind: "reference"; readonly reference: MessageReference }
  | { readonly kind: "unreachable"; readonly name: string };

function inlineImageType(file: File): string | undefined {
  const type = file.type.toLowerCase();

  if (type !== "" && type !== "application/octet-stream") {
    return INLINE_IMAGE_TYPES.has(type) ? type : undefined;
  }

  const dot = file.name.lastIndexOf(".");

  if (dot <= 0) return undefined;

  return INLINE_IMAGE_TYPE_BY_EXTENSION.get(file.name.slice(dot + 1).toLowerCase());
}

function classifyComposerFile(entry: ComposerFile): ComposerFileIntake {
  const file = entry.file;
  const mimeType = entry.kind === "file" ? inlineImageType(file) : undefined;

  if (mimeType !== undefined) return { kind: "image", file, mimeType };
  const path = nyte.host.pathForFile(file);

  if (path === "") return { kind: "unreachable", name: file.name };

  return {
    kind: "reference",
    reference: { kind: "file", file: mentionFileAt(path, entry.kind) },
  };
}

function readImageAttachment(args: {
  readonly file: File;
  readonly mimeType: string;
}): Promise<ComposerImageAttachment> {
  const { file, mimeType } = args;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        const result = reader.result;

        if (result === null || result instanceof ArrayBuffer) {
          reject(new Error(`Could not read ${file.name}`));

          return;
        }

        const [header = "", ...payload] = result.split(";base64,");

        if (!header.startsWith("data:") || payload.length === 0) {
          reject(new Error(`Could not encode ${file.name}`));

          return;
        }

        const data = payload.join(";base64,");
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          content: { type: "image", data, mimeType },
        });
      },
      { once: true },
    );
    reader.addEventListener("error", () => reject(new Error(`Could not read ${file.name}`)), {
      once: true,
    });
    reader.addEventListener(
      "abort",
      () => reject(new Error(`Reading ${file.name} was cancelled`)),
      {
        once: true,
      },
    );
    reader.readAsDataURL(file);
  });
}

export async function attachComposerFiles(args: {
  readonly files: readonly ComposerFile[];
  readonly editor: ComposerEditorHandle | null;
}): Promise<{
  readonly attachments: readonly ComposerImageAttachment[];
  readonly error: string | undefined;
}> {
  const intake = args.files.map(classifyComposerFile);

  for (const item of intake) {
    if (item.kind === "reference") args.editor?.insertReference(item.reference);
  }

  const images = intake.flatMap((item) => (item.kind === "image" ? [item] : []));
  const results = await Promise.allSettled(images.map(readImageAttachment));

  const attachments = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

  const unreachable = intake.flatMap((item) => (item.kind === "unreachable" ? [item.name] : []));

  const error =
    attachments.length !== images.length
      ? "Some images could not be read."
      : unreachable.length > 0
        ? `Save ${unreachable.join(", ")} to disk, then attach ${unreachable.length === 1 ? "it" : "them"} again.`
        : undefined;

  return { attachments, error };
}

/** Files being read into a composer, and what the last read could not take. */
export interface Intake {
  readonly reads: number;
  readonly error: string | undefined;
}

export const NO_INTAKE: Intake = { reads: 0, error: undefined };

/** A read starts, reports what it could not take, settles however it ended, or the error is cleared. */
export type IntakeEvent =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly error: string | undefined }
  | { readonly kind: "settled" }
  | { readonly kind: "cleared" };

export function nextIntake(intake: Intake, event: IntakeEvent): Intake {
  switch (event.kind) {
    case "reading":
      return { ...intake, reads: intake.reads + 1 };
    case "read":
      return intake.error === event.error ? intake : { ...intake, error: event.error };
    case "settled":
      return { ...intake, reads: intake.reads - 1 };
    case "cleared":
      return intake.error === undefined ? intake : { ...intake, error: undefined };
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

/**
 * Reads `files` into a composer, the one intake the follow-up composer and the new-chat screen
 * share: `step` hears the read start, its error and its end, and `attach` gets the images it read,
 * unless `signal` aborted it first. Resolves the error.
 */
export async function takeFiles(input: {
  readonly files: readonly ComposerFile[];
  readonly editor: ComposerEditorHandle | null;
  readonly signal: AbortSignal | undefined;
  readonly step: (event: IntakeEvent) => void;
  readonly attach: (attachments: readonly ComposerImageAttachment[]) => void;
}): Promise<string | undefined> {
  input.step({ kind: "reading" });

  return attachComposerFiles({ files: input.files, editor: input.editor })
    .then((result) => {
      input.signal?.throwIfAborted();

      if (result.attachments.length > 0) input.attach(result.attachments);
      input.step({ kind: "read", error: result.error });

      return result.error;
    })
    .finally(() => input.step({ kind: "settled" }));
}
