import type { BlobId, CommitId, JobId, RunId, SessionId } from "./ids.ts";
import type { RunEnd } from "./runs.ts";

export type Delivery = "steer" | "queue" | "attach";

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
      | { readonly kind: "reference"; readonly path: string }
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
