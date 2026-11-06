import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { imageViewer } from "../../theme/schema.stylex.ts";
import { ImageViewer } from "../images/image-viewer.tsx";

const styles = create({
  frame: { position: "relative", display: "inline-flex", borderRadius: radius.control },
  thumbnail: {
    display: "block",
    width: imageViewer.thumbnailSize,
    height: imageViewer.thumbnailSize,
    objectFit: "cover",
    borderRadius: radius.control,
  },
  compact: { width: imageViewer.thumbnailCompactSize, height: imageViewer.thumbnailCompactSize },
});

export function ImagePreview(input: {
  readonly src: string;
  readonly name: string;
  readonly compact?: boolean;
}): ReactElement {
  return (
    <ImageViewer src={input.src} name={input.name}>
      <span {...props(styles.frame, hairline.controlRing)}>
        <img
          src={input.src}
          alt={input.name}
          {...props(styles.thumbnail, input.compact && styles.compact)}
        />
      </span>
    </ImageViewer>
  );
}
