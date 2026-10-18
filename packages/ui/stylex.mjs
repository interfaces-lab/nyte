import unplugin from "@stylexjs/unplugin";

const COMPONENT_SOURCE = /[\\/]packages[\\/]ui[\\/]src[\\/]/;

/** `create` rules start here; below sit variables, themes, constants, and keyframes. */
const ATOMIC_PRIORITY = 1000;

/** Above the highest component priority bucket, a pseudo-element under an at-rule. */
const APP_OFFSET = 10_000;

/**
 * StyleX sees a `defineConsts` key only as `var(--hash)` and prices it as a
 * plain property (3000) rather than the at-rule it stands for, which also
 * lifts the rule a specificity level. Each leading `var(--hash){` wrapper is
 * repriced as `@media` (200), so `[media.hover]` sorts exactly like the
 * literal query; `assertMediaConsts` fails the build on any other condition
 * const, whose key this would misprice.
 */
const CONST_KEY_OVERPRICE = 3000 - 200;

const CONST_WRAPPERS = /^(?:var\(--[\w-]+\)\{)*/;

/** A const value usable as a style key: an at-rule or a pseudo-class. */
const CONDITION = /^[@:]/;

/** Throw on a `defineConsts` condition other than `@media`, the only one the const-key repricing is right for. */
function assertMediaConsts(rules) {
  for (const [, rule] of rules) {
    if (rule.constKey == null) continue;
    const value = String(rule.constVal);

    if (!CONDITION.test(value) || value.startsWith("@media")) continue;

    throw new Error(
      `The defineConsts value "${value}" is a condition other than @media. ` +
        "nyte-stylex-order prices every const key as @media; write this condition as a literal key.",
    );
  }
}

function nyteStylexOrder({ types }) {
  return {
    name: "nyte-stylex-order",
    post(file) {
      const rules = file.metadata.stylex;

      if (!Array.isArray(rules)) return;
      assertMediaConsts(rules);

      for (const rule of rules) {
        const wrappers = rule[1].ltr.match(CONST_WRAPPERS)[0].split("{").length - 1;

        rule[2] -= wrappers * CONST_KEY_OVERPRICE;
      }

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
  esbuild: (options) => unplugin.esbuild(withOrder(options)),
  webpack: (options) => unplugin.webpack(withOrder(options)),
};
