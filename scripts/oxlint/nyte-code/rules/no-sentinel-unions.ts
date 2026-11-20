import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const SCHEMA_STRUCTURES = new Set(["Array", "Object", "Tuple", "Record"]);

const COLLECTIONS = new Set([
  "Array",
  "ReadonlyArray",
  "Set",
  "ReadonlySet",
  "Map",
  "ReadonlyMap",
  "Record",
  "Readonly",
]);

export const noSentinelUnionsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow a union of a string literal and an array or object, such as `"all" | readonly string[]`.',
    },
    messages: {
      sentinel:
        'The union puts the string "{{literal}}" beside an array or object, so callers compare against a magic string. Model each choice as a `kind` variant, such as `{ kind: "{{literal}}" } | { kind: "paths"; paths: readonly string[] }`.',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (schemaCall(node) !== "Union") return;
        const [members] = node.arguments;

        if (members?.type !== "ArrayExpression") return;
        const calls = members.elements.flatMap((element) =>
          element?.type === "CallExpression" ? [element] : [],
        );
        const literal = calls.find(
          (call) =>
            schemaCall(call) === "Literal" &&
            call.arguments[0]?.type === "Literal" &&
            typeof call.arguments[0].value === "string",
        );

        if (literal === undefined) return;

        if (!calls.some((call) => SCHEMA_STRUCTURES.has(schemaCall(call) ?? ""))) return;
        const value = literal.arguments[0];

        context.report({
          node,
          messageId: "sentinel",
          data: { literal: value?.type === "Literal" ? String(value.value) : "" },
        });
      },
      TSUnionType(node) {
        const literal = node.types.find(
          (member): member is ESTree.TSLiteralType =>
            member.type === "TSLiteralType" &&
            member.literal.type === "Literal" &&
            typeof member.literal.value === "string",
        );

        if (literal === undefined || !node.types.some(structured)) return;

        context.report({
          node,
          messageId: "sentinel",
          data: {
            literal: String(literal.literal.type === "Literal" ? literal.literal.value : ""),
          },
        });
      },
    };
  },
});

function schemaCall(node: ESTree.CallExpression): string | null {
  const callee = node.callee;

  return callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Type" &&
    callee.property.type === "Identifier"
    ? callee.property.name
    : null;
}

function structured(member: ESTree.TSType): boolean {
  if (member.type === "TSArrayType" || member.type === "TSTupleType") return true;
  if (member.type === "TSTypeLiteral" || member.type === "TSMappedType") return true;
  if (member.type === "TSTypeOperator")
    return member.typeAnnotation !== null && structured(member.typeAnnotation);

  return (
    member.type === "TSTypeReference" &&
    member.typeName.type === "Identifier" &&
    COLLECTIONS.has(member.typeName.name)
  );
}
