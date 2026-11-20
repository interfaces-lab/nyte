import {
  ArrowDown,
  Bot,
  Book,
  Bridge,
  ChartLine,
  Check,
  CodeXml,
  Component,
  Copy,
  Database,
  Hammer,
  Layers,
  ListTodo,
  Menu,
  Monitor,
  Moon,
  Package,
  Plug,
  Radio,
  Repeat,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Smile,
  Sparkle,
  SquareTerminal,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { createElement } from "react";

import type { DocsGlyph, DocsGlyphName } from "./names.ts";

function lucide(icon: LucideIcon): DocsGlyph {
  const glyph = ({ size }: { readonly size?: number | string }) =>
    createElement(icon, { size, strokeWidth: 1.5, "aria-hidden": true });

  glyph.displayName = `Lucide(${icon.displayName ?? "Icon"})`;

  return glyph;
}

export const glyphs = {
  IconAgent: lucide(Bot),
  IconArrowDown: lucide(ArrowDown),
  IconArrowsRepeat: lucide(Repeat),
  IconBarsTwo: lucide(Menu),
  IconBookSimple: lucide(Book),
  IconBridge: lucide(Bridge),
  IconChart1: lucide(ChartLine),
  IconCheckmark1Small: lucide(Check),
  IconClipboard: lucide(Copy),
  IconCodeBrackets: lucide(CodeXml),
  IconComponents: lucide(Component),
  IconConsole: lucide(SquareTerminal),
  IconCrossSmall: lucide(X),
  IconFinderFace: lucide(Smile),
  IconHammer: lucide(Hammer),
  IconImac: lucide(Monitor),
  IconLayersThree: lucide(Layers),
  IconMagnifyingGlass: lucide(Search),
  IconMoon: lucide(Moon),
  IconPackage: lucide(Package),
  IconPlan: lucide(ListTodo),
  IconPlugin1: lucide(Plug),
  IconRocket: lucide(Rocket),
  IconSettingsGear1: lucide(Settings),
  IconShieldCheck: lucide(ShieldCheck),
  IconSparkle: lucide(Sparkle),
  IconStorage: lucide(Database),
  IconStreaming: lucide(Radio),
  IconSun: lucide(Sun),
} satisfies Readonly<Record<DocsGlyphName, DocsGlyph>>;
