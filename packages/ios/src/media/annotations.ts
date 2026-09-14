import { useSyncExternalStore } from "react";
import type { StagedImage } from "./attachments.ts";

/**
 * A marked-up photo: the flattened capture of image + marks, plus the numbered
 * points that tell the agent where each comment lands. Points store relative
 * coordinates (0–1) so the note text stays readable without the image.
 */
export type AnnotationPoint = {
  n: number;
  x: number;
  y: number;
  comment: string;
};

export type ImageAnnotation = {
  image: StagedImage;
  points: AnnotationPoint[];
};

const store = new Map<string, ImageAnnotation>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function readAnnotation(imageId: string): ImageAnnotation | undefined {
  return store.get(imageId);
}

/** Subscribed views see the baked capture as soon as markup is saved. */
export function useAnnotation(imageId: string): ImageAnnotation | undefined {
  return useSyncExternalStore(subscribe, () => readAnnotation(imageId));
}

export function writeAnnotation(imageId: string, annotation: ImageAnnotation): void {
  store.set(imageId, annotation);
  notify();
}

export function clearAnnotation(imageId: string): void {
  if (store.delete(imageId)) notify();
}

/**
 * Resolve a staged image for sending: the annotated capture replaces the raw
 * photo, and numbered comments follow as text so the agent can locate them.
 */
export function resolveAttachment(staged: StagedImage): {
  image: StagedImage;
  note: string | undefined;
} {
  const annotation = readAnnotation(staged.id);
  if (annotation === undefined) return { image: staged, note: undefined };
  const note = annotation.points
    .filter((point) => point.comment.trim() !== "")
    .map(
      (point) =>
        `${String(point.n)}) at ${String(Math.round(point.x * 100))}%,${String(
          Math.round(point.y * 100),
        )}%: ${point.comment}`,
    )
    .join("\n");
  return { image: annotation.image, note: note === "" ? undefined : `Photo annotations:\n${note}` };
}
