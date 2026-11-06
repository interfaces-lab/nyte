import { publishDeferred } from "../../lib/deferred.tsx";
import { ActivityPreview } from "./activity.tsx";
import { ChangesPreview } from "./changes.tsx";
import { ConversationPreview } from "./conversation.tsx";
import { FileEditorPreview } from "./file-editor.tsx";
import { TerminalPreview } from "./terminal.tsx";
import { TypographyPreview } from "./typography.tsx";
import { WindowPreview } from "./window.tsx";

export const previewsRuntime = {
  ActivityPreview,
  ConversationPreview,
  WindowPreview,
  TypographyPreview,
  FileEditorPreview,
  ChangesPreview,
  TerminalPreview,
};

publishDeferred("previews", previewsRuntime);
