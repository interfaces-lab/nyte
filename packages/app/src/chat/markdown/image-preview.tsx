import { Icon } from "@nyte-ai/ui/icon";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { imageViewer } from "../../theme/schema.stylex.ts";
import { ImageViewer } from "../images/image-viewer.tsx";

const styles = create({
  frame: { position: "relative", display: "inline-flex", borderRadius: radius.control },
  box: {
    width: imageViewer.thumbnailSize,
    height: imageViewer.thumbnailSize,
    borderRadius: radius.control,
  },
  compact: { width: imageViewer.thumbnailCompactSize, height: imageViewer.thumbnailCompactSize },
  thumbnail: { display: "block", objectFit: "cover" },
  placeholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: role.fillTertiary,
    color: role.contentTertiary,
  },
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
          {...props(styles.box, styles.thumbnail, input.compact && styles.compact)}
        />
      </span>
    </ImageViewer>
  );
}

export function ImagePlaceholder(input: {
  readonly name: string;
  readonly failed: boolean;
  readonly compact?: boolean;
}): ReactElement {
  return (
    <span {...props(styles.frame, hairline.controlRing)}>
      <span
        role={input.failed ? "img" : undefined}
        aria-label={input.failed ? `${input.name} failed to load` : undefined}
        aria-hidden={input.failed ? undefined : true}
        {...props(styles.box, styles.placeholder, input.compact && styles.compact)}
      >
        {input.failed && <Icon name="warning" size={input.compact === true ? "xs" : "md"} />}
      </span>
    </span>
  );
}
