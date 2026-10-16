import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const request = Type.Object({ id: Type.Number(), patch: Type.String(), cacheKey: Type.String() });

export type PatchParseRequest = Static<typeof request>;

export interface PatchParseReply {
  readonly id: number;
  readonly files: readonly FileDiffMetadata[] | null;
}

function reply(message: PatchParseReply): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const { id, patch, cacheKey } = Value.Parse(request, event.data);

  try {
    reply({ id, files: parsePatchFiles(patch, cacheKey).flatMap((parsed) => parsed.files) });
  } catch {
    reply({ id, files: null });
  }
};
