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
const nonControls = new Set(["div", "span", "li", "img", "section", "p"]);
const dragHandles = new Map([
  ["packages/ui/src/components/ui/slider.tsx", new Set(["control"])],
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
        context.report({
          node,
          message: "Use Row.Primary, Button, or a link instead of a clickable non-control.",
        });
      },
    })),
    "drag-only-touch-action": rule("Reserve touchAction none for drag handles.", (context) => ({
      Property(node) {
        if (nameOf(node.key) !== "touchAction" || literal(node.value) !== "none") return;
        const path = context.filename.replaceAll("\\", "/");
        const allowed = [...dragHandles].find(([file]) => path.endsWith(file))?.[1];
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (parent.type === "Property" && allowed?.has(nameOf(parent.key))) return;
        }
        context.report({
          node,
          message:
            "touchAction none is only allowed on the registered slider and resize handles. Use manipulation for controls.",
        });
      },
    })),
    "no-hover-submenus": rule("Open submenus on click.", (context) => ({
      JSXAttribute(node) {
        if (nameOf(node.name) !== "openOnHover") return;
        if (
          context.filename
            .replaceAll("\\", "/")
            .endsWith("packages/ui/src/components/ui/menu.tsx") &&
          literal(node.value) === false
        )
          return;
        context.report({
          node,
          message:
            "Submenus open on click. The shared menu alone disables the library's hover default.",
        });
      },
    })),
    "restore-popup-focus": rule("Return focus after closing a popup.", (context) => ({
      JSXAttribute(node) {
        if (nameOf(node.name) !== "finalFocus" || literal(node.value) !== false) return;
        context.report({
          node,
          message: "Do not disable focus return. Omit finalFocus or supply the destination.",
        });
      },
    })),
    "named-stylex-imports": rule("Use named StyleX imports.", (context) => ({
      ImportDeclaration(node) {
        if (node.source.value !== "@stylexjs/stylex") return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportNamespaceSpecifier") continue;
          context.report({
            node: specifier,
            message: "Import StyleX operations by name, not as a namespace.",
          });
        }
      },
    })),
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
              "Pressable needs accessibilityRole or accessibilityLabel. Navigation uses the link role.",
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
          message: "Name the action and its target instead of a generic confirmation.",
        });
      },
    })),
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
        context.report({
          node: children[0],
          message: "Use Title Case for visible button and menu labels.",
        });
      },
    })),
  },
};
