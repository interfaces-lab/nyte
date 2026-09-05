import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ToolCallView } from "./src/conversation/tool-call.tsx";
import patch from "./diff-qa-patch.json";

createRoot(document.getElementById("root")!).render(
  createElement(
    StrictMode,
    {},
    createElement(ToolCallView, {
      part: {
        kind: "tool",
        callId: "test",
        toolName: "edit",
        args: { path: "packages/desktop/src/renderer/src/session-actions.test.ts" },
        result: { commit: "test", output: "Edited", isError: false, details: { patch } },
      },
      progress: undefined,
      cwd: undefined,
      density: "balanced",
    }),
  ),
);
