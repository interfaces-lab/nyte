/**
 * One setting's choices. The options and the words on screen are the same list,
 * so they cannot drift apart, and the first entry is the default, so a setting
 * cannot exist without one. Nothing here imports a native module, which keeps
 * the stored-value rule checkable in a plain test.
 */

export type Choice<Value extends string> = { readonly value: Value; readonly label: string };

/** Non-empty by construction: resolving always has a first choice to return. */
export type Choices<Value extends string> = readonly [Choice<Value>, ...Choice<Value>[]];

/**
 * A stored value is external input: an old build, a renamed option, or a
 * cleared key resolves to the default rather than to text the app cannot read.
 */
export function resolveChoice<Value extends string>(
  choices: Choices<Value>,
  stored: string | undefined,
): Choice<Value> {
  return choices.find((choice) => choice.value === stored) ?? choices[0];
}
