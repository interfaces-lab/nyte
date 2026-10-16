import type { UserContent, Workspace } from "@nyte-ai/sdk";
import { randomUUID } from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image } from "react-native";

export const MAX_ATTACHMENTS = 3;

// Three images leave room in the server's 1 MiB JSON body for text and the envelope.
const MAX_IMAGE_BASE64_LENGTH = 230 * 1024;

export type DraftPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly mime: string; readonly data: string };

export type DraftContent = string | readonly DraftPart[];

export type StagedImage = {
  readonly id: string;
  readonly uri: string;
  readonly image: Extract<DraftPart, { kind: "image" }>;
};

export async function uploadDraft(
  workspace: Workspace,
  content: DraftContent,
): Promise<UserContent> {
  if (typeof content === "string" || content.every((part) => part.kind === "text"))
    return typeof content === "string"
      ? content
      : content.flatMap((part) => (part.kind === "text" ? [part] : []));
  const files = await workspace.files();

  if (files.kind !== "available") throw new Error(`Photos can't be sent here: ${files.reason}`);

  return Promise.all(
    content.map(async (part, index) =>
      part.kind === "text"
        ? part
        : {
            kind: "file" as const,
            blob: await files.api.upload(decodeBase64(part.data)),
            mime: part.mime,
            name: `photo-${String(index + 1)}.jpg`,
          },
    ),
  );
}

async function* decodeBase64(data: string): AsyncIterable<Uint8Array> {
  yield Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

/** Decode locally and re-encode once. Send retries reuse these exact JPEG bytes. */
export async function prepareImage(source: string): Promise<StagedImage> {
  const uri = source.startsWith("/") ? `file://${source}` : source;
  const { width, height } = await Image.getSize(uri);
  const context = ImageManipulator.manipulate(uri);

  try {
    for (const { edge, compress } of [
      { edge: 1280, compress: 0.7 },
      { edge: 960, compress: 0.55 },
      { edge: 768, compress: 0.45 },
    ]) {
      context.reset();

      if (Math.max(width, height) > edge) {
        context.resize(width >= height ? { width: edge } : { height: edge });
      }

      const rendered = await context.renderAsync();

      try {
        const result = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress,
          base64: true,
        });

        if (result.base64 !== undefined && result.base64.length <= MAX_IMAGE_BASE64_LENGTH) {
          return {
            id: randomUUID(),
            uri: result.uri,
            image: { kind: "image", mime: "image/jpeg", data: result.base64 },
          };
        }
      } finally {
        rendered.release();
      }
    }

    throw new Error("This photo is too large to attach. Choose a smaller image or crop it first.");
  } finally {
    context.release();
  }
}
