import { composerStory } from "./composer.tsx";
import type { Story } from "./story.tsx";

export const STORIES: readonly Story[] = [composerStory];

export function findStory(id: string): Story | null {
  return STORIES.find((story) => story.id === id) ?? null;
}
