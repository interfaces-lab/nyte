import { create, props } from "@stylexjs/stylex";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyDisplayMode, applyTint } from "@nyte-ai/ui/appearance";
import { Button } from "@nyte-ai/ui/button";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { appearance, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { applyFocusModality, applyTransparency } from "../src/theme/appearance.ts";
import "../src/theme/tokens.stylex.ts";
import "../src/theme/global.css";

const app = create({
  override: { backgroundColor: "rgb(1, 2, 3)", color: "rgb(4, 5, 6)", paddingInline: 13 },
  radius: { borderRadius: 3 },
  line: { fontSize: type.fontBase, lineHeight: type.leadingBase },
  focus: { outlineColor: appearance.focusRing },
});

/** Gradients, not colours: they paint `background-image`. */
const nonColorRoles = new Set(["layerHover", "layerPressed"]);

/** Roles roles.stylex.ts resolves to one value in both schemes, on purpose. */
const schemeIndependentRoles = new Map([
  ["contentOnInteractiveStrong", "theme-0: the label on a strong fill is white in both modes"],
  ["contentOnControl", "neutral-0: a switch knob or checkbox mark is white in both modes"],
  ["borderControl", "control(80, 80): an unchecked control's edge is one gray"],
  ["borderInteractivePrimary", "theme-80: the accent edge is the hue's own step"],
  ["buttonFill", "theme-80 capped in lightness so a white label reads at 4.5:1"],
  ["buttonFillHover", "shade(button-fill, 0.95, 0.95)"],
  ["buttonFillPressed", "shade(button-fill, 0.88, 0.88)"],
]);

const transparent = "rgba(0, 0, 0, 0)";

const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

function probe(parent: Element, value: string): string {
  const element = document.createElement("div");
  element.style.backgroundColor = value;
  parent.append(element);
  const color = getComputedStyle(element).backgroundColor;
  element.remove();

  return color;
}

function alpha(color: string): number {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (context === null) throw new Error("No 2D canvas");
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);

  return context.getImageData(0, 0, 1, 1).data[3] / 255;
}

async function userAgentDefaults(): Promise<{ button: string; svg: string }> {
  const frameElement = document.createElement("iframe");
  frameElement.srcdoc = "<button>UA</button><svg></svg>";
  const loaded = new Promise((resolve) => frameElement.addEventListener("load", resolve));
  document.body.append(frameElement);
  await loaded;
  const button = frameElement.contentDocument?.querySelector("button");
  const svg = frameElement.contentDocument?.querySelector("svg");

  if (button == null || svg == null) throw new Error("User-agent frame did not load");

  const defaults = {
    button: getComputedStyle(button).backgroundColor,
    svg: getComputedStyle(svg).display,
  };

  frameElement.remove();

  return defaults;
}

export async function run(): Promise<string> {
  const failures: string[] = [];
  const html = document.documentElement;

  const check = (name: string, actual: string, expected: string) => {
    if (actual !== expected) failures.push(`${name}: ${actual}, expected ${expected}`);
  };

  check("html background", getComputedStyle(html).backgroundColor, transparent);
  check("body background", getComputedStyle(document.body).backgroundColor, transparent);
  check("html color-scheme without a display mode", getComputedStyle(html).colorScheme, "normal");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  try {
    flushSync(() =>
      root.render(
        <>
          <button id="plain">Plain</button>
          <svg id="glyph" />
          <Button id="component" variant="solid">
            Save
          </Button>
          <Button
            id="composed"
            variant="solid"
            className={props(app.override).className}
            xstyle={app.radius}
          >
            Save
          </Button>
          <p id="text" {...props(app.line, app.focus)}>
            Text
          </p>
          <div id="scope" {...props(surfaceTheme.custom)} />
        </>,
      ),
    );
    await frame();

    const element = (id: string) => {
      const found = document.getElementById(id);

      if (found === null) throw new Error(`Missing #${id}`);

      return found;
    };

    const defaults = await userAgentDefaults();
    const plain = getComputedStyle(element("plain"));

    if (defaults.button === transparent)
      failures.push("UA button background is already transparent");

    if (defaults.svg === "block") failures.push("UA svg display is already block");
    check("base beats UA: button background-color", plain.backgroundColor, transparent);
    check("base beats UA: button padding-inline-start", plain.paddingInlineStart, "0px");
    check("base beats UA: svg display", getComputedStyle(element("glyph")).display, "block");

    const component = getComputedStyle(element("component"));
    check(
      "component beats base: background-color",
      component.backgroundColor,
      probe(host, role.buttonFill),
    );
    check(
      "component beats base: color",
      component.color,
      probe(host, role.contentOnInteractiveStrong),
    );
    check("component beats base: padding-inline-start", component.paddingInlineStart, "8px");
    check("component beats base: font-weight", component.fontWeight, "500");

    if (component.borderTopLeftRadius === "0px")
      failures.push("base border-radius: 0 beat the component");

    const composed = getComputedStyle(element("composed"));
    check("app beats component: background-color", composed.backgroundColor, "rgb(1, 2, 3)");
    check("app beats component: color", composed.color, "rgb(4, 5, 6)");
    check("app beats component: padding-inline-start", composed.paddingInlineStart, "13px");
    check("app xstyle beats component: border-radius", composed.borderTopLeftRadius, "3px");

    const resolveRoles = (mode: "light" | "dark") => {
      applyDisplayMode(mode);

      return new Map(
        Object.entries(role)
          .filter(([name]) => !nonColorRoles.has(name))
          .map(([name, value]) => [name, probe(host, value)]),
      );
    };

    const light = resolveRoles("light");
    const dark = resolveRoles("dark");

    for (const [name, lightColor] of light) {
      const same = lightColor === dark.get(name);
      const reason = schemeIndependentRoles.get(name);

      if (same && reason === undefined)
        failures.push(`role.${name} is ${lightColor} in light and dark`);

      if (!same && reason !== undefined)
        failures.push(`role.${name} is allowlisted as scheme-independent (${reason}) but differs`);
    }

    for (const mode of ["light", "dark"] as const) {
      applyDisplayMode(mode);

      for (const material of ["popupMaterial", "sidebarMaterial"] as const) {
        applyTransparency(true);
        const opaque = alpha(probe(host, role[material]));
        applyTransparency(false);
        const translucent = alpha(probe(host, role[material]));

        if (opaque !== 1)
          failures.push(`${mode} ${material} with reduced transparency: alpha ${opaque}`);

        if ((material === "popupMaterial" || mode === "dark") && translucent === 1)
          failures.push(`${mode} ${material} without reduced transparency is opaque`);
      }
    }

    applyDisplayMode("light");

    const strongAtHue = (parent: Element, hue: string) => {
      html.style.setProperty("--nyte-custom-hue", hue);

      return probe(parent, role.bgInteractiveStrong);
    };

    const scope = element("scope");

    if (strongAtHue(scope, "250") === strongAtHue(scope, "30"))
      failures.push("--nyte-custom-hue does not reach a tinted role inside a custom scope");
    applyTint(true);

    if (strongAtHue(host, "250") === strongAtHue(host, "30"))
      failures.push("applyTint(true): --nyte-custom-hue does not reach a tinted role");
    applyTint(false);

    if (strongAtHue(host, "250") !== strongAtHue(host, "30"))
      failures.push("applyTint(false): --nyte-custom-hue still moves an untinted role");
    html.style.removeProperty("--nyte-custom-hue");

    const text = element("text");
    const smoothing = () => getComputedStyle(text).getPropertyValue("-webkit-font-smoothing");
    check("default font smoothing", smoothing(), "antialiased");
    html.style.setProperty("--nyte-font-smoothing", "auto");
    check("--nyte-font-smoothing: auto reaches a descendant", smoothing(), "auto");
    html.style.removeProperty("--nyte-font-smoothing");

    for (const size of [12, 13, 14, 15, 16]) {
      html.style.setProperty("--nyte-font-size-base", `${size}px`);
      const computed = getComputedStyle(text);
      check(`${size}px base: font-size`, computed.fontSize, `${size}px`);
      check(
        `${size}px base: type.leadingBase`,
        computed.lineHeight,
        `${Math.ceil((size * 18) / 13)}px`,
      );

      if (!Number.isInteger(Number.parseFloat(computed.lineHeight)))
        failures.push(`${size}px base: line-height ${computed.lineHeight} is not a whole pixel`);
    }

    html.style.removeProperty("--nyte-font-size-base");

    applyFocusModality("pointer");
    check(
      "pointer modality: appearance.focusRing",
      getComputedStyle(text).outlineColor,
      transparent,
    );
    applyFocusModality("keyboard");

    if (getComputedStyle(text).outlineColor === transparent)
      failures.push("keyboard modality: appearance.focusRing is transparent");

    return failures.length ? failures.join("\n") : "passed";
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}
