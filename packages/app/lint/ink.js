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

/** A computed opacity is null: the rule only judges literals. */
const opacityAmount = (node) => {
  if (Value.Check(numberLiteral, node)) return node.value;

  if (!Value.Check(stringLiteral, node)) return null;
  const match = /^(\d*\.?\d+)(%?)$/.exec(node.value.trim());

  if (match === null) return null;

  return match[2] === "" ? Number(match[1]) : Number(match[1]) / 100;
};

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

const colorMixes = (text) =>
  [...text.matchAll(/color-mix\(/gi)].map((match) =>
    callArguments(text, match.index + match[0].length)
      .slice(1)
      .map((operand) => operand.replace(/(?:^|\s)\d*\.?\d+%(?:\s|$)/, " ").trim()),
  );

const colorsText = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type !== "Property" && parent.type !== "ObjectExpression") return false;
    const key = parent.type === "Property" ? keyName(parent.key, parent.computed) : null;

    if (key !== null && namesProperty(key)) return key === "color";
  }

  return false;
};

/** A content colour mixed only with transparent is a wash of its hue, unless it colours text. */
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

const keyText = (context, member) => {
  if (!member.computed) return keyName(member.key, false) ?? "";

  if (member.key.type === "Identifier") return constantText(context, member.key.name);

  return context.sourceCode.getText(member.key);
};

const selectsDisabled = (context, member) =>
  DISABLED_SELECTOR.test(withoutNegations(keyText(context, member)));

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

const innerInk = (context, block) =>
  blockInk(context, block) ??
  nestedBlocks(block)
    .filter((member) => !selectsDisabled(context, member))
    .map((member) => innerInk(context, member.value))
    .find((stair) => stair !== undefined);

/** A block's opacity also fades the text of blocks nested in it, so their colour counts. */
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

/** Fading or mixing text drops it below its stair's floor. Disabled states are exempt from floors. */
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

/** `disabled ? a : b` exempts `a` only; each leading `!` flips it. */
const disabledBranch = (context, node) => {
  const test = context.sourceCode.getText(node.test).trim();

  if (!namesDisabled(test)) return null;
  const negations = /^!*/.exec(test)[0].length;

  return negations % 2 === 0 ? node.consequent : node.alternate;
};

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
