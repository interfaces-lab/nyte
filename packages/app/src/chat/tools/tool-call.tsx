import type { ReactElement } from "react";
import { readMcpCall } from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { CODEMODE_TOOL } from "@nyte-ai/plugin/codemode/schema";
import { QUESTION_TOOL } from "@nyte-ai/plugin/question/schema";
import { SECRET_TOOL } from "@nyte-ai/plugin/secret/schema";
import { WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from "@nyte-ai/plugin/web/schema";
import type { ToolClass } from "@nyte-ai/sdk";
import type { ToolCallDensity } from "../../preferences/index.ts";
import { EditCallView } from "./edit-call.tsx";
import { McpCallView } from "./mcp-call.tsx";
import { QuestionCallView } from "./question-call.tsx";
import { ScriptCallView } from "./script-call.tsx";
import { SecretCallView } from "./secret-call.tsx";
import { ShellCallView } from "./shell-call.tsx";
import { SubagentLineView } from "./subagent-call.tsx";
import { ToolLineView } from "./tool-line.tsx";
import { FetchCallView, SearchCallView } from "./web-call.tsx";

export function ToolCallView({
  message,
  calls = [],
  cwd,
  density,
}: {
  message: ToolMessage;
  calls?: readonly ToolMessage[];
  cwd: string | undefined;
  density: ToolCallDensity;
}): ReactElement {
  const { state } = message;
  const toolClass = state.class;

  switch (toolClass.kind) {
    case "delegate":
      return <SubagentLineView toolClass={toolClass} message={message} />;
    case "shell":
      return <ShellCallView message={message} toolClass={toolClass} cwd={cwd} density={density} />;
    case "edit":
      return <EditCallView message={message} toolClass={toolClass} cwd={cwd} density={density} />;
    case "custom":
      return <CustomCallView message={message} toolClass={toolClass} calls={calls} cwd={cwd} />;
    case "read":
    case "list":
      return <ToolLineView message={message} toolClass={toolClass} cwd={cwd} />;
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
}

function CustomCallView({
  message,
  toolClass,
  calls,
  cwd,
}: {
  readonly message: ToolMessage;
  readonly toolClass: Extract<ToolClass, { readonly kind: "custom" }>;
  readonly calls: readonly ToolMessage[];
  readonly cwd: string | undefined;
}): ReactElement {
  const name = message.state.name;

  switch (name) {
    case QUESTION_TOOL:
      return <QuestionCallView message={message} toolClass={toolClass} cwd={cwd} />;
    case CODEMODE_TOOL:
      return <ScriptCallView message={message} calls={calls} />;
    case WEB_SEARCH_TOOL:
      return <SearchCallView message={message} />;
    case WEB_FETCH_TOOL:
      return <FetchCallView message={message} />;
    case SECRET_TOOL:
      return <SecretCallView message={message} />;
    default: {
      const mcp = readMcpCall(name, toolClass.label);

      return mcp === null ? (
        <ToolLineView message={message} toolClass={toolClass} cwd={cwd} />
      ) : (
        <McpCallView message={message} server={mcp.server} title={mcp.title} />
      );
    }
  }
}
