import { html } from "react-strict-dom";
import type { ComponentProps } from "react";
import type { StagedImage } from "./attachments.ts";
import { useAnnotation } from "./annotations.ts";

/** Attachment preview that swaps to the baked capture once markup is saved. */
export function AttachmentThumb({
  image,
  alt,
  style,
}: {
  image: StagedImage;
  alt: string;
  style: ComponentProps<typeof html.img>["style"];
}) {
  const source = useAnnotation(image.id)?.image.uri ?? image.uri;
  return <html.img src={source} alt={alt} style={style} />;
}
