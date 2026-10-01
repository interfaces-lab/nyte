import { create, props } from "@stylexjs/stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";

const styles = create({
  shell: {
    "--startup-bg": role.bgBase,
    "--startup-text": role.contentPrimary,
    "--startup-font": type.fontSans,
  },
  retry: {
    "--startup-fill": role.bgInteractiveStrong,
    "--startup-hover": role.bgInteractiveStrongHover,
    "--startup-pressed": role.bgInteractiveStrongPressed,
    "--startup-on-fill": role.contentOnInteractiveStrong,
    "--startup-accent": appearance.focusRing,
  },
});

export function applyStartupTheme({
  shell,
  retry,
}: {
  readonly shell: HTMLElement | null;
  readonly retry: HTMLElement | null;
}): void {
  if (shell !== null) shell.className = props(styles.shell).className ?? "";
  if (retry !== null) retry.className = props(intent.primary, styles.retry).className ?? "";
}
