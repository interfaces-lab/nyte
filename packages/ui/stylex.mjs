/**
 * `@stylexjs/unplugin` for every build that compiles `@nyte-ai/ui` from source.
 *
 * Development and production emit the same stylesheet: rules are collected at
 * compile time and served as one layered sheet, never injected at runtime.
 * Runtime injection keys some at-rules by their condition alone, so it drops
 * every rule after the first under a condition like
 * `(hover: hover) and (pointer: fine)`; an extracted sheet keeps them all, and
 * an uncompilable declaration fails the transform instead of vanishing.
 *
 * The published build ships component rules in a `nyte-ui` layer below the
 * app's, so an app style always beats a component style. A source build
 * compiles both in one StyleX pass, where two rules for one property at one
 * priority are ordered by their declaration text. This restores the published
 * order after StyleX has compiled each file:
 *
 * - Component classes take the `nyte` prefix, as in the published build, so a
 *   component never shares an atomic class with the app.
 * - App rules rise above every component priority, into later layers.
 *
 * StyleX's own `classNamePrefix` cannot do the first: it also names the
 * constants the app reads from `@nyte-ai/ui`, which would then resolve to
 * nothing in app rules.
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
        for (const rule of atomic) rule[2] += APP_OFFSET;
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

function withOrder(options = {}) {
  const babelConfig = options.babelConfig ?? {};

  return {
    runtimeInjection: false,
    propertyValidationMode: "throw",
    ...options,
    babelConfig: { ...babelConfig, plugins: [...(babelConfig.plugins ?? []), nyteStylexOrder] },
  };
}

/**
 * Holds the development stylesheet until the server has transformed the
 * modules the page requested, so a cold start does not paint with a partial
 * sheet and then swap.
 */
const settledStylesheet = {
  name: "nyte-stylex-settled-stylesheet",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.startsWith("/virtual:stylex.css") !== true) return next();
      void server.waitForRequestsIdle().then(() => next(), next);
    });
  },
};

export const stylex = {
  vite: (options) => [settledStylesheet, unplugin.vite(withOrder(options))],
  rollup: (options) => unplugin.rollup(withOrder(options)),
};
