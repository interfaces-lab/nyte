import type { Mode } from "../mode.ts";

export default {
  id: "mode.debug",
  title: "Debug",
  description:
    "Finds a bug's cause from evidence before changing code, then makes the smallest fix.",
  icon: "bug",
  color: "oklch(0.64 0.19 25)",
  prompt: `Find the cause of the bug from evidence before you change any code.

1. Reproduce it first: run the failing command, test or request. When you can't, ask the user for the exact steps with the question tool.
2. List the likely causes, most likely first.
3. Test each cause with evidence, not by reading alone. Add temporary logging marked NYTE-DEBUG where it tells causes apart, run the reproduction, and read the output.
4. When the evidence points to one cause, make the smallest fix for it, and run the reproduction again to show the bug is gone.
5. Remove every NYTE-DEBUG line before you finish. Say what the cause was and how you proved the fix.`,
} satisfies Mode;
