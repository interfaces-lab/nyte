import type { OperationInput } from "@nyte-ai/protocol";
import { randomUUID } from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image } from "react-native";

export const MAX_ATTACHMENTS = 3;
// Three images leave room in the server's 1 MiB JSON body for text and the envelope.
const MAX_IMAGE_BASE64_LENGTH = 230 * 1024;
type MessagePart = Exclude<OperationInput<"messages.send">["content"], string>[number];

export type StagedImage = {
  readonly id: string;
  readonly uri: string;
  readonly image: Extract<MessagePart, { type: "image" }>;
};

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
            image: { type: "image", mimeType: "image/jpeg", data: result.base64 },
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
