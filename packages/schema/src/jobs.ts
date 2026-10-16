import type { JobId, SessionId } from "./ids.ts";

export type JobView = {
  readonly id: JobId;
  readonly command: string;
  readonly title: string;
  readonly session: SessionId | null;
  readonly pty: { readonly columns: number; readonly rows: number; readonly shell: string } | null;
  readonly state: JobState;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly tail: string;
};

export type JobState =
  | { readonly kind: "running" }
  | { readonly kind: "exited"; readonly code: number | null; readonly reason: EndReason }
  | { readonly kind: "lost" };

export type JobEnd = Extract<JobState, { readonly kind: "exited" | "lost" }>;

export type EndReason = "exited" | "terminated" | "expired" | "host-lost";

export type OutputFrame =
  | { readonly kind: "bytes"; readonly data: Uint8Array }
  | { readonly kind: "gap" }
  | { readonly kind: "exit"; readonly code: number | null };
