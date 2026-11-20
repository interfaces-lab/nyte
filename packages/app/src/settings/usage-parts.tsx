import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { floatingSurfaceStyles } from "@nyte-ai/ui/styles/floating-surface.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { intent, surfaceTheme, type Tint } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { createContext, use } from "react";
import type { ReactElement, ReactNode } from "react";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { usageStyles as styles } from "./usage-settings.stylex.ts";

export interface UsageFocus {
  readonly active: string | undefined;
  readonly pinned: string | undefined;
  readonly names: ReadonlyMap<string, string>;
  readonly hover: (key: string | undefined) => void;
  readonly toggle: (key: string) => void;
}

export const UsageFocusContext = createContext<UsageFocus>({
  active: undefined,
  pinned: undefined,
  names: new Map(),
  hover: () => undefined,
  toggle: () => undefined,
});

export function useUsageFocus(): UsageFocus {
  return use(UsageFocusContext);
}

export function modelTint(focus: UsageFocus, key: string): Tint | undefined {
  return key === focus.active ? "blue" : undefined;
}

export function tintScope(tint: Tint | undefined): (typeof surfaceTheme)[Tint] | null {
  return tint === undefined ? null : surfaceTheme[tint];
}

export const focusRing = focus.ringInset;

export const tipSurface = [floatingSurfaceStyles.material, styles.tip] as const;

export function SectionHead({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.head)}>
      <div {...props(settingsPatterns.sectionHeader, styles.headCopy)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>{title}</h2>
      </div>
      {children !== undefined && <div {...props(styles.actions)}>{children}</div>}
    </div>
  );
}

export function ShareBar({
  share,
  tint,
}: {
  readonly share: number;
  readonly tint: Tint | undefined;
}): ReactElement {
  return (
    <span aria-hidden="true" {...props(styles.track)}>
      <span
        {...props(tintScope(tint), styles.fill, tint !== undefined && styles.fillLit)}
        style={{ transform: `scaleX(${String(Math.min(Math.max(share, 0), 1))})` }}
      />
    </span>
  );
}

export function Swatch({ tint }: { readonly tint: Tint | undefined }): ReactElement {
  return (
    <span
      aria-hidden="true"
      {...props(tintScope(tint), styles.swatch, tint !== undefined && styles.swatchLit)}
    />
  );
}

export function Bone({
  width,
  height,
}: {
  readonly width: number | string;
  readonly height: number;
}): ReactElement {
  return <span aria-hidden="true" {...props(styles.bone)} style={{ width, height }} />;
}

export function Notice({
  children,
  alert = false,
  action,
}: {
  readonly children: ReactNode;
  readonly alert?: boolean;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <p role={alert ? "alert" : "status"} {...props(text.sm, styles.notice)}>
      <Icon name="warning" size="sm" {...props(intent.warning, styles.noticeIcon)} />
      <span {...props(styles.noticeCopy)}>{children}</span>
      {action}
    </p>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.empty)}>
      <span {...props(text.base, styles.emptyTitle)}>{title}</span>
      <p {...props(text.sm, styles.emptyBody)}>{body}</p>
      {action !== undefined && <span {...props(styles.emptyAction)}>{action}</span>}
    </div>
  );
}

export function PinnedModel(): ReactElement | null {
  const focus = useUsageFocus();

  if (focus.pinned === undefined) return null;
  const pinned = focus.pinned;

  return (
    <span {...props(text.sm, styles.pinned)}>
      <Icon name="pin" size="sm" {...props(styles.pinIcon)} />
      <span {...props(styles.pinnedName)}>{focus.names.get(pinned) ?? pinned}</span>
      <Button variant="text" size="sm" onClick={() => focus.toggle(pinned)}>
        Clear Focus
      </Button>
    </span>
  );
}
