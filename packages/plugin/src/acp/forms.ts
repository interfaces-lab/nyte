import type {
  CreateElicitationResponse,
  ElicitationContentValue,
} from "@agentclientprotocol/sdk/unstable";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { QuestionAnswers, QuestionInfo } from "../question/schema.ts";

const optionalText = Type.Optional(Type.Union([Type.String(), Type.Null()]));

const choice = Type.Object({
  const: Type.String(),
  title: Type.String(),
  description: optionalText,
});

const choiceLists = {
  enum: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  oneOf: Type.Optional(Type.Union([Type.Array(choice), Type.Null()])),
  anyOf: Type.Optional(Type.Union([Type.Array(choice), Type.Null()])),
};

const formField = Type.Object({
  type: Type.String(),
  title: optionalText,
  description: optionalText,
  ...choiceLists,
  items: Type.Optional(Type.Object(choiceLists)),
});

export const formRequest = Type.Object({
  sessionId: Type.Optional(Type.String()),
  mode: Type.Literal("form"),
  message: Type.String(),
  requestedSchema: Type.Object({
    title: optionalText,
    properties: Type.Optional(Type.Record(Type.String(), formField)),
  }),
});

export type FormRequest = Static<typeof formRequest>;

export interface AgentForm {
  readonly questions: readonly QuestionInfo[];
  respond(answers: QuestionAnswers): CreateElicitationResponse;
}

type FormField = Static<typeof formField>;

type Choice = Static<typeof choice>;

type AnswerKind = "choice" | "choices" | "text" | "number" | "yes-no";

interface FormQuestion {
  readonly key: string;
  readonly expects: AnswerKind;
  readonly choices: readonly Choice[];
  readonly otherChoice: Choice | undefined;
  readonly companionKey: string | undefined;
  readonly question: QuestionInfo;
}

const COMPANION_KEY = /^(?<base>.+?)(?:__other|_other|_custom)$/u;

const OTHER_CHOICE = /^other$/iu;

const HEADER_LIMIT = 30;

const CONFIRM: QuestionInfo["options"] = [
  { label: "Continue", description: "Accept and carry on." },
  { label: "Decline", description: "Say no to this request." },
];

export function readForm(request: FormRequest): AgentForm {
  const schema = request.requestedSchema;
  const fields = Object.entries(schema.properties ?? {});
  const keys = new Set(fields.map(([key]) => key));

  const companionByKey = new Map(
    fields.flatMap(([key, field]) => {
      const base = COMPANION_KEY.exec(key)?.groups?.base;

      return field.type === "string" && base !== undefined && keys.has(base)
        ? [[base, key] as const]
        : [];
    }),
  );

  const companionKeys = new Set(companionByKey.values());

  const asked = fields
    .filter(([key]) => !companionKeys.has(key))
    .map(([key, field]) => askField(key, field, request.message, companionByKey.get(key)));

  if (asked.length === 0) {
    return {
      questions: [
        {
          header: clipHeader(schema.title ?? "Continue"),
          question: request.message,
          options: CONFIRM,
        },
      ],
      respond: (answers) => ({ action: answers[0]?.[0] === "Continue" ? "accept" : "decline" }),
    };
  }

  return {
    questions: asked.map((entry) => entry.question),
    respond: (answers) => ({
      action: "accept",
      content: Object.fromEntries(
        asked.flatMap((entry, index) => encodeAnswer(entry, answers[index] ?? [])),
      ),
    }),
  };
}

function askField(
  key: string,
  field: FormField,
  message: string,
  companionKey: string | undefined,
): FormQuestion {
  const title = field.title ?? key;
  const description = field.description ?? title;
  const offered = listChoices(field);
  const otherChoice = offered.find(
    (entry) => OTHER_CHOICE.test(entry.const) || OTHER_CHOICE.test(entry.title),
  );
  const choices = offered.filter((entry) => entry !== otherChoice);
  const expects = answerKind(field, choices.length > 0);

  const options =
    expects === "yes-no"
      ? [
          { label: "Yes", description: "" },
          { label: "No", description: "" },
        ]
      : choices.map((entry) => ({ label: entry.title, description: entry.description ?? "" }));

  return {
    key,
    expects,
    choices,
    otherChoice,
    companionKey,
    question: {
      header: clipHeader(title),
      question: description.trim() === "" ? message : description,
      options,
      multiple: expects === "choices" ? true : undefined,
    },
  };
}

function answerKind(field: FormField, hasChoices: boolean): AnswerKind {
  if (field.type === "array") return "choices";

  if (field.type === "boolean") return "yes-no";

  if (field.type === "number" || field.type === "integer") return "number";

  return hasChoices ? "choice" : "text";
}

function listChoices(field: FormField): readonly Choice[] {
  const source = field.items ?? field;

  return (
    source.anyOf ??
    source.oneOf ??
    (source.enum ?? []).map((value) => ({ const: value, title: value }))
  );
}

function encodeAnswer(
  asked: FormQuestion,
  labels: readonly string[],
): (readonly [string, ElicitationContentValue])[] {
  const first = labels[0];

  if (first === undefined) return [];
  const findChoice = (label: string) => asked.choices.find((entry) => entry.title === label);

  switch (asked.expects) {
    case "yes-no":
      return [[asked.key, first === "Yes"]];
    case "number": {
      const value = Number(first);

      return Number.isFinite(value) ? [[asked.key, value]] : [];
    }
    case "text":
      return [[asked.key, first]];
    case "choices":
      return [[asked.key, labels.map((label) => findChoice(label)?.const ?? label)]];
    case "choice": {
      const picked = findChoice(first);

      if (picked !== undefined) return [[asked.key, picked.const]];

      if (asked.companionKey === undefined) return [[asked.key, first]];

      return [
        ...(asked.otherChoice === undefined ? [] : [[asked.key, asked.otherChoice.const] as const]),
        [asked.companionKey, first],
      ];
    }
    default: {
      const exhaustive: never = asked.expects;

      return exhaustive;
    }
  }
}

function clipHeader(title: string): string {
  const trimmed = title.trim() === "" ? "Question" : title.trim();

  return trimmed.length <= HEADER_LIMIT ? trimmed : `${trimmed.slice(0, HEADER_LIMIT - 1)}…`;
}
