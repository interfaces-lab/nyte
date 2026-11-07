import { create, props, type StyleXStyles } from "@stylexjs/stylex";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Button } from "@nyte-ai/ui/button";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { ChangeStats } from "../src/components/change-stats.tsx";
import { turnStyles } from "../src/chat/transcript/turn.stylex.ts";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/styles/vars.stylex";

const styles = create({
  primary: { color: role.contentPrimary },
  secondary: { color: role.contentSecondary },
  tertiary: { color: role.contentTertiary },
  quaternary: { color: role.contentQuaternary },
  disabled: { color: role.contentDisabled },
  accent: { color: role.contentAccent },
  strokePrimary: { color: role.strokePrimary },
  strokeSecondary: { color: role.strokeSecondary },
  strokeTertiary: { color: role.strokeTertiary },
  strokeQuaternary: { color: role.strokeQuaternary },
  fillPrimary: { backgroundColor: role.fillPrimary },
  fillSecondary: { backgroundColor: role.fillSecondary },
  base: { backgroundColor: role.bgBase },
  muted: { backgroundColor: role.bgMuted },
  elevated: { backgroundColor: role.bgElevated },
  chromeSurface: { backgroundColor: role.bgChrome },
  fillTertiary: { backgroundColor: role.fillTertiary },
  button: { color: role.contentOnInteractiveStrong, backgroundColor: role.buttonFill },
  onControl: { color: role.contentOnControl, backgroundColor: role.bgControlSelected },
});

const stairs = [
  ["primary", styles.primary, 7],
  ["secondary", styles.secondary, 6],
  ["tertiary", styles.tertiary, 4.5],
  ["quaternary", styles.quaternary, 3],
  ["disabled", styles.disabled, 1],
] as const;

export async function mount(): Promise<void> {
  const container = document.createElement("div");
  container.id = "count-controls";
  document.body.append(container);
  document.documentElement.style.setProperty("--nyte-reduce-transparency", "1");
  flushSync(() => {
    createRoot(container).render(
      <div {...props(styles.base)}>
        {(["base", "chrome"] as const).flatMap((surface) =>
          [false, true].map((open) => (
            <div
              key={`${surface}-${String(open)}`}
              {...props(surface === "base" ? styles.base : styles.chromeSurface)}
            >
              <Button
                data-count-case={`${surface}-${open ? "open" : "closed"}`}
                data-change-stats-control=""
                aria-expanded={open}
              >
                <ChangeStats added={86} removed={24} />
              </Button>
            </div>
          )),
        )}
        <Row
          interactive
          data-count-case="turn-file"
          data-change-stats-control=""
          xstyle={turnStyles.changesFile}
        >
          <Row.Primary>
            <ChangeStats added={86} removed={24} />
          </Row.Primary>
        </Row>
        <Menu open>
          <MenuTrigger render={<Button>Scope</Button>} />
          <MenuContent>
            <MenuRadioGroup value="turn">
              <MenuRadioItem
                value="turn"
                data-count-case="menu"
                data-change-stats-control=""
                meta={<ChangeStats added={86} removed={24} />}
              >
                This turn
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </div>,
    );
  });
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  );
  const item = document.querySelector('[data-count-case="menu"]');

  if (item === null) throw new Error("Missing scope menu item");
  item.setAttribute("data-highlighted", "");
}

function backgroundLayers(element: Element): string[] {
  const computed = getComputedStyle(element);
  const overlay = computed.backgroundImage.match(/^linear-gradient\((.+), \1\)$/u)?.[1];

  if (computed.backgroundImage !== "none" && overlay === undefined)
    throw new Error(`Unexpected count background: ${computed.backgroundImage}`);

  return [
    ...(element.parentElement === null ? [] : backgroundLayers(element.parentElement)),
    computed.backgroundColor,
    ...(overlay === undefined ? [] : [overlay]),
  ];
}

export async function run(): Promise<string> {
  if (document.getElementById("count-controls") === null) await mount();
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) throw new Error("Missing canvas context");

  function luminance(layers: readonly string[]): number {
    if (!context) throw new Error("Missing canvas context");
    context.clearRect(0, 0, 1, 1);

    for (const layer of layers) {
      context.fillStyle = layer;
      context.fillRect(0, 0, 1, 1);
    }

    const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
      .slice(0, 3)
      .map((byte) => {
        const channel = byte / 255;

        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });

    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  const ratio = (first: number, second: number) =>
    (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);

  const results: {
    mode: string;
    scope: string;
    role: string;
    surface: string;
    ratio: number;
    minimum: number;
    color?: string;
    expected?: string;
  }[] = [];

  const hex = (color: string): string => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);

    return Array.from(context.getImageData(0, 0, 1, 1).data)
      .slice(0, 3)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };

  const scopes = [
    { name: "neutral", theme: [], hue: 250, chroma: 1 },
    ...Object.entries(surfaceTheme).map(([name, theme]) => ({ name, theme, hue: 250, chroma: 1 })),
    ...Array.from({ length: 36 }, (_, index) => index * 10).flatMap((hue) =>
      [0, 0.5, 1].map((chroma) => ({
        name: `custom-${hue}-${chroma}`,
        theme: surfaceTheme.custom,
        hue,
        chroma,
      })),
    ),
  ];

  for (const mode of ["light", "dark"]) {
    document.documentElement.style.colorScheme = mode;

    for (const { name: scope, theme, hue, chroma } of scopes) {
      const host = document.createElement("div");
      host.className = props(theme).className ?? "";
      host.style.setProperty("--nyte-custom-hue", String(hue));
      host.style.setProperty("--nyte-custom-chroma-scale", String(chroma));
      document.body.append(host);

      const sample = (style: StyleXStyles) => {
        const element = document.createElement("span");
        element.className = props(style).className ?? "";
        host.append(element);
        const computed = getComputedStyle(element);
        const colors = { color: computed.color, background: computed.backgroundColor };
        element.remove();

        return colors;
      };

      const hoverFill = sample(styles.fillTertiary).background;

      for (const [surface, background] of [
        ["base", styles.base],
        ["muted", styles.muted],
        ["elevated", styles.elevated],
        ["chrome", styles.chromeSurface],
      ] as const) {
        const ground = sample(background).background;

        for (const [layer, layers] of [
          [surface, [ground]],
          [`${surface}+hover`, [ground, hoverFill]],
        ] as const) {
          const ink = stairs.map(([name, style, minimum]) => ({
            name,
            minimum,
            ratio: ratio(luminance([...layers, sample(style).color]), luminance(layers)),
          }));

          for (const step of ink) {
            results.push({
              mode,
              scope,
              role: step.name,
              surface: layer,
              ratio: step.ratio,
              minimum: step.minimum,
            });
          }

          for (const [index, step] of ink.slice(1).entries()) {
            results.push({
              mode,
              scope,
              role: `${ink[index].name} above ${step.name}`,
              surface: layer,
              ratio: ink[index].ratio / step.ratio,
              minimum: 1.1,
            });
          }

          results.push({
            mode,
            scope,
            role: "strokePrimary",
            surface: layer,
            ratio: ratio(
              luminance([...layers, sample(styles.strokePrimary).color]),
              luminance(layers),
            ),
            minimum: 3,
          });
        }

        results.push({
          mode,
          scope,
          role: "accent",
          surface,
          ratio: ratio(luminance([ground, sample(styles.accent).color]), luminance([ground])),
          minimum: 4.5,
        });

        for (const [kind, ladder] of [
          [
            "stroke",
            [
              styles.strokePrimary,
              styles.strokeSecondary,
              styles.strokeTertiary,
              styles.strokeQuaternary,
            ].map((style) => sample(style).color),
          ],
          [
            "fill",
            [styles.fillPrimary, styles.fillSecondary, styles.fillTertiary].map(
              (style) => sample(style).background,
            ),
          ],
        ] as const) {
          const strength = ladder.map((color) =>
            ratio(luminance([ground, color]), luminance([ground])),
          );

          for (const [index, next] of strength.slice(1).entries()) {
            results.push({
              mode,
              scope,
              role: `${kind} ${String(index + 1)} above ${String(index + 2)}`,
              surface,
              ratio: strength[index] / next,
              minimum: 1.02,
            });
          }
        }
      }

      const control = sample(styles.onControl);
      results.push({
        mode,
        scope,
        role: "onControl",
        surface: "controlSelected",
        ratio: ratio(luminance([control.color]), luminance([control.background])),
        minimum: 3,
      });
      host.remove();
    }

    for (const control of document.querySelectorAll("[data-count-case]")) {
      const stats = control.querySelector('[aria-label="86 added, 24 removed"]');

      if (stats === null || stats.children.length !== 2)
        throw new Error("Missing ChangeStats counts");

      const neutral = control.matches(":active, [aria-expanded=true], [data-highlighted]");
      const more = matchMedia("(prefers-contrast: more)").matches;

      const palette =
        mode === "light"
          ? ["116d3e", "a63536"]
          : more
            ? ["78bd90", "e28d88"]
            : ["0bcb74", "ff535a"];

      for (const [index, label] of Array.from(stats.children).entries()) {
        const color = getComputedStyle(label).color;
        const layers = backgroundLayers(label);
        results.push({
          mode,
          scope: `${index === 0 ? "green" : "red"}-on-neutral`,
          role: "count",
          surface: `${control.getAttribute("data-count-case")}+${control.matches(":active") ? "held" : control.matches(":hover") ? "hover" : "rest"}`,
          ratio: ratio(luminance([...layers, color]), luminance(layers)),
          minimum: 4.5,
          color: hex(color),
          expected: neutral ? hex(getComputedStyle(stats).color) : palette[index],
        });
      }
    }

    for (const scope of ["blue", "red"] as const) {
      const element = document.createElement("span");
      element.className = props(surfaceTheme[scope], styles.button).className ?? "";
      document.body.append(element);
      const computed = getComputedStyle(element);
      results.push({
        mode,
        scope,
        role: "buttonLabel",
        surface: "buttonFill",
        ratio: ratio(luminance([computed.color]), luminance([computed.backgroundColor])),
        minimum: 4.5,
      });
      element.remove();
    }
  }

  return JSON.stringify(results);
}
