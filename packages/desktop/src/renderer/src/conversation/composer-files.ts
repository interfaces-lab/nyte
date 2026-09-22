/**
 * What the composer does with a file, whichever way it arrived: drop, paste,
 * or picker. Images a provider accepts ride inline as base64 image parts.
 * Every other file is referenced by path with the chip an `@` mention makes:
 * the file is already on disk, so the agent reads it from there.
 */
import type { ImageContent } from "@nyte-ai/schema";
import { nyte } from "../nyte.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { fileFromUrl } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";

export interface ComposerImageAttachment {
  readonly id: string;
  readonly name: string;
  readonly previewUrl: string;
  readonly content: ImageContent;
}

// BMP is accepted because the agent converts it to PNG before it reaches a
// provider; Chromium renders it in the attachment preview meanwhile.
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

/** A definite type decides; only an empty or generic one falls back to the extension. */
function inlineImageType(file: File): string | undefined {
  const type = file.type.toLowerCase();
  if (type !== "" && type !== "application/octet-stream") {
    return INLINE_IMAGE_TYPES.has(type) ? type : undefined;
  }
  const dot = file.name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return INLINE_IMAGE_TYPE_BY_EXTENSION.get(file.name.slice(dot + 1).toLowerCase());
}

function fileUrl(path: string): string {
  const url = new URL("file://");
  url.pathname = path.replace(/[%\\\n\r\t]/gu, encodeURIComponent);
  return url.href;
}

function classifyComposerFile(file: File): ComposerFileIntake {
  const mimeType = inlineImageType(file);
  if (mimeType !== undefined) return { kind: "image", file, mimeType };
  const path = nyte.host.pathForFile(file);
  const mention = path === "" ? undefined : fileFromUrl(fileUrl(path));
  if (mention === undefined) return { kind: "unreachable", name: file.name };
  return { kind: "reference", reference: { kind: "file", file: mention } };
}

function isTextFileReaderResult(result: FileReader["result"]): result is string {
  return typeof result === "string";
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
        if (!isTextFileReaderResult(result)) {
          reject(new Error(`Could not read ${file.name}`));
          return;
        }
        const marker = ";base64,";
        const markerIndex = result.indexOf(marker);
        if (!result.startsWith("data:") || markerIndex === -1) {
          reject(new Error(`Could not encode ${file.name}`));
          return;
        }
        const data = result.slice(markerIndex + marker.length);
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          previewUrl: `data:${mimeType};base64,${data}`,
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

/**
 * The one entry for files handed to a composer. Path references go straight
 * into the editor as chips; images resolve to attachments for the caller's
 * state. A file that is neither an image nor on disk (dragged out of a web
 * page, synthesized by the clipboard) has nothing to reference and is reported.
 */
export async function attachComposerFiles(args: {
  readonly files: readonly File[];
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
