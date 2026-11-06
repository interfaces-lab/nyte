export type Choice<Value extends string> = { readonly value: Value; readonly label: string };

export type Choices<Value extends string> = readonly [Choice<Value>, ...Choice<Value>[]];

export function resolveChoice<Value extends string>(
  choices: Choices<Value>,
  stored: string | undefined,
): Choice<Value> {
  return choices.find((choice) => choice.value === stored) ?? choices[0];
}
