import { Type } from "typebox";
import { Value } from "typebox/value";

const stringLiteral = Type.Object({ type: Type.Literal("Literal"), value: Type.String() });

const nameOf = (node) => {
  if (node.type === "Identifier" || node.type === "JSXIdentifier") return node.name;

  if (node.type === "Literal") return node.value;

  return undefined;
};

const attribute = (node, name) =>
  node.attributes.find((item) => item.type === "JSXAttribute" && nameOf(item.name) === name);

const literal = (node) =>
  node?.type === "JSXExpressionContainer"
    ? literal(node.expression)
    : node?.type === "Literal"
      ? node.value
      : undefined;

const rule = (description, create) => ({ meta: { docs: { description } }, create });

const disabledFlag = (node) =>
  node.type === "UnaryExpression"
    ? disabledFlag(node.argument)
    : /(?:^d|D)isabled$/.test(
        String(nameOf(node.type === "MemberExpression" ? node.property : node)),
      );

const visibleText = (node) =>
  (Value.Check(stringLiteral, node) && node.value.trim() !== "") ||
  node.type === "TemplateLiteral" ||
  ((node.type === "JSXElement" || node.type === "JSXFragment") &&
    !node.openingElement?.attributes.some(
      (item) =>
        item.type === "JSXSpreadAttribute" &&
        item.argument.arguments?.some((argument) => nameOf(argument) === "srOnly"),
    ) &&
    node.children.some((child) => child.type === "JSXText" && child.value.trim()));

const nonControls = new Set(["div", "span", "li", "img", "section", "p"]);

const dragHandles = new Map([
  ["packages/ui/src/slider.tsx", new Set(["control"])],
  ["packages/app/src/chrome/sidebar-pane.tsx", new Set(["handle"])],
  ["packages/app/src/screens/thread.stylex.ts", new Set(["sash"])],
  ["packages/app/src/workbench/workbench.stylex.ts", new Set(["sash"])],
]);

const smallWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "via",
  "with",
]);

const labels = new Set([
  "Button",
  "MenuItem",
  "MenuSwitchItem",
  "MenuCheckboxItem",
  "ContextMenuItem",
  "Toggle",
]);

export default {
  meta: { name: "nyte-interactions" },
  rules: {
    "no-clickable-non-control": rule("Use a control for a clickable target.", (context) => ({
      JSXOpeningElement(node) {
        if (!nonControls.has(nameOf(node.name)) || !attribute(node, "onClick")) return;

        if (["option", "treeitem"].includes(literal(attribute(node, "role")?.value))) return;
        const element = nameOf(node.name);
        context.report({
          node,
          message:
            `<${element} onClick> is not a control, so keyboard and screen-reader users cannot ` +
            `reach it. Use Button from @nyte-ai/ui/button for an action, Row.Primary from ` +
            `@nyte-ai/ui/row for a list row, or <a href> for navigation. Keep a clickable ` +
            `<${element}> only as role="option" or role="treeitem" inside a listbox or tree.`,
        });
      },
    })),
    "drag-only-touch-action": rule("Reserve touchAction none for drag handles.", (context) => ({
      Property(node) {
        if (nameOf(node.key) !== "touchAction" || literal(node.value) !== "none") return;
        const path = context.filename.replaceAll("\\", "/");
        const allowed = [...dragHandles].find(([file]) => path.endsWith(file))?.[1];

        let style;

        for (let parent = node.parent; parent; parent = parent.parent) {
          if (parent.type !== "Property") continue;

          if (allowed?.has(nameOf(parent.key))) return;
          style ??= nameOf(parent.key);
        }

        context.report({
          node,
          message:
            `touchAction "none"${style === undefined ? "" : ` on "${style}"`} blocks scrolling ` +
            `and pinch-zoom wherever a finger lands. Use "manipulation" for a control. Register ` +
            `a drag handle in dragHandles in packages/app/lint/interactions.js only if it tracks ` +
            `the pointer itself.`,
        });
      },
    })),
    "restore-popup-focus": rule("Return focus after closing a popup.", (context) => ({
      JSXAttribute(node) {
        if (nameOf(node.name) !== "finalFocus" || literal(node.value) !== false) return;
        context.report({
          node,
          message:
            `finalFocus={false} on <${nameOf(node.parent.name)}> drops focus to the page when ` +
            `the popup closes, so a keyboard user loses their place. Omit finalFocus to return ` +
            `focus to the trigger, or pass a ref to the element that should take it.`,
        });
      },
    })),
    "named-stylex-imports": rule("Use named StyleX imports.", (context) => {
      const namespaces = new Map();

      return {
        ImportDeclaration(node) {
          if (node.source.value !== "@stylexjs/stylex") return;

          for (const specifier of node.specifiers) {
            if (specifier.type !== "ImportNamespaceSpecifier") continue;
            namespaces.set(specifier.local.name, { specifier, used: new Set() });
          }
        },
        MemberExpression(node) {
          if (node.object.type !== "Identifier" || node.computed) return;
          namespaces.get(node.object.name)?.used.add(nameOf(node.property));
        },
        "Program:exit"() {
          for (const [local, { specifier, used }] of namespaces) {
            const names =
              used.size === 0
                ? "create, props"
                : [...used].sort((first, second) => first.localeCompare(second)).join(", ");

            context.report({
              node: specifier,
              message:
                `import * as ${local} pulls StyleX in as a namespace. Import each operation by ` +
                `name, import { ${names} } from "@stylexjs/stylex", and drop the ${local}. prefix.`,
            });
          }
        },
      };
    }),
    "accessible-pressable": rule(
      "Give native Pressable controls an accessible role or label.",
      (context) => ({
        JSXOpeningElement(node) {
          if (
            nameOf(node.name) !== "Pressable" ||
            attribute(node, "accessibilityRole") ||
            attribute(node, "accessibilityLabel")
          )
            return;
          context.report({
            node,
            message:
              "<Pressable> has neither accessibilityRole nor accessibilityLabel, so VoiceOver and " +
              'TalkBack announce it with no name or purpose. Add accessibilityRole="button" for ' +
              'an action or "link" for navigation, and accessibilityLabel when it has no visible ' +
              "text.",
          });
        },
      }),
    ),
    "specific-confirm-label": rule("Name the action in confirmation labels.", (context) => ({
      JSXText(node) {
        if (!/^(OK|Ok|Confirm|Submit|Yes|No)$/.test(node.value.trim())) return;

        if (node.parent?.type !== "JSXElement") return;

        const children = node.parent.children.filter(
          (child) => child.type !== "JSXText" || child.value.trim(),
        );

        if (children.length !== 1) return;
        context.report({
          node,
          message:
            `"${node.value.trim()}" does not say what happens. Name the action and its target ` +
            `in Title Case, such as "Delete Thread" or "Discard Changes".`,
        });
      },
    })),
    "no-disabled-caption": rule(
      "Keep disabled controls to their label and shortcut.",
      (context) => ({
        JSXExpressionContainer(node) {
          const { expression, parent } = node;

          if (
            parent?.type === "JSXAttribute" &&
            !["meta", "description"].includes(nameOf(parent.name))
          )
            return;

          const [test, branches] =
            expression.type === "ConditionalExpression"
              ? [expression.test, [expression.consequent, expression.alternate]]
              : expression.type === "LogicalExpression" && expression.operator === "&&"
                ? [expression.left, [expression.right]]
                : [undefined, []];

          if (!branches.some(visibleText) || !disabledFlag(test)) return;
          context.report({
            node,
            message:
              `This caption shows only while "${context.sourceCode.getText(test)}" holds, but a ` +
              `disabled control shows its label and shortcut only. Drop the caption, and give a ` +
              `Button a title only when the reason it is disabled is not obvious.`,
          });
        },
      }),
    ),
    "title-case-control-label": rule("Use Title Case for visible control labels.", (context) => ({
      JSXElement(node) {
        if (!labels.has(nameOf(node.openingElement.name))) return;

        const children = node.children.filter(
          (child) => child.type !== "JSXText" || child.value.trim(),
        );

        if (children.length !== 1 || children[0].type !== "JSXText") return;
        const text = children[0].value.trim();

        if (["Aa", "ab"].includes(text)) return;

        if (!/^[A-Za-z][A-Za-z '’-]{1,40}$/.test(text)) return;

        if (
          text
            .split(/\s+/)
            .every((word, index) => (index > 0 && smallWords.has(word)) || !/^[a-z]/.test(word))
        )
          return;

        const titled = text
          .split(" ")
          .map((word, index) =>
            index > 0 && smallWords.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
          )
          .join(" ");

        context.report({
          node: children[0],
          message:
            `"${text}" on <${nameOf(node.openingElement.name)}> is not Title Case. Write ` +
            `"${titled}": button and menu labels capitalize every word except short ones such ` +
            `as a, of, and to after the first.`,
        });
      },
    })),
  },
};
