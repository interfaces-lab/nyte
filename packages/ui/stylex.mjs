import unplugin from "@stylexjs/unplugin";

const COMPONENT_SOURCE = /[\\/]packages[\\/]ui[\\/]src[\\/]/;

/** `create` rules start here; below sit variables, themes, constants, and keyframes. */
const ATOMIC_PRIORITY = 1000;

/** Above the highest component priority bucket, a pseudo-element under an at-rule. */
const APP_OFFSET = 10_000;

/**
 * StyleX sees a `defineConsts` key only as `var(--hash)` and prices it as a
 * plain property (3000) rather than the at-rule it stands for, which also
 * lifts the rule a specificity level. Every const key in this codebase is a
 * media query, so each leading `var(--hash){` wrapper is repriced as `@media`
 * (200): `[media.hover]` then sorts exactly like the literal query.
 */
const CONST_KEY_OVERPRICE = 3000 - 200;

const CONST_WRAPPERS = /^(?:var\(--[\w-]+\)\{)*/;

function nyteStylexOrder({ types }) {
  return {
    name: "nyte-stylex-order",
    post(file) {
      const rules = file.metadata.stylex;

      if (!Array.isArray(rules)) return;

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
};
