import { Value } from "typebox/value";
import {
  eachStyleBody,
  keyName,
  namesProperty,
  numberLiteral,
  styleBody,
  stringLiteral,
  styleText,
} from "./stylex-styles.js";

const FADED_INK =
  "Pick a lower content stair (role.contentTertiary, role.contentQuaternary) instead of fading " +
  "text with opacity.";

const MIXED_INK = "Mixing content roles makes an off-stair colour; pick a stair.";

const DISABLED_INK =
  "contentDisabled is for disabled controls. Use role.contentTertiary for information, " +
  "role.contentQuaternary for decoration.";

/** The content stair a value reads, as `role.contentSecondary` or its `--nyte-content-*` variable. */
const contentStair = (node) => {
  if (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    node.object.name === "role" &&
    node.property.type === "Identifier" &&
    /^content[A-Z]/.test(node.property.name)
  ) {
    return `role.${node.property.name}`;
  }

  return /--nyte-content-[\w-]+/.exec(styleText(node).join(""))?.[0] ?? null;
};

/** `0.5`, `"0.5"`, or `"50%"` as a fraction; anything computed is null. */
const opacityAmount = (node) => {
  if (Value.Check(numberLiteral, node)) return node.value;

  if (!Value.Check(stringLiteral, node)) return null;
  const match = /^(\d*\.?\d+)(%?)$/.exec(node.value.trim());

  if (match === null) return null;

  return match[2] === "" ? Number(match[1]) : Number(match[1]) / 100;
};

/** The text of a template, with each content handle written as its handle. */
const templateText = (context, node) =>
  node.quasis
    .map((quasi, index) => {
      const expression = node.expressions[index];

      const spliced =
        expression === undefined
          ? ""
          : (contentStair(expression) ?? context.sourceCode.getText(expression));

      return (quasi.value.cooked ?? "") + spliced;
    })
    .join("");

/** The comma-separated arguments of the call that opens at `start`, nested calls kept whole. */
const callArguments = (text, start) => {
  const parts = [];
  let depth = 0;
  let from = start;

  for (let index = start; index < text.length; index++) {
    const char = text[index];

    if (char === ")" && depth === 0) return [...parts, text.slice(from, index)];

    if (char === "(") depth += 1;

    if (char === ")") depth -= 1;

    if (char === "," && depth === 0) {
      parts.push(text.slice(from, index));
      from = index + 1;
    }
  }

  return [...parts, text.slice(from)];
};

/** Each color-mix() in a value, nested ones too, as its colour operands without their percentages. */
const colorMixes = (text) =>
  [...text.matchAll(/color-mix\(/gi)].map((match) =>
    callArguments(text, match.index + match[0].length)
      .slice(1)
      .map((operand) => operand.replace(/(?:^|\s)\d*\.?\d+%(?:\s|$)/, " ").trim()),
  );

/** A literal that is the value of `color`, under any of its conditions. */
const colorsText = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type !== "Property" && parent.type !== "ObjectExpression") return false;
    const key = parent.type === "Property" ? keyName(parent.key, parent.computed) : null;

    if (key !== null && namesProperty(key)) return key === "color";
  }

  return false;
};

/**
 * A mix of a content stair with another colour lands between two stairs, on
 * no floor. A content colour mixed only with transparent is a wash of its hue
 * and passes, unless it colours text, where it is a fade.
 */
const reportMixedInk = (context, node, text) => {
  const stairs = colorMixes(text)
    .map((operands) => {
      const inks = operands.filter((operand) => /role\.content|--nyte-content-/.test(operand));
      const others = operands.filter((operand) => !inks.includes(operand));
      const wash = inks.length === 1 && others.every((operand) => operand === "transparent");

      return inks.length === 0 || (wash && !colorsText(node)) ? [] : inks;
    })
    .find((inks) => inks.length > 0);

  if (stairs === undefined) return;
  context.report({
    node,
    message:
      `This color-mix() blends ${stairs.length > 1 ? stairs.join(" and ") : `${stairs[0]} with another colour`}. ` +
      `${MIXED_INK} ` +
      `For quieter text use role.contentTertiary or role.contentQuaternary.`,
  });
};

const namesDisabled = (text) => /disabled/i.test(text ?? "");

const DISABLED_SELECTOR =
  /:disabled(?![-\w])|\[(?:data-)?disabled\]|\[aria-disabled=(["']?)true\1\]/;

/** A selector with every `:not(…)` cut out, so `:hover:not([data-disabled])` names no disabled state. */
const withoutNegations = (text) => {
  const open = text.indexOf(":not(");

  if (open < 0) return text;
  let depth = 0;
  let close = open + 4;

  for (; close < text.length; close++) {
    if (text[close] === "(") depth += 1;

    if (text[close] === ")") depth -= 1;

    if (depth === 0) break;
  }

  return withoutNegations(text.slice(0, open) + text.slice(close + 1));
};

/** The string a module-level `const` holds, so `[disabled]` reads as the selector it names. */
const constantText = (context, name) =>
  context.sourceCode.ast.body
    .flatMap((statement) =>
      statement.type === "ExportNamedDeclaration" ? [statement.declaration] : [statement],
    )
    .filter((statement) => statement?.type === "VariableDeclaration")
    .flatMap((declaration) => declaration.declarations)
    .filter((declarator) => declarator.id.type === "Identifier" && declarator.id.name === name)
    .flatMap((declarator) => (declarator.init ? styleText(declarator.init) : []))
    .join("");

/**
 * A key as written: `[when.ancestor("[data-disabled]")]` reads from its source and `[disabled]`
 * from the constant it names.
 */
const keyText = (context, member) => {
  if (!member.computed) return keyName(member.key, false) ?? "";

  if (member.key.type === "Identifier") return constantText(context, member.key.name);

  return context.sourceCode.getText(member.key);
};

/** A key that selects a disabled state rather than excluding one. */
const selectsDisabled = (context, member) =>
  DISABLED_SELECTOR.test(withoutNegations(keyText(context, member)));

/** The leaves of a value outside its disabled conditions, which the contrast floors exempt. */
const enabledLeaves = (context, node) =>
  node.type === "ObjectExpression"
    ? node.properties.flatMap((member) =>
        member.type !== "Property" || selectsDisabled(context, member)
          ? []
          : enabledLeaves(context, member.value),
      )
    : [node];

const findMember = (block, name) =>
  block.properties.find(
    (member) => member.type === "Property" && keyName(member.key, member.computed) === name,
  );

/** The condition and pseudo-element blocks nested in a block, not the condition maps of its properties. */
const nestedBlocks = (block) =>
  block.properties.filter((member) => {
    if (member.type !== "Property" || member.value.type !== "ObjectExpression") return false;
    const key = keyName(member.key, member.computed);

    return key === null || !namesProperty(key);
  });

const blockInk = (context, block) => {
  const color = findMember(block, "color");

  return color === undefined
    ? undefined
    : enabledLeaves(context, color.value)
        .map(contentStair)
        .find((stair) => stair !== null);
};

/** The first content stair a block or a block nested in it sets, outside disabled states. */
const innerInk = (context, block) =>
  blockInk(context, block) ??
  nestedBlocks(block)
    .filter((member) => !selectsDisabled(context, member))
    .map((member) => innerInk(context, member.value))
    .find((stair) => stair !== undefined);

/**
 * Each opacity fade on a block whose text has a content stair: its own `color`, the nearest
 * ancestor's, or one a nested block sets, which the block's opacity fades too. Blocks under a
 * disabled state are exempt.
 */
const fadedOpacities = (context, block, inherited, disabled) => {
  const ink = blockInk(context, block) ?? inherited;
  const opacity = findMember(block, "opacity");

  const fade =
    opacity === undefined || disabled
      ? undefined
      : enabledLeaves(context, opacity.value)
          .map(opacityAmount)
          .find((amount) => amount !== null && amount > 0 && amount < 1);

  const faded = fade === undefined ? undefined : (ink ?? innerInk(context, block));

  return [
    ...(faded === undefined ? [] : [{ member: opacity, fade, ink: faded }]),
    ...nestedBlocks(block).flatMap((member) =>
      fadedOpacities(context, member.value, ink, disabled || selectsDisabled(context, member)),
    ),
  ];
};

/**
 * Each stair has a contrast floor on every surface; fading text with opacity
 * or mixing it with another colour drops it below the floor the stair
 * promised. A whole element fading to 0 or 1, opacity on a style that sets no
 * content colour, such as an image, and a disabled state, which the floors
 * exempt, pass.
 */
export const noFadedInk = {
  meta: {
    docs: {
      description: "De-emphasise text with a lower content stair, not opacity or color-mix().",
    },
  },
  create(context) {
    return {
      ...eachStyleBody((style, entry) => {
        if (style?.type !== "ObjectExpression") return;
        const disabled = namesDisabled(keyName(entry.key, entry.computed));

        for (const faded of fadedOpacities(context, style, undefined, disabled)) {
          context.report({
            node: faded.member,
            message: `"opacity: ${faded.fade}" fades text set to ${faded.ink}. ${FADED_INK}`,
          });
        }
      }),
      Literal(node) {
        if (Value.Check(stringLiteral, node)) reportMixedInk(context, node, node.value);
      },
      TemplateLiteral(node) {
        reportMixedInk(context, node, templateText(context, node));
      },
    };
  },
};

/**
 * The branch a disabled-named test selects when it holds: `disabled ? a : b` picks `a`, and
 * each leading `!` flips it. A test that names no disabled state selects neither.
 */
const disabledBranch = (context, node) => {
  const test = context.sourceCode.getText(node.test).trim();

  if (!namesDisabled(test)) return null;
  const negations = /^!*/.exec(test)[0].length;

  return negations % 2 === 0 ? node.consequent : node.alternate;
};

/** Each contentDisabled below a value that no disabled condition, style, or test selects. */
const strayDisabledInk = (context, node, allowed) => {
  if (node.type === "ObjectExpression") {
    return node.properties.flatMap((member) =>
      member.type === "Property"
        ? strayDisabledInk(context, member.value, allowed || selectsDisabled(context, member))
        : [],
    );
  }

  if (node.type === "ArrowFunctionExpression") {
    const body = styleBody(node);

    return body === undefined ? [] : strayDisabledInk(context, body, allowed);
  }

  if (node.type === "ConditionalExpression") {
    const selected = disabledBranch(context, node);

    return [node.consequent, node.alternate].flatMap((branch) =>
      strayDisabledInk(context, branch, allowed || branch === selected),
    );
  }

  if (allowed) return [];

  if (node.type === "TemplateLiteral") {
    const spliced = node.expressions.flatMap((part) => strayDisabledInk(context, part, false));

    return styleText(node).some((text) => text.includes("--nyte-content-disabled"))
      ? [node, ...spliced]
      : spliced;
  }

  return /^(?:role\.contentDisabled|--nyte-content-disabled)$/.test(contentStair(node) ?? "")
    ? [node]
    : [];
};

/** contentDisabled is exempt from the contrast floors, so on anything still readable it fails them. */
export const disabledInk = {
  meta: { docs: { description: "Keep role.contentDisabled to disabled states." } },
  create(context) {
    return eachStyleBody((style, entry) => {
      if (style === undefined) return;
      const name = keyName(entry.key, entry.computed);

      for (const node of strayDisabledInk(context, style, namesDisabled(name))) {
        context.report({
          node,
          message: `role.contentDisabled colours a style that is not a disabled state. ${DISABLED_INK}`,
        });
      }
    });
  },
};
