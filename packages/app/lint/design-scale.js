import { Value } from "typebox/value";
import tokenScale from "./design-scale.tokens.json" with { type: "json" };
import {
  eachStyleBody,
  eachStyleMember,
  guardsHover,
  keyName,
  namesProperty,
  numberLiteral,
  stringLiteral,
  styleText,
} from "./stylex-styles.js";
import { disabledInk, noFadedInk } from "./ink.js";

const SPACE_STEPS = new Map(tokenScale.space);

const BOX_HANDLES = tokenScale.boxes;

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
    return "a background role such as role.bgBase, role.bgElevated, or role.fillTertiary";
  }

  if (property.startsWith("border") || property.startsWith("outline")) {
    return "a border role such as role.strokeTertiary, role.strokeQuaternary, or role.strokeSecondary";
  }

  if (property === "boxShadow") {
    return "shadow.shadowSm, shadow.shadowLg, or role.strokeTertiary inside an inset ring";
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

  return ["target.min", "control.heightMd", "row.heightMd"];
};

const MASK_PROPERTIES = new Set(["mask", "maskImage", "WebkitMaskImage"]);

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

const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)?/i;

const HEX_COLOR = /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/i;

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

const takesLength = (key) => SPACING_PROPERTIES.has(key) || SIZE_PROPERTIES.has(key);

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

const eachCreatedStyle = (governs, visit) =>
  eachStyleBody((style) => {
    if (style) eachStyleValue(style, visit, undefined, governs);
  });

const styleValueRule = (description, report) => ({
  meta: { docs: { description } },
  create(context) {
    return eachCreatedStyle(takesLength, (property, value, member) => {
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

const noRawColors = {
  meta: { docs: { description: "Keep literal colors out of StyleX styles." } },
  create(context) {
    return eachCreatedStyle(namesProperty, (property, value, member) => {
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
    });
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

const touchInTokens = {
  meta: { docs: { description: "Keep coarse-pointer sizes in the tokens." } },
  create(context) {
    return eachCreatedStyle(takesLength, (property, _value, member) => {
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
    return eachCreatedStyle(namesProperty, (property, value, member) => {
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
    });
  },
};

const noLightDarkOutsideTokens = {
  meta: { docs: { description: "Keep light-dark() pairs in the token layer." } },
  create(context) {
    return eachCreatedStyle(namesProperty, (property, value, member) => {
      if (!styleText(value).some((text) => /light-dark\(/i.test(text))) return;
      context.report({
        node: member,
        message:
          `"${property}" writes a light-dark() pair in a component: the roles own dark ` +
          `mode, and appearances and tinted scopes only retint a role. Use ` +
          `${colorHandles(property)} from ${VARS_MODULE}. Add the pair to ${ROLES_PATH} with ` +
          `a handle in ${VARS_PATH} only if no role matches.`,
      });
    });
  },
};

const SELF_HOVER = /^:hover(?![-\w])/;

const DISABLED_STATES = [":disabled", "[data-disabled]", '[aria-disabled="true"]'];

const everyLeafGuarded = (node) => {
  if (node.type === "Literal" && node.value === null) return true;

  if (node.type !== "ObjectExpression") return false;

  return node.properties.every(
    (member) =>
      member.type === "Property" && (guardsHover(member) || everyLeafGuarded(member.value)),
  );
};

const withExclusion = (key, states) => {
  if (states.length === 0) return key;
  const exclusion = `:not(${states.join(", ")})`;
  const pseudoElement = key.indexOf("::");

  return pseudoElement < 0
    ? `${key}${exclusion}`
    : `${key.slice(0, pseudoElement)}${exclusion}${key.slice(pseudoElement)}`;
};

const hoverProblem = (unguarded, missing) => {
  const touch = "applies under a touch pointer, where a tap leaves it stuck";

  const disabled =
    `still matches while the control is disabled, and StyleX compiles a guarded hover to a ` +
    `doubled class (.x.x:hover) that outranks the style's ${missing.join(" and ")} rule`;

  if (missing.length === 0) return touch;

  return unguarded ? `${touch}, and ${disabled}` : disabled;
};

const guardedHover = {
  meta: {
    docs: { description: "Guard StyleX :hover with media.hover and skip disabled controls." },
  },
  create(context) {
    return eachStyleBody((style) => {
      const keys = [];
      eachStyleMember(style, (_member, _object, _guarded, key) => {
        if (key !== null) keys.push(key);
      });
      const states = DISABLED_STATES.filter((state) => keys.some((key) => key.includes(state)));

      eachStyleMember(style, (member, _object, guarded, key) => {
        if (key === null || !SELF_HOVER.test(key)) return;
        const unguarded = !guarded && !everyLeafGuarded(member.value);
        const exclusions = [...key.matchAll(/:not\(([^)]*)\)/g)].map((match) => match[1]);
        const missing = states.filter((state) => !exclusions.some((not) => not.includes(state)));

        if (!unguarded && missing.length === 0) return;
        context.report({
          node: member,
          message:
            `"${key}" ${hoverProblem(unguarded, missing)}. Write "${withExclusion(key, missing)}": ` +
            `{ [media.hover]: … } with media from ${SCHEMA_MODULE}` +
            (missing.length === 0 ? "." : `, as Button writes ":hover:not([data-disabled])".`),
        });
      });
    });
  },
};

const PHYSICAL_KEYS = new Map([
  ["marginLeft", "marginInlineStart"],
  ["marginRight", "marginInlineEnd"],
  ["paddingLeft", "paddingInlineStart"],
  ["paddingRight", "paddingInlineEnd"],
  ["borderLeft", "borderInlineStart"],
  ["borderRight", "borderInlineEnd"],
  ["borderLeftWidth", "borderInlineStartWidth"],
  ["borderLeftStyle", "borderInlineStartStyle"],
  ["borderLeftColor", "borderInlineStartColor"],
  ["borderRightWidth", "borderInlineEndWidth"],
  ["borderRightStyle", "borderInlineEndStyle"],
  ["borderRightColor", "borderInlineEndColor"],
  ["left", "insetInlineStart"],
  ["right", "insetInlineEnd"],
  ["borderTopLeftRadius", "borderStartStartRadius"],
  ["borderTopRightRadius", "borderStartEndRadius"],
  ["borderBottomLeftRadius", "borderEndStartRadius"],
  ["borderBottomRightRadius", "borderEndEndRadius"],
]);

const PHYSICAL_VALUES = new Map([
  [
    "textAlign",
    new Map([
      ["left", "start"],
      ["right", "end"],
    ]),
  ],
  [
    "float",
    new Map([
      ["left", "inline-start"],
      ["right", "inline-end"],
    ]),
  ],
  [
    "clear",
    new Map([
      ["left", "inline-start"],
      ["right", "inline-end"],
    ]),
  ],
]);

const INLINE_ANCHORS = new Set(["insetInlineStart", "insetInlineEnd"]);

const leafStrings = (node) => {
  if (node.type !== "ObjectExpression") return styleText(node);

  return node.properties.flatMap((member) =>
    member.type === "Property" ? leafStrings(member.value) : [],
  );
};

const siblingText = (object, name) => {
  const sibling = object.properties.find(
    (member) => member.type === "Property" && keyName(member.key, member.computed) === name,
  );

  return sibling === undefined ? "" : styleText(sibling.value).join("");
};

const shifts = (length) => length !== undefined && !/^[-+]?0(?:\.0+)?[a-z%]*$/i.test(length);

const translatesInline = (object) =>
  shifts(siblingText(object, "translate").trim().split(/\s+/)[0] || undefined) ||
  shifts(/\btranslate(?:X|3d)?\(\s*([^,)\s]+)/i.exec(siblingText(object, "transform"))?.[1]);

const centres = (member, object) =>
  Value.Check(stringLiteral, member.value) &&
  member.value.value === "50%" &&
  translatesInline(object);

const logicalProperties = {
  meta: { docs: { description: "Write StyleX sides with logical properties and values." } },
  create(context) {
    return eachStyleBody((style) =>
      eachStyleMember(style, (member, object, _guarded, key) => {
        if (key === null) return;
        const logical = PHYSICAL_KEYS.get(key);

        if (logical !== undefined) {
          if (key === "left" && centres(member, object)) return;
          context.report({
            node: member,
            message:
              `"${key}" is a physical side, so it stays put in a right-to-left layout. Use ` +
              `${logical}. ` +
              (key === "left"
                ? `To centre, keep left: "50%" beside a translate of -50%, which is symmetric. `
                : "") +
              `If this side is physical by design, disable the rule on this line and say why.`,
          });

          return;
        }

        if (INLINE_ANCHORS.has(key) && centres(member, object)) {
          context.report({
            node: member,
            message:
              `"${key}: 50%" flips to the other side in a right-to-left layout, but its ` +
              `translate does not, so the element lands a full width off centre. Centre with ` +
              `left: "50%" and the same translate, which is symmetric.`,
          });

          return;
        }

        const values = PHYSICAL_VALUES.get(key);

        if (values === undefined) return;
        const physical = leafStrings(member.value).find((text) => values.has(text));

        if (physical === undefined) return;
        context.report({
          node: member,
          message:
            `"${key}: ${physical}" is a physical side, so it stays put in a right-to-left ` +
            `layout. Use ${key}: "${values.get(physical)}".`,
        });
      }),
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
    "guarded-hover": guardedHover,
    "logical-properties": logicalProperties,
    "no-faded-ink": noFadedInk,
    "disabled-ink": disabledInk,
  },
};
