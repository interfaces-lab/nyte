/** Lucide at stroke 1.5 for the iOS completion glyphs; used when Central isn't installed. */
import { Command, File, Folder, Puzzle } from "lucide-react";
import { createElement } from "react";

const lucide = (icon) => () => createElement(icon, { strokeWidth: 1.5, "aria-hidden": true });

export const glyphs = {
  file: lucide(File),
  folder: lucide(Folder),
  command: lucide(Command),
  skill: lucide(Puzzle),
};
