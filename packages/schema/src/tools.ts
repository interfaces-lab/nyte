import type { BlobId, PartId, SessionId } from "./ids.ts";
import type { Json } from "./primitives.ts";

export type ToolClass =
  | { readonly kind: "read"; readonly path: string }
  | { readonly kind: "list"; readonly path: string }
  | { readonly kind: "edit"; readonly path: string }
  | { readonly kind: "shell"; readonly command: string; readonly description?: string }
  | {
      readonly kind: "delegate";
      readonly child: SessionId | null;
      readonly role: "task" | "create" | "send" | "await" | "read" | "stop";
      readonly title: string | null;
    }
  | { readonly kind: "custom"; readonly label: string };

export type ToolContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly blob: BlobId; readonly mime: string; readonly name?: string };

export type ToolOutcome =
  | {
      readonly kind: "ok";
      readonly content: readonly ToolContent[];
      readonly output: Json | null;
      readonly parts: readonly PartId[];
    }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "interrupted" }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "stopped" };

export type ToolProgress = {
  readonly text?: string;
  readonly fraction?: number;
  readonly detail?: Json;
};

export type ToolResult<Output> = {
  readonly content: readonly ToolContent[];
  readonly output?: Output;
  readonly parts?: readonly PartId[];
};
