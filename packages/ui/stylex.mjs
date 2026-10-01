/**
 * `@stylexjs/unplugin` for every build that compiles `@nyte-ai/ui` from source.
 *
 * The published build ships component rules in a `nyte-ui` layer below the
 * app's, so an app style always beats a component style. A source build
 * compiles both in one StyleX pass, where two rules for one property at one
 * priority are ordered by their declaration text, and the outcome flips
 * between development and production. This restores the published order
 * after StyleX has compiled each file:
 *
 * - Component classes take the `nyte` prefix, as in the published build, so a
 *   component never shares an atomic class with the app.
 * - App rules rise above every component priority. With CSS layers that is a
 *   later layer; with runtime injection, a higher specificity level.
 *
 * StyleX's own `classNamePrefix` cannot do the first: it also names the
 * constants and variables the app reads from `@nyte-ai/ui`.
 */
import unplugin from "@stylexjs/unplugin";

const COMPONENT_SOURCE = /[\\/]packages[\\/]ui[\\/]src[\\/]/;

/** `create` rules start here; below sit variables, themes, constants, and keyframes. */
const ATOMIC_PRIORITY = 1000;

/** Above the highest component priority bucket, a pseudo-element under an at-rule. */
const APP_OFFSET = 10_000;

function nyteStylexOrder({ types }) {
  return {
    name: "nyte-stylex-order",
    post(file) {
      const rules = file.metadata.stylex;
      if (!Array.isArray(rules)) return;

      const atomic = rules.filter(
        ([name, rule, priority]) =>
          name.startsWith("x") && rule.constKey == null && priority >= ATOMIC_PRIORITY,
      );
      if (atomic.length === 0) return;

      if (COMPONENT_SOURCE.test(file.opts.filename ?? "")) {
        renameComponentClasses(file, atomic, types);
      } else {
        raiseAppPriorities(file, atomic, types);
      }
    },
  };
}

function renameComponentClasses(file, atomic, types) {
  const names = new Set(atomic.map(([name]) => name));
  const pattern = new RegExp(`\\b(?:${[...names].join("|")})\\b`, "g");
  const rename = (text) => text.replace(pattern, (name) => `nyte${name.slice(1)}`);

  for (const rule of atomic) {
    rule[0] = rename(rule[0]);
    rule[1].ltr = rename(rule[1].ltr);
    if (rule[1].rtl != null) rule[1].rtl = rename(rule[1].rtl);
  }

  file.path.traverse({
    StringLiteral(path) {
      const next = rename(path.node.value);
      if (next !== path.node.value) path.replaceWith(types.stringLiteral(next));
    },
  });
}

function raiseAppPriorities(file, atomic, types) {
  for (const rule of atomic) rule[2] += APP_OFFSET;

  // Runtime injection: each `inject({ ltr, priority })` call carries its own copy.
  file.path.traverse({
    ObjectExpression(path) {
      if (!path.parentPath.isCallExpression()) return;
      const properties = path.node.properties;
      if (!properties.some((property) => property.key?.name === "ltr")) return;

      for (const property of properties) {
        if (
          property.key?.name === "priority" &&
          property.value.type === "NumericLiteral" &&
          property.value.value >= ATOMIC_PRIORITY
        ) {
          property.value = types.numericLiteral(property.value.value + APP_OFFSET);
        }
      }
    },
  });
}

function withOrder(options = {}) {
  const babelConfig = options.babelConfig ?? {};

  return {
    ...options,
    babelConfig: { ...babelConfig, plugins: [...(babelConfig.plugins ?? []), nyteStylexOrder] },
  };
}

export const stylex = {
  vite: (options) => unplugin.vite(withOrder(options)),
  rollup: (options) => unplugin.rollup(withOrder(options)),
};
