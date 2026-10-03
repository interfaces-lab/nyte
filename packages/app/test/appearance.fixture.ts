import { create, props } from "@stylexjs/stylex";
import { appearance } from "../../ui/src/vars.stylex.ts";
import {
  applyDisplayMode,
  applyFocusModality,
  applyPointerCursors,
  applyTint,
  applyTransparency,
} from "../src/theme/appearance.ts";

const styles = create({
  sample: {
    cursor: appearance.cursorInteractive,
    backdropFilter: appearance.popupMaterialFilter,
    outlineColor: appearance.focusRing,
  },
});

export function run(): string {
  const root = document.documentElement;
  root.classList.add("external-class");
  const sample = document.createElement("div");
  sample.className = props(styles.sample).className ?? "";
  document.body.append(sample);

  for (const mode of ["light", "dark"] as const) {
    for (const pointer of [false, true]) {
      for (const reduced of [false, true]) {
        for (const modality of ["pointer", "keyboard"] as const) {
          applyDisplayMode(mode);
          applyPointerCursors(pointer);
          applyFocusModality(modality);
          applyTint(true);
          applyTransparency(reduced);
          const computed = getComputedStyle(sample);

          if (getComputedStyle(root).colorScheme !== mode) return `${mode}: incorrect color scheme`;

          if (computed.cursor !== (pointer ? "pointer" : "default"))
            return `${mode}: cursor concern was overwritten`;

          if (!computed.backdropFilter.includes("blur(12px)"))
            return `${mode}: missing material filter`;

          if (computed.backdropFilter.includes("brightness") !== (mode === "dark"))
            return `${mode}: display filter was overwritten`;
          const focusRing = computed.outlineColor;
          const transparent = focusRing === "rgba(0, 0, 0, 0)";

          if (transparent !== (modality === "pointer"))
            return `${mode}: focus concern was overwritten`;

          if (!root.classList.contains("external-class"))
            return "An appearance update replaced an unrelated root class";
          applyTint(false);
          applyDisplayMode(mode);

          if (getComputedStyle(sample).cursor !== (pointer ? "pointer" : "default"))
            return "Display update replaced the cursor concern";

          if (getComputedStyle(sample).outlineColor !== focusRing)
            return "Display update replaced the focus concern";
        }
      }
    }
  }

  sample.remove();

  return "passed";
}
