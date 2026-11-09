import type { PartDefinition } from "@nyte-ai/core";
import { idSchema, standard } from "@nyte-ai/schema";
import type { Infer, PartId, PartView, SessionView } from "@nyte-ai/schema";
import { Type } from "typebox";

export const SECRET_TOOL = "request_secret";

export const SAVE_SECRET_COMMAND = "secret-save";

export const REMOVE_SECRET_COMMAND = "secret-remove";

export const SAVED_SECRETS = "secrets.saved";

const name = Type.String({
  pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
  maxLength: 128,
  description: "Such as ELEVENLABS_API_KEY; it names the file.",
});

const label = Type.String({
  minLength: 1,
  maxLength: 60,
  pattern: "\\S",
  description: "A title, such as ElevenLabs API key.",
});

const reason = Type.String({
  minLength: 1,
  pattern: "\\S",
  description: "What you need it for, in one sentence.",
});

const url = Type.String({
  pattern: "^https?://\\S+$",
  description: "A page where the user can get it.",
});

const days = Type.Union([
  Type.Literal(1),
  Type.Literal(3),
  Type.Literal(7),
  Type.Literal(30),
  Type.Null(),
]);

const expiresAt = Type.Union([Type.Number(), Type.Null()]);

export const SECRET_DIRECTORY = "^[0-9a-f]{32}$";

export const SavedSecretsType = Type.Record(
  Type.String({ pattern: SECRET_DIRECTORY }),
  Type.Object({ name, folder: idSchema<"workspace">(), path: Type.String(), expiresAt }),
);

export const savedSecrets = standard(SavedSecretsType);

export type SavedSecrets = Infer<typeof savedSecrets>;

export const saveInput = standard(Type.Object({ path: Type.String({ minLength: 1 }), expiresAt }));

const skipInput = standard(Type.Object({}));

const phase = Type.Union([
  Type.Object({ kind: Type.Literal("asking") }),
  Type.Object({ kind: Type.Literal("open"), head: idSchema<"head">() }),
  Type.Object({
    kind: Type.Literal("saved"),
    path: Type.String(),
    expiresAt,
    head: Type.Union([idSchema<"head">(), Type.Null()]),
  }),
  Type.Object({ kind: Type.Literal("skipped"), late: Type.Boolean() }),
]);

const state = standard(
  Type.Object({
    call: idSchema<"call">(),
    name,
    label,
    reason,
    url: Type.Union([url, Type.Null()]),
    phase,
  }),
);

export const secretParameters = standard(
  Type.Object({ name, label, reason, url: Type.Optional(url) }),
);

export const saveRequest = standard(
  Type.Object({ part: idSchema<"part">(), value: Type.String({ minLength: 1 }), days }),
);

export type SaveRequest = Infer<typeof saveRequest>;

export type SecretDays = SaveRequest["days"];

const actions = { save: { input: saveInput }, skip: { input: skipInput } };

export type SecretState = Infer<typeof state>;

export type SecretPhase = SecretState["phase"];

/**
 * A modal request for a secret. `save` records the file the save command wrote and `skip`
 * declines; the first of either holds across retries and restarts.
 *
 * @category plugins
 */
export const secret = {
  kind: "ask/secret",
  state,
  actions,
  fallback: (current, { id }) =>
    `Secret ${id}: ${current.label} (${current.name})\n${current.reason}${current.phase.kind === "saved" ? `\nSaved to ${current.phase.path}` : ""}`,
} satisfies PartDefinition<SecretState, typeof actions>;

export interface OpenSecretRequest {
  readonly part: PartId;
  readonly name: string;
  readonly label: string;
  readonly reason: string;
  readonly url: string | null;
  readonly late: boolean;
}

/**
 * Returns live secret requests that wait for the user, oldest first. Requests from a stopped run
 * and parts with invalid state are omitted.
 *
 * @category plugins
 */
export function openSecretRequests(
  view: Pick<SessionView, "parts"> | undefined,
): readonly OpenSecretRequest[] {
  return (view?.parts ?? []).flatMap((part) => {
    if (part.partKind !== secret.kind || part.status.kind !== "live") return [];
    const read = readSecret(part);

    if (read === null || (read.phase.kind !== "asking" && read.phase.kind !== "open")) return [];

    return [
      {
        part: part.id,
        name: read.name,
        label: read.label,
        reason: read.reason,
        url: read.url,
        late: read.phase.kind === "open",
      },
    ];
  });
}

export function readSecret(part: PartView): SecretState | null {
  const checked = secret.state["~standard"].validate(part.state);

  return checked instanceof Promise || checked.issues !== undefined ? null : checked.value;
}
