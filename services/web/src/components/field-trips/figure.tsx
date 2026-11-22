import type { ReactNode } from "react";

interface PictureProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  size?: "icon" | "sheet";
  rounded?: boolean;
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

export function TripFeedback(props: { children: ReactNode }) {
  return (
    <div className="design-trip-feedback">
      <p className="design-trip-feedback-label">Feedback</p>
      {props.children}
    </div>
  );
}
