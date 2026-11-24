import unplugin from "@stylexjs/unplugin";

const COMPONENT_SOURCE = /[\\/]packages[\\/]ui[\\/]src[\\/]/;

const ATOMIC_PRIORITY = 1000;

const APP_OFFSET = 10_000;

const CONST_KEY_OVERPRICE = 3000 - 200;

const CONST_WRAPPERS = /^(?:var\(--[\w-]+\)\{)*/;

function assertAtRuleConsts(rules) {
  for (const [, rule] of rules) {
    if (rule.constKey == null) continue;
    const value = String(rule.constVal);

    if (!value.startsWith(":")) continue;

    throw new Error(
      `The defineConsts value "${value}" is a pseudo-class condition. ` +
        "StyleX orders a const key like the condition it stands for only when it is an at-rule; write this condition as a literal key.",
    );
  }
}

function nyteStylexOrder({ types }) {
  return {
    name: "nyte-stylex-order",
    post(file) {
      const rules = file.metadata.stylex;

      if (!Array.isArray(rules)) return;
      assertAtRuleConsts(rules);

      const atomic = rules.filter(
        ([name, rule, priority]) =>
          name.startsWith("x") &&
          rule.constKey == null &&
          priority - constWrappers(rule.ltr) * CONST_KEY_OVERPRICE >= ATOMIC_PRIORITY,
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

function constWrappers(ltr) {
  return ltr.match(CONST_WRAPPERS)[0].split("{").length - 1;
}

function renameComponentClasses(file, atomic, types) {
  const names = new Set(atomic.map(([name]) => name));
  const pattern = new RegExp(`\\b(?:${[...names].join("|")})\\b`, "g");
  const rename = (text) => text.replaceAll(pattern, (name) => `nyte${name.slice(1)}`);

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

function settledStylesheet(plugin) {
  let version = -1;
  let css = "";

  return {
    name: "nyte-stylex-settled-stylesheet",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith("/virtual:stylex.css") !== true) return next();

        void server
          .waitForRequestsIdle()
          .then(() => {
            const current = plugin.__stylexGetSharedStore().version;

            if (current !== version) {
              css = plugin.__stylexCollectCss();
              version = current;
            }

            response.setHeader("Content-Type", "text/css");
            response.setHeader("Cache-Control", "no-store");
            response.end(css);
          })
          .catch(next);
      });
    },
  };
}

function vite(options) {
  const plugin = unplugin.vite(withOrder(options));

  return [settledStylesheet(plugin), plugin];
}

export const stylex = {
  vite,
  rollup: (options) => unplugin.rollup(withOrder(options)),
  esbuild: (options) => unplugin.esbuild(withOrder(options)),
  webpack: (options) => unplugin.webpack(withOrder(options)),
};
