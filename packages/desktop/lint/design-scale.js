/**
 * Desktop design-scale rules for oxlint's JS plugin runtime.
 *
 * Colour, type, radius, shadow, and motion are themed, so they live in
 * `theme/tokens.css` behind typed handles, and `no-raw-colors` keeps a literal
 * colour from landing in a component where no appearance can reach it.
 * Spacing and sizing are not themed:
 * a gap is the same 6px in every appearance, and naming it `space.x6` would
 * add indirection without adding meaning. So the scale is enforced here
 * instead of being wrapped in tokens, and only values that carry a structural
 * decision — a traffic-light lane, a row height, a panel width — get a name in
 * `theme/schema.stylex.ts`.
 *
 * Every rule reads `create` and `stylex.create` calls only. `defineConsts` and
 * `defineVars` are where named measurements and palette handles belong,
 * `keyframes` describes motion rather than layout, and a number outside a
 * style object is an index, a duration, or a measurement. None of those sit on
 * a layout grid.
 */

/**
 * Steps in px. Skipping 14 and 18 keeps near-duplicates from reappearing. The
 * step stays at 2px through the range a dense row uses, then widens where a
 * 4px difference stops being a decision.
 */
const SPACING_SCALE = [0, 1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80];

const SPACING_PROPERTIES = new Set([
  "padding",
  "paddingInline",
  "paddingBlock",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingInlineStart",
  "paddingInlineEnd",
  "paddingBlockStart",
  "paddingBlockEnd",
  "margin",
  "marginInline",
  "marginBlock",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginInlineStart",
  "marginInlineEnd",
  "marginBlockStart",
  "marginBlockEnd",
  "gap",
  "rowGap",
  "columnGap",
]);

const SIZE_PROPERTIES = new Set([
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "inlineSize",
  "blockSize",
]);

/** A rule, a hairline, and a text caret are strokes rather than boxes. */
const HAIRLINE_SIZES = new Set([1, 1.5]);

const SCHEMA_PATH = "src/renderer/src/theme/schema.stylex.ts";
const VARS_PATH = "src/renderer/src/theme/vars.stylex.ts";
const TOKENS_PATH = "src/renderer/src/theme/tokens.css";

/**
 * A mask's stops are an opacity ramp written in colour syntax: the black and
 * the transparent pick how much of the layer survives, not what anything
 * looks like. Theming them would change coverage, not colour.
 */
const MASK_PROPERTIES = new Set(["mask", "maskImage", "WebkitMaskImage"]);

/** The CSS named colours. `transparent` and `currentColor` are not here. */
const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow " +
    "yellowgreen"
  ).split(" "),
);

/**
 * `color()` and `color-mix()` share a prefix, and only the second one is
 * allowed, so the boundary after the name has to be part of the match.
 */
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)?/i;
const HEX_COLOR = /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/i;

/**
 * The literal colour inside a value, or null. Words are matched whole so a
 * font family or an animation name cannot read as `tan` or `linen`.
 *
 * `color-mix()` is left to compose: every colour it takes is a handle, a
 * keyword, or another mix, and each of those is judged on its own below.
 */
const literalColor = (text) => {
  const hex = HEX_COLOR.exec(text);
  if (hex) return hex[0];
  const fn = COLOR_FUNCTION.exec(text);
  if (fn) return fn[0];
  for (const word of text.split(/[^A-Za-z]+/)) {
    if (NAMED_COLORS.has(word.toLowerCase())) return word;
  }
  return null;
};

/**
 * A value reaches the rule as a string or as a template with handles spliced
 * in, and only the literal parts of the template are the author's decision.
 */
const styleText = (node) => {
  if (node.type === "Literal" && typeof node.value === "string") return [node.value];
  if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.cooked ?? "");
  return [];
};

/** A condition, pseudo-selector, or at-rule key names a state, not a property. */
const isCondition = (key) =>
  key === "default" || key.startsWith(":") || key.startsWith("@") || key.startsWith("[");

const isLengthProperty = (key) => SPACING_PROPERTIES.has(key) || SIZE_PROPERTIES.has(key);

/**
 * Both call forms are in use: `stylex.create` and a bare `create` from a named
 * import. Tracking the bindings keeps the rules from enforcing the scale on
 * half the renderer while the other half drifts.
 */
const createBindings = () => {
  const namespaces = new Set();
  const creators = new Set();
  return {
    collect(node) {
      if (node.source.value !== "@stylexjs/stylex") return;
      for (const specifier of node.specifiers) {
        if (
          specifier.type === "ImportNamespaceSpecifier" ||
          specifier.type === "ImportDefaultSpecifier"
        ) {
          namespaces.add(specifier.local.name);
        } else if (specifier.imported?.name === "create") {
          creators.add(specifier.local.name);
        }
      }
    },
    isCreateCall(node) {
      if (node.callee.type === "Identifier") return creators.has(node.callee.name);
      return (
        node.callee.type === "MemberExpression" &&
        !node.callee.computed &&
        node.callee.property.type === "Identifier" &&
        node.callee.property.name === "create" &&
        node.callee.object.type === "Identifier" &&
        namespaces.has(node.callee.object.name)
      );
    },
  };
};

const keyName = (key, computed) => {
  if (computed) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
};

/**
 * A shorthand string carries the same lengths as the numeric form, so
 * `padding: "5px 10px"` is read as two values. Anything computed — `calc()`,
 * `min()`, a percentage, a custom property — is a different decision and is
 * left alone.
 */
const stringLengths = (text) => {
  const lengths = [];
  for (const part of text.trim().split(/\s+/)) {
    if (part === "0") {
      lengths.push(0);
      continue;
    }
    const match = /^(-?\d+(?:\.\d+)?)px$/.exec(part);
    if (!match) return null;
    lengths.push(Number(match[1]));
  }
  return lengths;
};

/** `gap: 6`, `marginTop: -4`, `padding: "5px 10px"`, and `{ default: 6 }`. */
const lengthValues = (node) => {
  if (node.type === "Literal" && typeof node.value === "number") return [node.value];
  if (node.type === "Literal" && typeof node.value === "string") return stringLengths(node.value);
  if (node.type === "UnaryExpression" && node.operator === "-") {
    const inner = lengthValues(node.argument);
    return inner === null ? null : inner.map((value) => -value);
  }
  return null;
};

const nearestSteps = (value) => {
  const below = [...SPACING_SCALE].reverse().find((step) => step < value);
  const above = SPACING_SCALE.find((step) => step > value);
  return [below, above].filter((step) => step !== undefined);
};

/** Past the top of the scale a step is not the answer; a named token is. */
const spacingAdvice = (value) => {
  const magnitude = Math.abs(value);
  const steps = nearestSteps(magnitude);
  const top = SPACING_SCALE[SPACING_SCALE.length - 1];
  if (steps.length === 0 || magnitude > top) {
    return `Name it in ${SCHEMA_PATH} and reference that token; the scale stops at ${top}`;
  }
  const signed = steps.map((step) => (value < 0 ? -step : step));
  return (
    `Use ${signed.join(" or ")} (scale: ${SPACING_SCALE.join(" ")}). If the value is a ` +
    `structural decision rather than a step, name it in ${SCHEMA_PATH} and reference that token`
  );
};

/**
 * Walks one style object and hands every leaf to `visit` with the property
 * that governs it. Conditions and pseudo-selectors nest below their property,
 * so the governing name is the deepest ancestor key `governs` accepts. The
 * style names directly under `create` are not properties, which is why the
 * caller starts a level down: a style called `gap` must not govern anything.
 */
const eachStyleValue = (node, visit, property, governs) => {
  if (node.type === "ArrowFunctionExpression") {
    const body =
      node.body.type === "BlockStatement"
        ? node.body.body.find((statement) => statement.type === "ReturnStatement")?.argument
        : node.body;
    if (body) eachStyleValue(body, visit, property, governs);
    return;
  }
  if (node.type !== "ObjectExpression") return;
  for (const member of node.properties) {
    if (member.type !== "Property") continue;
    const key = keyName(member.key, member.computed);
    const governing = key !== null && governs(key) ? key : property;
    if (
      member.value.type === "ObjectExpression" ||
      member.value.type === "ArrowFunctionExpression"
    ) {
      eachStyleValue(member.value, visit, governing, governs);
      continue;
    }
    if (governing === undefined) continue;
    visit(governing, member.value, member);
  }
};

/** Collect the import bindings, then read the style objects of each create call. */
const eachCreatedStyle = (governs, visit) => {
  const bindings = createBindings();
  return {
    ImportDeclaration(node) {
      bindings.collect(node);
    },
    CallExpression(node) {
      if (!bindings.isCreateCall(node) || node.arguments[0]?.type !== "ObjectExpression") return;
      for (const style of node.arguments[0].properties) {
        if (style.type !== "Property") continue;
        eachStyleValue(style.value, visit, undefined, governs);
      }
    },
  };
};

/** A length rule: every leaf that reads as px, against its governing property. */
const styleValueRule = (description, report) => ({
  meta: { docs: { description } },
  create(context) {
    return eachCreatedStyle(isLengthProperty, (property, value, member) => {
      const values = lengthValues(value);
      if (values === null) return;
      for (const length of values) report(context, property, length, member);
    });
  },
});

const spacingScale = styleValueRule(
  "Keep StyleX spacing on the desktop spacing scale.",
  (context, property, value, member) => {
    if (!SPACING_PROPERTIES.has(property)) return;
    if (SPACING_SCALE.includes(Math.abs(value))) return;
    context.report({
      node: member,
      message: `"${property}: ${value}" is off the desktop spacing scale. ${spacingAdvice(value)}.`,
    });
  },
);

const sizeGrid = styleValueRule(
  "Keep StyleX box sizes on the 2px grid.",
  (context, property, value, member) => {
    if (!SIZE_PROPERTIES.has(property)) return;
    const size = Math.abs(value);
    if (HAIRLINE_SIZES.has(size) || size % 2 === 0) return;
    context.report({
      node: member,
      message:
        `"${property}: ${value}" is off the 2px sizing grid. Use ${Math.floor(size / 2) * 2} ` +
        `or ${Math.ceil(size / 2) * 2}. A row height, panel width, or other named ` +
        `measurement belongs in ${SCHEMA_PATH}.`,
    });
  },
);

/**
 * Every colour in the renderer is themed, so a literal one is unreachable from
 * an appearance. The value has to come from a handle in `vars.stylex.ts`,
 * which is where `tokens.css` surfaces the palette.
 */
const noRawColors = {
  meta: { docs: { description: "Keep literal colors out of StyleX styles." } },
  create(context) {
    return eachCreatedStyle(
      (key) => !isCondition(key),
      (property, value, member) => {
        if (MASK_PROPERTIES.has(property)) return;
        for (const text of styleText(value)) {
          const color = literalColor(text);
          if (color === null) continue;
          context.report({
            node: member,
            message:
              `"${property}" carries the literal color "${color}", which no appearance can ` +
              `reach. Use a handle from ${VARS_PATH} — t.textPrimary, t.bgElevated, ` +
              `t.strokeSecondary, t.fillGhostHover, and the rest of that map. If the color is ` +
              `new, add it to ${TOKENS_PATH} for every appearance and expose a handle there. ` +
              `transparent, currentColor, and color-mix() over existing handles are allowed.`,
          });
          return;
        }
      },
    );
  },
};

export default {
  meta: { name: "nyte-design" },
  rules: { "spacing-scale": spacingScale, "size-grid": sizeGrid, "no-raw-colors": noRawColors },
};
