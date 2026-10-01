import { create, props } from "@stylexjs/stylex";
import { surfaceTheme } from "../../ui/src/surface-theme.ts";
import { role } from "../../ui/src/vars.stylex.ts";

const styles = create({
  glyph: { color: role.contentInteractivePrimary, backgroundColor: role.bgBase },
});

export function run(): string {
  const host = document.createElement("div");
  const scopes = [surfaceTheme.blue, surfaceTheme.red, surfaceTheme.green, surfaceTheme.gray];
  for (let index = 0; index < 2000; index += 1) {
    const glyph = document.createElement("span");
    glyph.className = props(scopes[index % scopes.length], styles.glyph).className ?? "";
    glyph.textContent = "●";
    host.append(glyph);
  }
  document.body.append(host);
  const samples: number[] = [];
  let checksum = 0;
  for (let pass = 0; pass < 30; pass += 1) {
    const start = performance.now();
    document.documentElement.style.colorScheme = pass % 2 ? "dark" : "light";
    for (const glyph of host.children) checksum += getComputedStyle(glyph).color.length;
    const elapsed = performance.now() - start;
    if (pass >= 5) samples.push(elapsed);
  }
  host.remove();
  samples.sort((first, second) => first - second);
  return JSON.stringify({
    glyphs: 2000,
    checksum,
    passes: samples.length,
    medianMs: samples[Math.floor(samples.length / 2)],
    maxMs: samples.at(-1),
  });
}
