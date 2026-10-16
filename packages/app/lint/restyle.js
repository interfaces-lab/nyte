/**
 * Restyle contracts for oxlint's JS plugin runtime.
 *
 * A component from `@nyte-ai/ui` owns its padding, colours, height, corners,
 * and type; `xstyle` places it. The contract for each component lives in
 * `packages/ui/src/styles/contracts.ts`, which also types its `xstyle`. The
 * type error names a property; this rule says what to use instead.
 *
 * Only styles this file defines are read: `create` objects, their members,
 * arrays and conditionals of them, and the shared `text.*` and `srOnly`. A
 * style imported from another file is left to the type. Custom properties are
 * the caller's own unless the component declares them, like `--_btn-height`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { restyleCategories, restyleContracts } from "../../ui/src/styles/contracts.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const UI_MODULE = "@nyte-ai/ui/";

const TEXT_STYLE = ["fontSize", "lineHeight", "letterSpacing"];

/**
 * Shared styles this rule cannot read from the file that uses them, by module
 * and export: `text` in `packages/ui/src/styles/text.stylex.ts` and `srOnly`
 * in `packages/ui/src/styles/a11y.stylex.ts`.
 */
const SHARED_STYLES = new Map([
  [
    "@nyte-ai/ui/styles/text.stylex",
    new Map([
      ["text", (member) => (member === "code" ? [...TEXT_STYLE, "fontFamily"] : TEXT_STYLE)],
    ]),
  ],
  [
    "@nyte-ai/ui/styles/a11y.stylex",
    new Map([
      [
        "srOnly",
        () => [
          "position",
          "width",
          "height",
          "margin",
          "padding",
          "borderWidth",
          "overflow",
          "clip",
          "whiteSpace",
        ],
      ],
    ]),
  ],
]);

const CONCERNS = [
  ["spacing", /^(padding|gap$|rowGap$|columnGap$)/],
  ["corners", /Radius$/],
  ["colours", /(^color$|Color$|^background|^boxShadow$|^opacity$|^fill$|^stroke$)/],
  ["border", /^border/],
  ["focus ring", /^outline/],
  ["type", /^(font|lineHeight$|letterSpacing$|text|whiteSpace$|overflowWrap$)/],
  ["motion", /^(transition|animation|transform$|translate$|scale$|rotate$)/],
  ["size", /^(min|max)?(Width|Height)$|^(width|height)$/],
  ["states", /^[:@[]/],
];

const concernOf = (property) =>
  CONCERNS.find(([, pattern]) => pattern.test(property))?.[0] ?? "layout internals";

const privateProperties = new Map();

/** The custom properties a component declares for itself, such as `--_btn-height`. */
const privatePropertiesOf = (file) => {
  if (!privateProperties.has(file)) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    privateProperties.set(file, new Set(source.match(/--_[\w-]+(?=["']:)/g) ?? []));
  }

  return privateProperties.get(file);
};

const allowedBy = (contract) =>
  new Set([
    ...contract.allow.flatMap((category) => restyleCategories[category]),
    ...(contract.also ?? []),
  ]);

const keyName = (key) => {
  if (key.type === "Identifier") return key.name;

  if (key.type === "Literal") return String(key.value);

  return null;
};

const isCreateCall = (node, creators, namespaces) =>
  node?.type === "CallExpression" &&
  (node.callee.type === "Identifier"
    ? creators.has(node.callee.name)
    : node.callee.type === "MemberExpression" &&
      node.callee.object.type === "Identifier" &&
      namespaces.has(node.callee.object.name) &&
      keyName(node.callee.property) === "create");

/** The style object a `create` entry defines, or the object its function returns. */
const styleObject = (node) => {
  if (node.type === "ArrowFunctionExpression") {
    const body =
      node.body.type === "BlockStatement"
        ? node.body.body.find((statement) => statement.type === "ReturnStatement")?.argument
        : node.body;

    return body ? styleObject(body) : null;
  }

  return node.type === "ObjectExpression" ? node : null;
};

const propertiesOf = (object) =>
  object.properties.flatMap((member) => {
    const name = member.type === "Property" && !member.computed ? keyName(member.key) : null;

    return name === null ? [] : [name];
  });

const elementName = (name) => {
  if (name.type === "JSXIdentifier") return { local: name.name, part: null };

  if (name.type === "JSXMemberExpression" && name.object.type === "JSXIdentifier") {
    return { local: name.object.name, part: name.property.name };
  }

  return null;
};

const list = (items) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""} and ${items.at(-1)}`;

const advice = (component, contract, concerns) => {
  const options = contract.options.length
    ? `Choose its look with ${list(contract.options)}`
    : `It has no option for that`;
  const spacing = concerns.includes("spacing")
    ? `; space it with gap on the parent or a margin on <${component}>`
    : "";
  const missing = contract.options.length ? "an option" : "one";

  return (
    `${options}${spacing}, or style a wrapper element you own. If none fits, add ${missing} in ` +
    `${contract.file} only if the design calls for one. Through xstyle <${component}> takes ` +
    `${list([...contract.allow, ...(contract.also ?? [])])}.`
  );
};

const noRestyle = {
  meta: { docs: { description: "Keep xstyle on @nyte-ai/ui components to their contract." } },
  create(context) {
    const components = new Map();
    const shared = new Map();
    const creators = new Set();
    const namespaces = new Set();
    const styles = new Map();
    const values = new Map();
    const uses = [];

    const resolve = (node, found) => {
      switch (node.type) {
        case "ArrayExpression":
          for (const element of node.elements) if (element) resolve(element, found);

          return;
        case "LogicalExpression":
          resolve(node.right, found);

          if (node.operator !== "&&") resolve(node.left, found);

          return;
        case "ConditionalExpression":
          resolve(node.consequent, found);
          resolve(node.alternate, found);

          return;
        case "Identifier":
          if (shared.has(node.name)) {
            found.push({ label: node.name, properties: shared.get(node.name)(null) });

            return;
          }

          if (values.has(node.name)) resolve(values.get(node.name), found);

          return;
        case "CallExpression":
          resolve(node.callee, found);

          return;
        case "MemberExpression":
          break;
        default:
          return;
      }

      if (node.object.type !== "Identifier") return;
      const owner = node.object.name;
      const key = node.computed
        ? node.property.type === "Literal"
          ? String(node.property.value)
          : null
        : keyName(node.property);

      if (shared.has(owner)) {
        found.push({ label: `${owner}.${key ?? "[…]"}`, properties: shared.get(owner)(key) });

        return;
      }

      const entries = styles.get(owner);

      if (!entries) return;

      for (const [name, object] of entries) {
        if (key !== null && name !== key) continue;
        found.push({ label: `${owner}.${name}`, properties: propertiesOf(object) });
      }
    };

    return {
      ImportDeclaration(node) {
        const source = node.source.value;

        if (source === "@stylexjs/stylex") {
          for (const specifier of node.specifiers) {
            if (specifier.type === "ImportSpecifier") {
              if (keyName(specifier.imported) === "create") creators.add(specifier.local.name);
            } else {
              namespaces.add(specifier.local.name);
            }
          }

          return;
        }

        const sharedStyles = SHARED_STYLES.get(source.replace(/\.ts$/, ""));

        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const imported = keyName(specifier.imported);

          if (sharedStyles?.has(imported)) {
            shared.set(specifier.local.name, sharedStyles.get(imported));
          } else if (source.startsWith(UI_MODULE) && !source.includes("/styles/")) {
            components.set(specifier.local.name, imported);
          }
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || !node.init) return;

        if (!isCreateCall(node.init, creators, namespaces)) {
          values.set(node.id.name, node.init);

          return;
        }

        const argument = node.init.arguments[0];

        if (argument?.type !== "ObjectExpression") return;
        const entries = new Map();

        for (const member of argument.properties) {
          if (member.type !== "Property") continue;
          const name = keyName(member.key);
          const object = styleObject(member.value);

          if (name !== null && object) entries.set(name, object);
        }

        styles.set(node.id.name, entries);
      },
      JSXAttribute(node) {
        if (node.name.name !== "xstyle" || node.value?.type !== "JSXExpressionContainer") return;
        const element = elementName(node.parent.name);
        const imported = element && components.get(element.local);

        if (!imported) return;
        const component = element.part ? `${imported}.${element.part}` : imported;
        const variant = node.parent.attributes.find(
          (attribute) => attribute.type === "JSXAttribute" && attribute.name.name === "variant",
        )?.value;
        const contract =
          (variant?.type === "Literal" &&
            restyleContracts[`${component}[variant=${variant.value}]`]) ||
          restyleContracts[component];

        if (!contract || contract.allow === "host") return;
        uses.push({ node, component, contract });
      },
      "Program:exit"() {
        for (const { node, component, contract } of uses) {
          const found = [];
          resolve(node.value.expression, found);
          const allowed = allowedBy(contract);
          const owned = privatePropertiesOf(contract.file);
          const rejected = new Map();

          for (const { label, properties } of found) {
            for (const property of properties) {
              if (allowed.has(property)) continue;

              if (property.startsWith("--") && !owned.has(property)) continue;

              if (!rejected.has(property)) rejected.set(property, label);
            }
          }

          if (rejected.size === 0) continue;
          const concerns = [...new Set([...rejected.keys()].map(concernOf))];
          const sources = [...new Set(rejected.values())];

          context.report({
            node,
            message:
              `<${component}> owns its ${list(concerns)}, so xstyle cannot set ` +
              `${list([...rejected.keys()])} (from ${list(sources)}). ` +
              advice(component, contract, concerns),
          });
        }
      },
    };
  },
};

export default {
  meta: { name: "nyte-restyle" },
  rules: { "no-restyle": noRestyle },
};
