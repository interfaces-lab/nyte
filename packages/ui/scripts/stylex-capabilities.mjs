/**
 * Compiles one minimal snippet per CSS feature with the installed StyleX babel
 * plugin and writes the results into this package's AGENTS.md as a dense
 * capability block. A feature passes only when the transform succeeds and the
 * emitted CSS is valid. `--check` exits 1 when the block is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const root = join(packageRoot, "../..");

const agentsPath = join(packageRoot, "AGENTS.md");

const require = createRequire(createRequire(import.meta.url).resolve("@stylexjs/unplugin"));

const babel = require("@babel/core");

const stylex = require("@stylexjs/babel-plugin");

const { version } = require("@stylexjs/babel-plugin/package.json");

const start = "<!-- STYLEX-CAPS:START -->";

const end = "<!-- STYLEX-CAPS:END -->";

const header = "import * as stylex from '@stylexjs/stylex';\n";

const create = (rule) => `${header}const s = stylex.create({ t: ${rule} });`;

const vars = (source) => [`${header}${source}`, "probe.stylex.ts"];

const groups = [
  [
    "AT-RULES",
    [
      ["@media", create("{ color: { default: 'red', '@media (max-width: 768px)': 'blue' } }")],
      ["(hover: hover)", create("{ color: { default: 'red', '@media (hover: hover)': 'blue' } }")],
      [
        "(prefers-reduced-motion)",
        create(
          "{ animationDuration: { default: '0.3s', '@media (prefers-reduced-motion: reduce)': '0.01s' } }",
        ),
      ],
      [
        "(prefers-color-scheme)",
        create("{ color: { default: 'black', '@media (prefers-color-scheme: dark)': 'white' } }"),
      ],
      [
        "(scripting)",
        create("{ display: { default: 'block', '@media (scripting: none)': 'none' } }"),
      ],
      [
        "@supports",
        create("{ display: { default: 'flex', '@supports (display: grid)': 'grid' } }"),
      ],
      [
        "@container",
        create("{ fontSize: { default: '14px', '@container (min-width: 400px)': '16px' } }"),
      ],
      [
        "@container (+named)",
        create(
          "{ fontSize: { default: '14px', '@container sidebar (min-width: 400px)': '16px' } }",
        ),
      ],
      ["@starting-style", create("{ opacity: 1, '@starting-style': { opacity: 0 } }")],
      [
        "@starting-style (transform)",
        create(
          "{ transform: 'translateX(0)', '@starting-style': { transform: 'translateX(100%)' } }",
        ),
      ],
      ["@scope", create("{ color: { default: 'red', '@scope (.card)': 'blue' } }")],
      ["@layer", create("{ '@layer': 'utilities', color: 'red' }")],
      [
        "@property (explicit)",
        create(
          "{ '@property --my-color': { syntax: '\"<color>\"', inherits: 'false', initialValue: 'red' } }",
        ),
      ],
    ],
  ],
  [
    "PSEUDO-CLS",
    [
      [":hover", create("{ color: { default: 'red', ':hover': 'blue' } }")],
      [":focus", create("{ color: { default: 'red', ':focus': 'blue' } }")],
      [
        ":focus-visible",
        create("{ outline: { default: 'none', ':focus-visible': '2px solid blue' } }"),
      ],
      [":focus-within", create("{ borderColor: { default: 'gray', ':focus-within': 'blue' } }")],
      [":active", create("{ color: { default: 'red', ':active': 'blue' } }")],
      [":disabled", create("{ opacity: { default: 1, ':disabled': 0.5 } }")],
      [":first-child", create("{ marginTop: { default: 8, ':first-child': 0 } }")],
      [":last-child", create("{ marginBottom: { default: 8, ':last-child': 0 } }")],
      [
        ":nth-child()",
        create("{ backgroundColor: { default: 'white', ':nth-child(even)': '#f5f5f5' } }"),
      ],
      [":where()", create("{ display: { default: 'none', ':where([open])': 'flex' } }")],
      [":is()", create("{ color: { default: 'red', ':is(:hover, :focus)': 'blue' } }")],
      [":has()", create("{ borderColor: { default: 'gray', ':has(:focus)': 'blue' } }")],
      [":not()", create("{ display: { default: 'block', ':not(:last-child)': 'block' } }")],
      [
        ":placeholder-shown",
        create("{ color: { default: 'black', ':placeholder-shown': 'gray' } }"),
      ],
      [":checked", create("{ backgroundColor: { default: 'white', ':checked': 'blue' } }")],
      [":empty", create("{ display: { default: 'block', ':empty': 'none' } }")],
      [":modal", create("{ backgroundColor: { default: 'white', ':modal': 'white' } }")],
      [":user-valid", create("{ borderColor: { default: 'gray', ':user-valid': 'green' } }")],
      [":user-invalid", create("{ borderColor: { default: 'gray', ':user-invalid': 'red' } }")],
    ],
  ],
  [
    "PSEUDO-EL",
    [
      ["::before", create("{ '::before': { content: '\"\"', display: 'block' } }")],
      ["::after", create("{ '::after': { content: '\"\"', display: 'block' } }")],
      ["::placeholder", create("{ '::placeholder': { color: 'gray', fontStyle: 'italic' } }")],
      ["::selection", create("{ '::selection': { backgroundColor: 'blue', color: 'white' } }")],
      ["::backdrop", create("{ '::backdrop': { backgroundColor: 'rgba(0,0,0,0.5)' } }")],
      ["::marker", create("{ '::marker': { color: 'blue' } }")],
      [
        "::file-selector-button",
        create("{ '::file-selector-button': { backgroundColor: 'blue', color: 'white' } }"),
      ],
      [
        "::view-transition-old/new",
        create(
          "{ '::view-transition-old(root)': { animationDuration: '0.3s' }, '::view-transition-new(root)': { animationDuration: '0.3s' } }",
        ),
      ],
    ],
  ],
  [
    "COMPOUND",
    [
      [
        "::backdrop+condition",
        create("{ '::backdrop': { opacity: { default: 0, ':where([data-open])::backdrop': 1 } } }"),
      ],
      [
        'RTL :is([dir="rtl"] *)',
        create(
          "{ transform: { default: 'translateX(-100%)', ':is([dir=\"rtl\"] *)': 'translateX(100%)' } }",
        ),
      ],
      [
        "nested @media+pseudo",
        create(
          "{ color: { default: 'red', ':hover': 'blue' }, '@media (hover: hover)': { color: { ':hover': 'green' } } }",
        ),
      ],
    ],
  ],
  [
    "VALUES",
    [
      ["var()", create("{ color: 'var(--color-accent)' }")],
      ["calc()", create("{ width: 'calc(100% - 32px)' }")],
      ["clamp()", create("{ fontSize: 'clamp(14px, 2vw, 18px)' }")],
      ["round()", create("{ width: 'round(33.3%, 1px)' }")],
      ["round(up, …)", create("{ width: 'round(up, 33.3%, 1px)' }")],
      ["light-dark()", create("{ color: 'light-dark(black, white)' }")],
      ["color-mix()", create("{ color: 'color-mix(in srgb, red 50%, blue)' }")],
      ["container-type", create("{ containerType: 'inline-size' }")],
      ["container-name", create("{ containerName: 'sidebar' }")],
      ["color-scheme", create("{ colorScheme: 'light dark' }")],
      ["accent-color", create("{ accentColor: 'blue' }")],
      ["textWrap:balance", create("{ textWrap: 'balance' }")],
      ["textWrap:pretty", create("{ textWrap: 'pretty' }")],
      ["fieldSizing:content", create("{ fieldSizing: 'content' }")],
      ["interpolateSize:allow-keywords", create("{ interpolateSize: 'allow-keywords' }")],
    ],
  ],
  [
    "ANIM",
    [
      ["transition shorthand", create("{ transition: 'opacity 0.3s ease' }")],
      [
        "transition longhands",
        create(
          "{ transitionProperty: 'opacity', transitionDuration: '0.3s', transitionTimingFunction: 'ease' }",
        ),
      ],
      ["transitionBehavior:allow-discrete", create("{ transitionBehavior: 'allow-discrete' }")],
      [
        "animation longhands",
        create(
          "{ animationName: 'spin', animationDuration: '1s', animationTimingFunction: 'linear', animationIterationCount: 'infinite' }",
        ),
      ],
      [
        "stylex.keyframes",
        `${header}const spin = stylex.keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } });
const s = stylex.create({ t: { animationName: spin } });`,
      ],
      [
        "stylex.viewTransitionClass()",
        `${header}const vtc = stylex.viewTransitionClass({ old: { opacity: 0 }, new: { opacity: 1 } });
const s = stylex.create({ t: { viewTransitionName: vtc } });`,
      ],
      ["animation shorthand", create("{ animation: 'spin 1s linear infinite' }")],
    ],
  ],
  [
    "WHEN (stylex.when.*)",
    [
      [
        "ancestor(':hover')",
        create("{ color: { default: 'red', [stylex.when.ancestor(':hover')]: 'blue' } }"),
      ],
      [
        "ancestor(':focus-within')",
        create(
          "{ borderColor: { default: 'gray', [stylex.when.ancestor(':focus-within')]: 'blue' } }",
        ),
      ],
      [
        "ancestor(':active')",
        create(
          "{ transform: { default: 'none', [stylex.when.ancestor(':active')]: 'scale(0.98)' } }",
        ),
      ],
      [
        "ancestor(':disabled')",
        create("{ opacity: { default: 1, [stylex.when.ancestor(':disabled')]: 0.5 } }"),
      ],
      [
        "ancestor('[data-attr]')",
        create("{ color: { default: 'red', [stylex.when.ancestor('[data-selected]')]: 'blue' } }"),
      ],
      [
        "ancestor(…)+@media",
        create(
          "{ color: { default: 'red', [stylex.when.ancestor(':hover')]: { '@media (hover: hover)': 'blue' } } }",
        ),
      ],
      [
        "descendant(':hover')",
        create("{ color: { default: 'red', [stylex.when.descendant(':hover')]: 'blue' } }"),
      ],
      [
        "siblingBefore(':checked')",
        create("{ color: { default: 'red', [stylex.when.siblingBefore(':checked')]: 'blue' } }"),
      ],
      [
        "siblingAfter(':checked')",
        create("{ color: { default: 'red', [stylex.when.siblingAfter(':checked')]: 'blue' } }"),
      ],
      [
        "anySibling(':hover')",
        create("{ opacity: { default: 1, [stylex.when.anySibling(':hover')]: 0.5 } }"),
      ],
      [
        "defineMarker() scoped ancestor",
        ...vars(`export const row = stylex.defineMarker();
export const s = stylex.create({ t: { opacity: { default: 1, [stylex.when.ancestor(':hover', row)]: 0.5 } } });`),
      ],
    ],
  ],
  ["NESTING", [["CSS nesting with &", create("{ color: 'red', '& .child': { color: 'blue' } }")]]],
  [
    "API",
    [
      ["stylex.firstThatWorks()", create("{ display: stylex.firstThatWorks('grid', 'flex') }")],
      [
        "stylex.positionTry()",
        `${header}const pt = stylex.positionTry({ insetBlockStart: 'anchor(end)' });
const s = stylex.create({ t: { positionTryFallbacks: pt } });`,
      ],
      [
        "stylex.types.color()",
        ...vars("export const v = stylex.defineVars({ c: stylex.types.color('blue') });"),
      ],
      [
        "stylex.types.length()",
        ...vars("export const v = stylex.defineVars({ l: stylex.types.length('16px') });"),
      ],
      [
        "stylex.defineConsts()",
        ...vars(
          "export const c = stylex.defineConsts({ maxWidth: '1200px', headerHeight: '64px' });",
        ),
      ],
    ],
  ],
  [
    "DYNAMIC",
    [
      [
        "functions in stylex.create",
        `${header}const s = stylex.create({ w: (w) => ({ width: w }) });`,
      ],
    ],
  ],
  [
    "VARS",
    [
      ["stylex.defineVars", ...vars("export const v = stylex.defineVars({ primary: 'blue' });")],
      [
        "stylex.createTheme (require .stylex.ts files)",
        ...vars(`export const v = stylex.defineVars({ primary: 'blue' });
export const theme = stylex.createTheme(v, { primary: 'red' });`),
      ],
    ],
  ],
  [
    "ANCHOR",
    [
      ["anchorName", create("{ anchorName: '--trigger' }")],
      ["positionAnchor", create("{ positionAnchor: '--trigger' }")],
      ["anchor()", create("{ top: 'anchor(--trigger bottom)' }")],
    ],
  ],
  [
    "LAYOUT",
    [
      ["grid", create("{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }")],
      ["flex+gap", create("{ display: 'flex', gap: 16 }")],
      ["aspect-ratio", create("{ aspectRatio: '16 / 9' }")],
      ["overscrollBehavior", create("{ overscrollBehavior: 'contain' }")],
      ["scrollbarGutter", create("{ scrollbarGutter: 'stable' }")],
      ["scrollbarWidth", create("{ scrollbarWidth: 'thin' }")],
      ["scrollbarColor", create("{ scrollbarColor: 'gray transparent' }")],
      [
        "logical props",
        create(
          "{ paddingInline: 16, paddingBlock: 8, insetInlineStart: 0, marginInlineStart: 'auto', borderInlineStartWidth: 1 }",
        ),
      ],
    ],
  ],
];

const invalidOutput = [/@layer\{[^}]*\{@layer:/, /@property[^{]*\{\.x[a-z0-9]+/];

function probe(code, filename) {
  try {
    const { metadata } = babel.transformSync(code, {
      filename: join(packageRoot, "src", filename),
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] },
      plugins: [
        [
          stylex,
          {
            dev: false,
            runtimeInjection: false,
            propertyValidationMode: "throw",
            unstable_moduleResolution: { type: "commonJS", rootDir: root },
          },
        ],
      ],
    });

    const css = (metadata.stylex ?? []).map(([, { ltr }]) => ltr).join("\n");

    return invalidOutput.some((pattern) => pattern.test(css))
      ? "compiles but invalid CSS output"
      : undefined;
  } catch (error) {
    return `rejected: ${String(error.message).split("\n")[0].split(": ").at(-1).replace(/\.$/, "")}`;
  }
}

const results = groups.map(([label, probes]) => [
  label,
  probes.map(([name, code, filename = "probe.tsx"]) => ({ name, failure: probe(code, filename) })),
]);

const lines = results.flatMap(([label, probes]) => {
  const verdicts = Map.groupBy(probes, (entry) => entry.failure);

  return [...verdicts].map(
    ([failure, entries]) =>
      `|${label}: ${entries.map((entry) => entry.name).join(", ")} — ${failure === undefined ? "YES" : `NO (${failure})`}`,
  );
});

const block = [
  start,
  "",
  `[StyleX v${version} CSS Support]|Use CSS-native solutions. Don't build JS workarounds for supported features.`,
  ...lines,
  "|PATTERN: hover on touch -> @media (hover: hover) guard",
  "|PATTERN: dialog/popover entry -> @starting-style + transitionBehavior:allow-discrete (not useState+rAF)",
  "|PATTERN: parent state -> child style -> stylex.when.ancestor(':hover', marker) with stylex.defineMarker() from a .stylex.ts file (not CSS nesting). The ancestor MUST include marker in its stylex.props() call. Prefer a component-scoped defineMarker() over defaultMarker(), which leaks state from outer containers",
  "|PATTERN: container responsive -> @container (not ResizeObserver)",
  "|PATTERN: zebra striping -> :nth-child(even) (not index%2 JS)",
  "|PATTERN: CSS fallback values -> stylex.firstThatWorks() (not manual fallback)",
  "|PATTERN: dynamic/runtime values -> stylex.create({ s: (value) => ({ prop: value }) }) (not inline styles)",
  "|PATTERN: conditional styles -> stylex.props(condition && styles.x) (not className toggling)",
  "|VERIFY: pnpm --dir packages/ui check:stylex",
  "",
  end,
].join("\n");

const current = readFileSync(agentsPath, "utf8");

const existing = new RegExp(`${RegExp.escape(start)}[\\s\\S]*?${RegExp.escape(end)}`);

const next = existing.test(current)
  ? current.replace(existing, () => block)
  : `${current.endsWith("\n") ? current : `${current}\n`}\n${block}\n`;

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error(
      "StyleX capability block in packages/ui/AGENTS.md is stale. Run: pnpm --dir packages/ui sync:stylex",
    );
    process.exit(1);
  }
} else {
  for (const [label, probes] of results) {
    for (const entry of probes) {
      if (entry.failure !== undefined) console.log(`NO ${label} ${entry.name}: ${entry.failure}`);
    }
  }

  if (next !== current) writeFileSync(agentsPath, next);
}
