import { Video } from "@remotion/media";
import type { CSSProperties } from "react";
import { Img, staticFile } from "remotion";
import type { Media } from "./media";

/** A part of a picture, in its pixels. */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const whole = (media: Media): Region => ({ x: 0, y: 0, width: media.width, height: media.height });

interface FrameProps {
  readonly media: Media;
  readonly width: number;
  readonly height: number;
  readonly region?: Region;
  /** How far the picture has pushed in on the region's centre: 1 is the region exactly covering the box. */
  readonly zoom?: number;
  /** The frame of a video it starts playing from. */
  readonly start?: number;
}

/** `region` of a picture covering a box, pushed in around its centre; a video plays muted from `start`. */
export function Frame({ media, width, height, region = whole(media), zoom = 1, start = 0 }: FrameProps) {
  const scale = Math.max(width / region.width, height / region.height) * zoom;
  const style: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: media.width,
    height: media.height,
    transformOrigin: "0 0",
    transform: `translate(${width / 2 - (region.x + region.width / 2) * scale}px, ${height / 2 - (region.y + region.height / 2) * scale}px) scale(${scale})`,
  };
  return (
    <div style={{ position: "relative", width, height, overflow: "hidden" }}>
      {media.video ? <Video src={staticFile(media.file)} trimBefore={start} muted style={style} /> : <Img src={staticFile(media.file)} style={style} />}
    </div>
  );
}
