import { Type } from "typebox";
import { Value } from "typebox/value";

export const stringLiteral = Type.Object({ type: Type.Literal("Literal"), value: Type.String() });

export const numberLiteral = Type.Object({ type: Type.Literal("Literal"), value: Type.Number() });

/**
 * A value reaches the rule as a string or as a template with handles spliced
 * in, and only the literal parts of the template are the author's decision.
 */
export const styleText = (node) => {
  if (Value.Check(stringLiteral, node)) return [node.value];

  if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.cooked ?? "");

  return [];
};

/** A key names a property unless it is a condition, pseudo-selector, or at-rule, which name a state. */
export const namesProperty = (key) =>
  key !== "default" && !key.startsWith(":") && !key.startsWith("@") && !key.startsWith("[");

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

export const keyName = (key, computed) => {
  if (computed) return null;

  if (key.type === "Identifier") return key.name;

  if (Value.Check(stringLiteral, key)) return key.value;

  return null;
};

export const styleBody = (node) => {
  if (node.type !== "ArrowFunctionExpression") return node;

  if (node.body.type !== "BlockStatement") return node.body;

  return node.body.body.find((statement) => statement.type === "ReturnStatement")?.argument;
};

/** Collect the import bindings, then hand each create call's style bodies, and their entries, to `visit`. */
export const eachStyleBody = (visit) => {
  const bindings = createBindings();

  return {
    ImportDeclaration(node) {
      bindings.collect(node);
    },
    CallExpression(node) {
      if (!bindings.isCreateCall(node) || node.arguments[0]?.type !== "ObjectExpression") return;

      for (const style of node.arguments[0].properties) {
        if (style.type === "Property") visit(styleBody(style.value), style);
      }
    },
  };
};

export const HOVER_QUERY = "@media (hover: hover) and (pointer: fine)";

/** `[media.hover]` from the schema, or the query it stands for. */
export const guardsHover = (member) => {
  if (!member.computed) return keyName(member.key, false) === HOVER_QUERY;

  return (
    member.key.type === "MemberExpression" &&
    !member.key.computed &&
    member.key.object.type === "Identifier" &&
    member.key.object.name === "media" &&
    member.key.property.type === "Identifier" &&
    member.key.property.name === "hover"
  );
};

/** Every member below a style, with its object, whether the hover query encloses it, and its key. */
export const eachStyleMember = (node, visit, guarded = false) => {
  if (node?.type !== "ObjectExpression") return;

  for (const member of node.properties) {
    if (member.type !== "Property") continue;
    visit(member, node, guarded, keyName(member.key, member.computed));
    eachStyleMember(styleBody(member.value), visit, guarded || guardsHover(member));
  }
};
