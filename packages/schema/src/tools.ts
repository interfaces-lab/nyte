import type { BlobId, PartId, SessionId } from "./ids.ts";
import type { Json } from "./primitives.ts";

/**
 * Returns what a tool call does, declared by `ToolDefinition.class`, not
 * guessed from the name.
 *
 * **Details**
 *
 * - `shell`: `description` is what a wrapper plugin had the model say it does.
 * - `delegate`: a subagent call; `role` is which adapter.
 *
 * @category parts
 * @since 0.1.0
 */
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

/**
 * Returns one piece of tool content: text or a file.
 *
 * **Details**
 *
 * The model filters files by `ModelInfo.input`, as for `UserContent`.
 *
 * @category tools
 * @since 0.1.0
 */
export type ToolContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly blob: BlobId; readonly mime: string; readonly name?: string };

/**
 * Returns how a tool call settled.
 *
 * **Outcomes**
 *
 * - `ok`: the call returned; `content` is what the model reads.
 * - `failed`: the tool threw or returned invalid output; the model sees `message`.
 * - `interrupted`: replay never and the host died mid-call; it may have partially run. The model is told exactly that.
 * - `rejected`: `before_tool` said no; it never ran.
 * - `stopped`: the run was stopped during the call.
 *
 * @category tools
 * @since 0.1.0
 */
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

/**
 * Returns a tool's progress report, drawn on its part.
 *
 * @category tools
 * @since 0.1.0
 */
export type ToolProgress = {
  /** One line, replaces the previous. Sent as a patch; never logged. */
  readonly text?: string;
  /** 0..1 when known. */
  readonly fraction?: number;
  /** For a renderer that knows the tool. */
  readonly detail?: Json;
};

/**
 * Returns what a tool call produced: content for the model, typed output for
 * clients, and parts to show.
 *
 * @category tools
 * @since 0.1.0
 */
export type ToolResult<Output> = {
  /** What the model reads: text, files (an image a read returned, a screenshot). One shape; text is `{ kind: "text" }`. */
  readonly content: readonly ToolContent[];
  /** Validated against `ToolDefinition.output`; what clients and codemode read. */
  readonly output?: Output;
  /** Parts this call created and wants shown with it. */
  readonly parts?: readonly PartId[];
};
