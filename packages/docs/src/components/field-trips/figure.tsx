import type { ReactNode } from "react";

interface PictureProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** `icon` keeps a single icon at a size that reads as one, `sheet` lets a wide sheet use the column. */
  size?: "icon" | "sheet";
  /** A full-bleed square that the operating system would round: drawn with rounded corners. */
  rounded?: boolean;
  /** A sheet with its own paper colour: framed by a hairline so its edge reads in both themes. */
  framed?: boolean;
  children?: ReactNode;
}

export function TripFigure(props: PictureProps) {
  return (
    <figure className="design-trip-figure" data-size={props.size ?? "icon"}>
      <img
        src={props.src}
        alt={props.alt}
        width={props.width}
        height={props.height}
        loading="lazy"
        decoding="async"
        className="design-trip-image"
        data-rounded={props.rounded || undefined}
        data-framed={props.framed || undefined}
      />
      {props.children ? (
        <figcaption className="design-trip-caption">{props.children}</figcaption>
      ) : null}
    </figure>
  );
}

export function TripGallery(props: { size?: "small" | "large"; children: ReactNode }) {
  return (
    <div className="design-trip-gallery" data-size={props.size ?? "small"}>
      {props.children}
    </div>
  );
}

/** A clip that plays only when the reader starts it. */
export function TripVideo(props: {
  src: string;
  poster: string;
  width: number;
  height: number;
  label: string;
  children?: ReactNode;
}) {
  return (
    <figure className="design-trip-figure" data-size="sheet">
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- The clips have no sound and no speech. */}
      <video
        src={props.src}
        poster={props.poster}
        width={props.width}
        height={props.height}
        aria-label={props.label}
        controls
        muted
        loop
        playsInline
        preload="none"
        className="design-trip-image"
        data-framed
      />
      {props.children ? (
        <figcaption className="design-trip-caption">{props.children}</figcaption>
      ) : null}
    </figure>
  );
}

/** What the designer said in a round, in the page's words: the record keeps a summary, not quotes. */
export function TripFeedback(props: { children: ReactNode }) {
  return (
    <div className="design-trip-feedback">
      <p className="design-trip-feedback-label">Feedback</p>
      {props.children}
    </div>
  );
}
