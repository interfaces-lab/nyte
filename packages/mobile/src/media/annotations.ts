import { useSyncExternalStore } from "react";
import type { StagedImage } from "./attachments.ts";

export type AnnotationPoint = {
  n: number;
  x: number;
  y: number;
  comment: string;
};

type ImageAnnotation = {
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

export function resolveAttachment(staged: StagedImage) {
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
