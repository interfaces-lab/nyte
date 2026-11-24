import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  CreateElicitationResponse,
} from "@agentclientprotocol/sdk/unstable";
import { asId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { PluginApi, RuntimeScope } from "@nyte-ai/core";
import { question } from "../question/question.ts";
import { answerInput } from "../question/schema.ts";
import type { AgentForm } from "./forms.ts";

export async function askQuestion(
  api: PluginApi<"core">,
  form: AgentForm,
  scope: RuntimeScope,
  signal: AbortSignal,
): Promise<CreateElicitationResponse> {
  const part = await api.session.parts.create(question, {
    state: {
      call: asId<"call">(crypto.randomUUID()),
      questions: [...form.questions],
      phase: { kind: "asking" },
    },
    placement: { kind: "modal" },
    runtimeScope: scope,
  });

  try {
    const answer = await part.answer({ signal });

    if (answer?.action !== "answer") return { action: "decline" };
    const checked = await answerInput["~standard"].validate(answer.input);

    return checked.issues === undefined
      ? form.respond(checked.value.answers)
      : { action: "decline" };
  } finally {
    await part.close().catch(() => undefined);
  }
}

export async function askPermissionQuestion(
  api: PluginApi<"core">,
  request: RequestPermissionRequest,
  scope: RuntimeScope,
  signal: AbortSignal,
): Promise<RequestPermissionResponse> {
  const options = request.options;

  if (
    options.length === 0 ||
    new Set(options.map((option) => option.optionId)).size !== options.length ||
    options.some((option) => option.optionId.trim() === "")
  ) {
    return { outcome: { outcome: "cancelled" } };
  }
  const labels = options.map((option) => `${option.name} [${option.optionId}]`);

  const result = await askQuestion(
    api,
    {
      questions: [
        {
          header: "Question",
          question: request.toolCall.title ?? "Choose an option.",
          options: options.map((option, index) => ({
            label: labels[index] ?? option.optionId,
            description: "",
          })),
        },
      ],
      respond: (answers) => {
        const selected = labels.indexOf(answers[0]?.[0] ?? "");
        const option = options[selected];

        return option === undefined
          ? { action: "decline" }
          : { action: "accept", content: { selected: option.optionId } };
      },
    },
    scope,
    signal,
  );

  const selected =
    result.action === "accept"
      ? Value.Check(Type.Object({ selected: Type.String() }), result.content)
        ? result.content.selected
        : undefined
      : undefined;

  return typeof selected === "string"
    ? { outcome: { outcome: "selected", optionId: selected } }
    : { outcome: { outcome: "cancelled" } };
}
