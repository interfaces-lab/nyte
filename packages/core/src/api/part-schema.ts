import type {
  ActionSchemas,
  Part,
  PartActions,
  PartDefinition,
  PartState,
} from "../contract/parts.ts";
import { matchesOutput } from "../util/json-schema.ts";

type Answer<K extends PartDefinition> = NonNullable<Awaited<ReturnType<Part<K>["answer"]>>>;

/** The schemas of the action `name` that `definition` declares; undefined when it declares none by that name. */
export function findAction(
  definition: Pick<PartDefinition, "actions"> | null,
  name: string,
): ActionSchemas[string] | undefined {
  return definition !== null && Object.hasOwn(definition.actions, name)
    ? definition.actions[name]
    : undefined;
}

/** Whether `value` fits `kind`'s state schema; a part opened without its definition takes any state. */
export function fitsState<K extends PartDefinition, T>(
  kind: K | null,
  value: T,
): value is T & PartState<K> {
  return kind === null || matchesOutput(kind.state, value);
}

/** Whether `answer`'s input fits the input schema of the action it names; a part opened without its definition takes any answer. */
export function fitsAnswer<
  K extends PartDefinition,
  A extends { readonly action: PropertyKey; readonly input: unknown },
>(kind: K | null, answer: A): answer is A & Answer<K> {
  if (kind === null) return true;
  const spec = findAction(kind, String(answer.action));

  return spec !== undefined && matchesOutput(spec.input, answer.input);
}

/**
 * Whether `value` fits the output schema `action` declares in `declared`, which defaults to `kind`. An action
 * with no output schema, or a null `declared`, returns nothing.
 */
export function fitsActionOutput<K extends PartDefinition, A extends keyof PartActions<K>>(
  kind: K | null,
  action: A,
  value: unknown,
  declared: Pick<PartDefinition, "actions"> | null = kind,
): value is PartActions<K>[A]["output"] {
  const output = findAction(declared, String(action))?.output;

  return output === undefined ? value === undefined : matchesOutput(output, value);
}
