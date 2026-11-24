import { role, type } from "./styles/vars.stylex.ts";

export const MERMAID_COLORS = {
  bg: role.bgElevated,
  fg: role.contentPrimary,
  accent: role.contentAccent,
  muted: role.contentSecondary,
  surface: role.fillTertiary,
  border: role.strokeTertiary,
  line: role.contentQuaternary,
} as const;

/**
 * beautiful-mermaid's `<style>` is unlayered and reaches the whole page, and its derived
 * `--_text-faint` fades text below the contrast floor.
 */
export function cleanMermaidSvg(svg: string): string {
  return svg
    .replaceAll(/^ *@import .*\n/gm, "")
    .replace(/^ *text \{ font-family: .*\n/m, "")
    .replace(/(\.mono \{ font-family: )[^;]*/, `$1${type.fontMono}`)
    .replace(/<svg\b[^>]*\bstyle="/, `$&--_text-faint:${role.contentTertiary};`);
}
