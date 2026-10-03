import { create, props } from "@stylexjs/stylex";
import { role } from "@nyte-ai/ui/vars.stylex";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Button } from "@nyte-ai/ui/button";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Toggle } from "@nyte-ai/ui/toggle";
import { Toolbar } from "@nyte-ai/ui/toolbar";
import { iconReferences } from "../../ui/test/icon-references.ts";
import { applyDisplayMode } from "../src/theme/appearance.ts";
import "../src/theme/tokens.stylex.ts";

const styles = create({
  host: { color: role.contentSecondary },
  secondary: { color: role.contentSecondary },
  primary: { color: role.contentPrimary },
  solid: { color: role.contentOnInteractiveStrong },
  text: { color: role.contentInteractivePrimary },
});

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function raster(sample: Element) {
  const original = sample.querySelector("svg");

  if (!original) throw new Error("Missing glyph");
  const copy = original.cloneNode(true);

  if (!(copy instanceof SVGElement)) throw new Error("Missing SVG clone");
  const originals = [original, ...original.querySelectorAll("*")];
  const copies = [copy, ...copy.querySelectorAll("*")];
  originals.forEach((element, index) => {
    const destination = copies[index];

    if (!(destination instanceof SVGElement)) throw new Error("Invalid SVG child");
    const computed = getComputedStyle(element);

    for (const property of ["color", "fill", "stroke", "stroke-width", "opacity"]) {
      destination.style.setProperty(property, computed.getPropertyValue(property));
    }
  });
  let opacity = Number(getComputedStyle(original).opacity);

  for (
    let parent = original.parentElement;
    parent && parent !== sample;
    parent = parent.parentElement
  ) {
    opacity *= Number(getComputedStyle(parent).opacity);
  }

  copy.style.opacity = String(opacity);
  const image = new Image();

  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }),
  );

  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");

    if (!context) throw new Error("Missing canvas context");
    context.drawImage(image, 0, 0, 16, 16);
    const pixels = context.getImageData(0, 0, 16, 16).data;
    let ink = 0;
    let luminance = 0;

    const linear = (value: number): number => {
      const channel = value / 255;

      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    };

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] / 255;
      ink += alpha;
      luminance +=
        alpha *
        (0.2126 * linear(pixels[index]) +
          0.7152 * linear(pixels[index + 1]) +
          0.0722 * linear(pixels[index + 2]));
    }

    return { ink, luminance: luminance / ink, color: getComputedStyle(original).color };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const host = document.createElement("div");

const root = createRoot(host);

let mounted = false;

export function mount(): void {
  if (mounted) return;
  mounted = true;
  document.body.append(host);
  flushSync(() =>
    root.render(
      <>
        <style>{"* { transition: none !important; }"}</style>
        {iconReferences.flatMap(({ name, outlined, filled }) =>
          (["outlined", "filled"] as const).map((variant) => {
            const Reference = variant === "outlined" ? outlined : filled;

            return (
              <div key={`${name}:${variant}`} data-icon-pair={`${name}:${variant}`}>
                <span data-sample>
                  <Icon name={name} variant={variant} size={16} />
                </span>
                <span data-reference>
                  <Reference size={16} mode="raw" ariaHidden />
                </span>
              </div>
            );
          }),
        )}
        {(["left", "right"] as const).flatMap((side) =>
          [false, true].map((visible) => (
            <div key={`${side}:${visible}`} data-panel={`${side}:${visible}`}>
              <PanelToggleIcon side={side} visible={visible} size={16} />
            </div>
          )),
        )}
        {[false, true].flatMap((disabled) =>
          [false, true].map((pressed) => (
            <div key={`${disabled}:${pressed}`} data-control={`${disabled}:${pressed}`}>
              <Toggle iconOnly aria-label="Toggle panel" disabled={disabled} pressed={pressed}>
                <PanelToggleIcon side="left" visible={pressed} size={16} />
              </Toggle>
            </div>
          )),
        )}
        {(["ghost", "outline", "solid", "plain", "text"] as const).flatMap((variant) =>
          [false, true].map((disabled) => (
            <div key={`${variant}:${disabled}`} data-control={`button:${variant}:${disabled}`}>
              <Button variant={variant} disabled={disabled} iconOnly aria-label="Back">
                <Icon
                  name="arrow-left"
                  variant="filled"
                  size={16}
                  style={{ color: "red", opacity: 0.2 }}
                />
              </Button>
            </div>
          )),
        )}
        <div data-control="local">
          <Button iconOnly aria-label="Back">
            <Icon name="arrow-left" size={16} style={{ color: "red", opacity: 0.2 }} />
          </Button>
        </div>
        <div data-control="toolbar">
          <Toolbar.Root>
            <Toolbar.Button render={<Button iconOnly aria-label="Back" />}>
              <Icon name="arrow-left" size={16} style={{ color: "red", opacity: 0.2 }} />
            </Toolbar.Button>
          </Toolbar.Root>
        </div>
      </>,
    ),
  );
}

export async function run(): Promise<string> {
  mount();

  try {
    for (const mode of ["light", "dark"] as const) {
      applyDisplayMode(mode);
      host.className = props(styles.host).className ?? "";

      for (const pair of host.querySelectorAll("[data-icon-pair]")) {
        const sample = pair.querySelector("[data-sample]");
        const reference = pair.querySelector("[data-reference]");

        if (!sample || !reference) throw new Error("Missing reference pair");
        const actual = await raster(sample);
        const expected = await raster(reference);
        const name = `${mode} ${pair.getAttribute("data-icon-pair")}`;
        check(actual.ink > 0, `${name} is blank`);
        check(Math.abs(actual.ink / expected.ink - 1) < 0.05, `${name} ink changed`);
        check(Math.abs(actual.luminance - expected.luminance) < 0.015, `${name} luminance changed`);
      }

      for (const side of ["left", "right"]) {
        const sample = host.querySelector(`[data-panel="${side}:false"]`);

        const reference = host.querySelector(
          `[data-icon-pair="panel-${side}:outlined"] [data-reference]`,
        );

        if (!sample || !reference) throw new Error("Missing panel reference");
        const actual = await raster(sample);
        const expected = await raster(reference);
        check(Math.abs(actual.ink / expected.ink - 1) < 0.05, `${mode} panel ink changed`);
        check(
          Math.abs(actual.luminance - expected.luminance) < 0.015,
          `${mode} panel luminance changed`,
        );
      }

      const colors = new Map<string, string>();
      const opacities = new Map<string, string>();

      for (const sample of host.querySelectorAll("[data-control]")) {
        const control = sample.querySelector("button");

        if (!control) throw new Error("Missing control");
        const actual = await raster(sample);
        check(
          actual.color === getComputedStyle(control).color,
          `${mode} glyph must inherit control color`,
        );
        const name = sample.getAttribute("data-control") ?? "";
        colors.set(name, actual.color);
        opacities.set(name, getComputedStyle(control).opacity);

        if (name.startsWith("button:")) {
          const variant = name.split(":")[1];
          const disabled = name.endsWith(":true");
          const forced = document.documentElement.dataset.iconForced !== undefined;

          const expectedStyle =
            variant === "solid"
              ? styles.solid
              : forced && !disabled
                ? styles.primary
                : variant === "text"
                  ? styles.text
                  : styles.secondary;

          const probe = document.createElement("span");
          probe.className = props(expectedStyle).className ?? "";
          control.append(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          check(actual.color === expected, `${mode} ${name} must use its control-state role`);
          check(
            (getComputedStyle(control).opacity === "0.5") === disabled,
            `${mode} ${name} must dim only when disabled`,
          );
        }

        if (name.startsWith("button:") || name === "toolbar" || name === "local") {
          const reference = host.querySelector(
            `[data-icon-pair="arrow-left:${name === "toolbar" || name === "local" ? "outlined" : "filled"}"] [data-reference]`,
          );

          if (!reference) throw new Error("Missing button reference");
          // A disabled control dims as a whole; only the glyph's own opacity must not leak.
          const dimming = Number(getComputedStyle(control).opacity);
          check(
            Math.abs(actual.ink / ((await raster(reference)).ink * dimming) - 1) < 0.05,
            `${mode} local opacity changed control ink`,
          );
        }
      }

      check(
        colors.get("false:false") !== colors.get("false:true"),
        "Selection must change the control color",
      );
      check(opacities.get("true:false") === "0.5", "Disabled must dim the control");
      check(
        colors.get("true:false") === colors.get("true:true"),
        "Disabled must win over selection",
      );
    }

    return "passed";
  } finally {
    root.unmount();
    host.remove();
  }
}
