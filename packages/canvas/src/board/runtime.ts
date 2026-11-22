import { Component } from "react";
import type { ElementType, Key, ReactElement, ReactNode } from "react";
import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from "react/jsx-runtime";
import { DESIGN_ATTRIBUTE } from "@nyte-ai/plugin/design/board-protocol";

type Props = Readonly<Record<string, unknown>>;

type Render = (props: Props) => ReactNode;

const VIA = "__nyteVia";

let chain: readonly string[] = [];

const chains = new Map<string, readonly string[]>([["[]", []]]);

const wrappers = new WeakMap<Render, Render>();

function without(props: Props, name: string): Props {
  return Object.fromEntries(Object.entries(props).filter((entry) => entry[0] !== name));
}

// oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- typeof narrows a component type only to Function, not to a callable render
function rendersAsFunction(type: unknown): type is Render {
  return typeof type === "function" && !(type.prototype instanceof Component);
}

function wrap(type: Render): Render {
  const known = wrappers.get(type);

  if (known !== undefined) return known;

  const instance = (props: Props): ReactNode => {
    const outer = chain;
    chain = chains.get(String(props[VIA])) ?? [];

    try {
      return type(without(props, VIA));
    } finally {
      chain = outer;
    }
  };

  wrappers.set(type, instance);

  return instance;
}

function remember(next: readonly string[]): string {
  const key = JSON.stringify(next);

  if (!chains.has(key)) chains.set(key, next);

  return key;
}

function stamp(
  make: typeof reactJsx,
  type: ElementType,
  props: Props,
  key: Key | undefined,
): ReactElement {
  if (typeof type === "string") {
    return make(
      type,
      chain.length === 0 ? props : { ...props, [DESIGN_ATTRIBUTE.via]: remember(chain) },
      key,
    );
  }
  const src = props[DESIGN_ATTRIBUTE.source];
  const own = typeof src === "string" ? without(props, DESIGN_ATTRIBUTE.source) : props;

  if (!rendersAsFunction(type)) return make(type, own, key);

  return make(
    wrap(type),
    { ...own, [VIA]: remember(typeof src === "string" ? [...chain, src] : chain) },
    key,
  );
}

export const boardJsxRuntime = {
  Fragment,
  jsx: (type: ElementType, props: Props, key?: Key): ReactElement =>
    stamp(reactJsx, type, props, key),
  jsxs: (type: ElementType, props: Props, key?: Key): ReactElement =>
    stamp(reactJsxs, type, props, key),
};

/** The instance chain a host node was drawn in, outermost first. */
export function readVia(node: Element): readonly string[] {
  return chains.get(node.getAttribute(DESIGN_ATTRIBUTE.via) ?? "[]") ?? [];
}
