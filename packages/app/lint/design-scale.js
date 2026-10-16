
import { Type } from "typebox";
import { Value } from "typebox/value";

const stringLiteral = Type.Object({ type: Type.Literal("Literal"), value: Type.String() });

const numberLiteral = Type.Object({ type: Type.Literal("Literal"), value: Type.Number() });

const SPACE_STEPS = new Map([
  [1, "px"],
  [2, "s0_5"],
  [4, "s1"],
  [6, "s1_5"],
  [8, "s2"],
  [10, "s2_5"],
  [12, "s3"],
  [16, "s4"],
  [20, "s5"],
  [24, "s6"],
  [32, "s8"],
]);

const BOX_HANDLES = [
  [14, "glyph.sm"],
  [15, "glyph.box"],
  [16, "glyph.md"],
  [16, "button.height2xs"],
  [16, "checkbox.sizeMd"],
  [20, "glyph.lg"],
  [20, "button.heightXs"],
  [20, "avatar.xs"],
  [24, "button.heightSm"],
  [24, "target.min"],
  [24, "avatar.sm"],
  [28, "button.heightMd"],
  [28, "input.heightMd"],
  [28, "row.heightMd"],
  [28, "menu.itemHeight"],
  [28, "avatar.md"],
  [32, "button.heightLg"],
  [32, "input.heightLg"],
  [32, "row.heightLg"],
  [36, "button.heightXl"],
  [36, "input.heightXl"],
  [36, "avatar.lg"],
];

const boxHandlesAt = (px) => BOX_HANDLES.flatMap(([size, handle]) => (size === px ? [handle] : []));

const either = (items) =>
  items.length < 3
    ? items.join(" or ")
    : `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;

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

const SCHEMA_PATH = "packages/ui/src/styles/schema.stylex.ts";

const DESKTOP_SCHEMA_PATH = "packages/app/src/theme/schema.stylex.ts";

const SCHEMA_MODULE = "@nyte-ai/ui/styles/schema.stylex";

const VARS_MODULE = "@nyte-ai/ui/styles/vars.stylex";

const VARS_PATH = "packages/ui/src/styles/vars.stylex.ts";

const TOKENS_PATH = "packages/ui/src/styles/tokens.stylex.ts";

const ROLES_PATH = "packages/ui/src/styles/roles.stylex.ts";

const DESKTOP_TOKENS_PATH = "packages/app/src/theme/tokens.stylex.ts";

const colorHandles = (property) => {
  if (property.startsWith("background")) {
    return "a background role such as role.bgBase, role.bgElevated, or role.bgHover";
  }

  if (property.startsWith("border") || property.startsWith("outline")) {
    return "a border role such as role.borderPrimary, role.borderSecondary, or role.borderStrong";
  }

  if (property === "boxShadow") {
    return "shadow.shadowSm, shadow.shadowLg, or role.borderPrimary inside an inset ring";
  }

  return "a content role such as role.contentPrimary, role.contentSecondary, or role.contentTertiary";
};

const touchHandles = (property) => {
  if (/gap$/i.test(property)) return ["target.gap", "button.gapMd"];

  if (property.startsWith("padding")) {
    if (/Block|Top|Bottom/.test(property)) return ["menu.itemPaddingBlock"];

    if (/Inline|Left|Right/.test(property)) return ["button.paddingInlineMd"];

    return ["button.paddingInlineMd", "menu.itemPaddingBlock"];
  }

  if (property.startsWith("margin")) return ["target.gap"];

  return ["target.min", "button.heightMd", "row.heightMd"];
};

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
  if (Value.Check(stringLiteral, node)) return [node.value];

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

  if (Value.Check(stringLiteral, key)) return key.value;

  return null;
};

const stringLengths = (text) => {
  if (text.includes("(")) return null;
  const lengths = [];

  for (const part of text.trim().split(/\s+/)) {
    if (part === "0") {
      lengths.push(0);
      continue;
    }

    const match = /^(-?\d+(?:\.\d+)?)px$/.exec(part);

    if (match) lengths.push(Number(match[1]));
  }

  return lengths;
};

/** `gap: 6`, `marginTop: -4`, `padding: "5px 10px"`, and `{ default: 6 }`. */
const lengthValues = (node) => {
  if (Value.Check(numberLiteral, node)) return [node.value];

  if (Value.Check(stringLiteral, node)) return stringLengths(node.value);

  if (node.type === "UnaryExpression" && node.operator === "-") {
    const inner = lengthValues(node.argument);

    return inner === null ? null : inner.map((value) => -value);
  }

  return null;
};

const spaceHandle = (px, negative) =>
  negative ? `calc(\${space.${SPACE_STEPS.get(px)}} * -1)` : `space.${SPACE_STEPS.get(px)}`;

const spacingMessage = (property, value) => {
  const magnitude = Math.abs(value);
  const negative = value < 0;
  const written = `"${property}: ${value}"`;

  if (SPACE_STEPS.has(magnitude)) {
    return (
      `${written} is a raw length: the space scale owns spacing. ` +
      `Use ${spaceHandle(magnitude, negative)} from ${SCHEMA_MODULE}.`
    );
  }

  const steps = [...SPACE_STEPS.keys()];
  const top = steps[steps.length - 1];

  if (magnitude > top) {
    return (
      `${written} is past the space scale, which stops at space.s8 (${top}). Use the named ` +
      `measurement for this layout from ${SCHEMA_MODULE} or ${DESKTOP_SCHEMA_PATH}. Name a ` +
      `new one in ${SCHEMA_PATH}, or the desktop schema for desktop layout, only if the ` +
      `design calls for this length.`
    );
  }

  const nearest = [
    steps.findLast((step) => step < magnitude),
    steps.find((step) => step > magnitude),
  ].flatMap((step) =>
    step === undefined ? [] : [`${spaceHandle(step, negative)} (${negative ? -step : step})`],
  );

  return (
    `${written} is off the space scale, which owns spacing. Use ${nearest.join(" or ")} ` +
    `from ${SCHEMA_MODULE}. Name a measurement in ${SCHEMA_PATH}, or ${DESKTOP_SCHEMA_PATH} ` +
    `for desktop layout, only if the design calls for a structural value rather than a step.`
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
  "Write StyleX padding, margin, and gap with the space handles.",
  (context, property, value, member) => {
    if (!SPACING_PROPERTIES.has(property) || value === 0) return;
    context.report({
      node: member,
      message: spacingMessage(property, value),
    });
  },
);

const sizeGrid = styleValueRule(
  "Keep StyleX box sizes on the 2px grid.",
  (context, property, value, member) => {
    if (!SIZE_PROPERTIES.has(property)) return;
    const size = Math.abs(value);

    if (HAIRLINE_SIZES.has(size) || size % 2 === 0) return;
    const named = boxHandlesAt(size).map((handle) => `${handle} (${size}) from ${SCHEMA_MODULE}`);
    context.report({
      node: member,
      message:
        `"${property}: ${value}" is off the 2px sizing grid, so an odd box centres even ` +
        `content on a half pixel. Use ${either([Math.floor(size / 2) * 2, Math.ceil(size / 2) * 2, ...named])}. ` +
        `Name an odd size in ${SCHEMA_PATH}, or ${DESKTOP_SCHEMA_PATH} for desktop layout, ` +
        `only if the design calls for one.`,
    });
  },
);

/**
 * Every colour in the renderer is themed, so a literal one is unreachable from
 * an appearance or a scope. The value has to come from a handle in
 * `vars.stylex.ts`, which is where the tokens surface.
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
              `"${property}" uses the literal color "${color}": the roles own color, so dark ` +
              `mode and appearances never reach a literal. Use ${colorHandles(property)} from ` +
              `${VARS_MODULE}; transparent, currentColor, and color-mix() over handles also ` +
              `pass. Add a role to ${ROLES_PATH} with a handle in ${VARS_PATH} only if the ` +
              `design calls for a new color.`,
          });

          return;
        }
      },
    );
  },
};

const CONTROL_SIZE_MIN = 14;

const CONTROL_SIZE_MAX = 36;

const controlSize = styleValueRule(
  "Size glyph slots, avatars, controls, and rows from their component tokens.",
  (context, property, value, member) => {
    if (!SIZE_PROPERTIES.has(property)) return;
    const size = Math.abs(value);

    if (size < CONTROL_SIZE_MIN || size > CONTROL_SIZE_MAX) return;
    const sizes = [...new Set(BOX_HANDLES.map(([px]) => px))];

    const matches = sizes.includes(size)
      ? [size]
      : [sizes.findLast((px) => px < size), sizes.find((px) => px > size)].filter(
          (px) => px !== undefined,
        );

    const options = matches.map((px) => `${px} is ${either(boxHandlesAt(px))}`).join("; ");
    context.report({
      node: member,
      message:
        `"${property}: ${value}" sizes a box by hand: glyph, avatar, control, and row sizes ` +
        `belong to their tokens, which follow the component and its touch size. Use the ` +
        `${sizes.includes(size) ? "size that names this box" : "nearest size"} from ` +
        `${SCHEMA_MODULE}: ${options}. Drop it if padding and line height already give the ` +
        `size, and add one to ${TOKENS_PATH} and ${SCHEMA_PATH} only if the design calls for ` +
        `a new size.`,
    });
  },
);

/**
 * Touch sizes are a token decision: `target.min`, `target.gap`, and every
 * component token already grow under a coarse pointer. A call site that adds
 * its own coarse branch forks that policy.
 */
const touchInTokens = {
  meta: { docs: { description: "Keep coarse-pointer sizes in the tokens." } },
  create(context) {
    return eachCreatedStyle(isLengthProperty, (property, _value, member) => {
      const condition = keyName(member.key, member.computed);

      if (condition === null || !condition.includes("pointer: coarse")) return;
      context.report({
        node: member,
        message:
          `"${property}" sets its own "${condition}" value: the tokens own touch sizing and ` +
          `already grow under a coarse pointer. Use ${either(touchHandles(property))} from ` +
          `${SCHEMA_MODULE}. Add a coarse value to a token in ${TOKENS_PATH}, or ` +
          `${DESKTOP_TOKENS_PATH} for desktop layout, only if no handle covers this measurement.`,
      });
    });
  },
};

const WEIGHT_HANDLES = new Map([
  [400, "type.weightRegular"],
  [500, "type.weightMedium"],
  [600, "type.weightSemibold"],
]);

const weightValue = (node) => {
  if (Value.Check(numberLiteral, node)) return node.value;

  if (Value.Check(stringLiteral, node) && /^\d+$/.test(node.value)) return Number(node.value);

  return null;
};

const noRawFontWeight = {
  meta: { docs: { description: "Write StyleX font weights with the type.weight* handles." } },
  create(context) {
    return eachCreatedStyle(
      (key) => !isCondition(key),
      (property, value, member) => {
        if (property !== "fontWeight") return;
        const weight = weightValue(value);

        if (weight === null) return;
        const handle = WEIGHT_HANDLES.get(weight);

        const nearest = [...WEIGHT_HANDLES.keys()].reduce((best, step) =>
          Math.abs(step - weight) < Math.abs(best - weight) ? step : best,
        );

        context.report({
          node: member,
          message:
            `"fontWeight: ${weight}" is a raw weight: type.weight* owns weight, so it follows ` +
            `the UI font. ` +
            (handle
              ? `Use ${handle} from ${VARS_MODULE}.`
              : `Use the nearest, ${WEIGHT_HANDLES.get(nearest)} (${nearest}), from ` +
                `${VARS_MODULE}. Add a weight to ${TOKENS_PATH} with a handle in ${VARS_PATH} ` +
                `only if the design calls for one.`),
        });
      },
    );
  },
};

const noLightDarkOutsideTokens = {
  meta: { docs: { description: "Keep light-dark() pairs in the token layer." } },
  create(context) {
    return eachCreatedStyle(
      (key) => !isCondition(key),
      (property, value, member) => {
        if (!styleText(value).some((text) => /light-dark\(/i.test(text))) return;
        context.report({
          node: member,
          message:
            `"${property}" writes a light-dark() pair in a component: the roles own dark ` +
            `mode, and appearances and tinted scopes only retint a role. Use ` +
            `${colorHandles(property)} from ${VARS_MODULE}. Add the pair to ${ROLES_PATH} with ` +
            `a handle in ${VARS_PATH} only if no role matches.`,
        });
      },
    );
  },
};

export default {
  meta: { name: "nyte-design" },
  rules: {
    "spacing-scale": spacingScale,
    "size-grid": sizeGrid,
    "no-raw-colors": noRawColors,
    "no-raw-font-weight": noRawFontWeight,
    "no-light-dark-outside-tokens": noLightDarkOutsideTokens,
    "control-size": controlSize,
    "touch-in-tokens": touchInTokens,
  },
};
