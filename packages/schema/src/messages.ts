import type { BlobId, CommitId, JobId, RunId, SessionId } from "./ids.ts";
import type { RunEnd } from "./runs.ts";

export type Delivery = "steer" | "queue" | "attach";

/**
 * What a message says: text, or parts. A `file` is an attachment the client
 * uploaded. A `reference` mentions a workspace file by `path`; the host reads
 * it once when the message is sent and keeps that text as `blob`, so every
 * request shows the model the file as it was then (a folder, or a file it
 * cannot read, stays a bare mention). A `skill` asks the model to follow the
 * skill at `location`. Clients draw `reference` and `skill` as chips.
 */
export type UserContent =
  | string
  | readonly (
      | { readonly kind: "text"; readonly text: string }
      | {
          readonly kind: "file";
          readonly blob: BlobId;
          readonly mime: string;
          readonly name: string;
        }
      | { readonly kind: "reference"; readonly path: string; readonly blob?: BlobId }
      | { readonly kind: "skill"; readonly name: string; readonly location: string }
    )[];

export type Position =
  | { readonly kind: "start" }
  | { readonly kind: "commit"; readonly id: CommitId };

export type MessageSource =
  | { readonly kind: "user" }
  | { readonly kind: "child"; readonly session: SessionId; readonly end: RunEnd["kind"] }
  | { readonly kind: "job"; readonly job: JobId }
  | { readonly kind: "shell" }
  | { readonly kind: "action"; readonly label: string; readonly command?: string };

export type Schedule =
  | { readonly kind: "joined"; readonly run: RunId }
  | {
      readonly kind: "next-turn";
      readonly reason: "requested" | "idle" | "run-ended" | "configuration";
    }
  | { readonly kind: "attached" };
