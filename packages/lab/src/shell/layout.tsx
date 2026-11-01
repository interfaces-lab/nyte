import { create, props } from "@stylexjs/stylex";
import { useLocation, useMatches, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffectEvent } from "react";
import type { ReactElement, ReactNode } from "react";
import { shell, sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { sidebarStyles } from "@nyte-ai/app/sidebar/sidebar.stylex.ts";
import { preferences } from "@nyte-ai/app/preferences/index.ts";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { AppearanceDialog, CoreDialog } from "./dialogs.tsx";
import { Inspector } from "./inspector.tsx";
import { overrideSheet } from "./lab-search.ts";
import { useScheme } from "./scheme.ts";
import { useLabSearch } from "./use-lab-search.ts";

/** What a prototype's route declares in `staticData` to appear in the rail and title its bar. */
export interface Prototype {
  readonly title: string;
  readonly icon: IconName;
}

const RAIL_WIDTH = 208;

const INSPECTOR_WIDTH = 300;

const styles = create({
  shell: {
    display: "flex",
    height: "100dvh",
    backgroundColor: role.bgChrome,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  /** The lab's own panels lie flat on the chrome; only the prototype is raised. */
  panel: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minHeight: 0,
    backgroundColor: role.bgChrome,
  },
  rail: {
    width: RAIL_WIDTH,
    paddingInline: sidebar.gutter,
    paddingBlockEnd: space.s3,
  },
  inspector: {
    width: INSPECTOR_WIDTH,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    height: shell.titlebarHeight,
    paddingInline: sidebar.rowPaddingInline,
    color: role.contentSecondary,
    fontWeight: type.weightSemibold,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: sidebar.listGap,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  footer: { display: "flex", flexDirection: "column", gap: sidebar.listGap, flexShrink: 0 },
  canvas: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
  },
  /** The page's own bar, drawn by the shell from the route's `staticData`. */
  bar: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    height: shell.titlebarHeight,
    paddingInline: shell.cardInset,
  },
  title: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: type.weightSemibold,
  },
  /** The prototype's card, raised off the canvas so its edge is unmistakable. */
  artboard: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    marginInline: shell.cardInset,
    marginBlockEnd: shell.cardInset,
    borderRadius: shell.cardRadius,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderStrongTranslucent}, ${shadow.shadowLg}`,
    overflow: "clip",
  },
  /** Prototypes fill the stage with `flex: 1`, or flow and let it scroll. */
  stage: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    containerType: "inline-size",
  },
});

/**
 * The lab around every prototype. The lab is flat on the chrome: the rail, the prototype's bar and
 * the inspector. The prototype is the one raised card and nothing else; it gets the stage,
 * `useScheme`, `useDials` and core through the app's data layer, and declares its title and icon. ⌘\ hides both side panels to present it alone.
 */
export function LabShell({ children }: { readonly children: ReactNode }): ReactElement {
  const lab = useLabSearch();
  const scheme = useScheme();
  const railShown = lab.search.rail !== false;
  const inspectorShown = lab.search.inspector === true;

  const prototype = useMatches().findLast((match) => match.staticData.prototype !== undefined)
    ?.staticData.prototype;

  const onKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    if (event.key !== "\\" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    lab.update(
      railShown || inspectorShown ? { rail: false, inspector: undefined } : { rail: undefined },
    );
  });

  useMountEffect(() => {
    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div {...props(styles.shell)}>
      <style>{overrideSheet(lab.search)}</style>
      {railShown && <Rail />}
      <div {...props(styles.canvas)}>
        <header {...props(styles.bar)}>
          <Toggle
            size="sm"
            iconOnly
            icon="panel-left"
            aria-label="Prototypes"
            pressed={railShown}
            onPressedChange={(pressed) => lab.update({ rail: pressed ? undefined : false })}
          />
          <h1 {...props(text.base, styles.title)}>{prototype?.title ?? "Lab"}</h1>
          <ToggleGroup
            aria-label="Display mode"
            value={[scheme]}
            onValueChange={(values) => {
              const next = values.at(-1);

              if (next === "light" || next === "dark") preferences.theme.set(next);
            }}
          >
            <Toggle value="light" size="sm">
              Light
            </Toggle>
            <Toggle value="dark" size="sm">
              Dark
            </Toggle>
          </ToggleGroup>
          <Toggle
            size="sm"
            iconOnly
            icon="panel-right"
            aria-label="Inspector"
            pressed={inspectorShown}
            onPressedChange={(pressed) => lab.update({ inspector: pressed ? true : undefined })}
          />
        </header>
        <main data-lab-stage="" {...props(styles.artboard, styles.stage)}>
          {children}
        </main>
      </div>
      {inspectorShown && (
        <aside aria-label="Inspector" {...props(styles.panel, styles.inspector)}>
          <Inspector />
        </aside>
      )}
    </div>
  );
}

/**
 * Every route that declares a prototype, by title. The lab's router is untyped, so the rail reads
 * `staticData` as declared; createFileRoute type-checks it where each route sets it.
 */
function Rail(): ReactElement {
  const router = useRouter();
  const navigate = useNavigate();
  const current = useLocation().pathname;

  const prototypes = Object.values(router.routesById)
    .flatMap((route): readonly { readonly path: string; readonly prototype: Prototype }[] => {
      const prototype: Prototype | undefined = route.options.staticData?.prototype;
      const path: string = route.fullPath;

      return prototype === undefined ? [] : [{ path, prototype }];
    })
    .toSorted((left, right) => left.prototype.title.localeCompare(right.prototype.title));

  return (
    <nav aria-label="Prototypes" {...props(styles.panel, styles.rail)}>
      <div {...props(text.sm, styles.brand)}>Nyte Lab</div>
      <div {...props(styles.list)}>
        {prototypes.map((entry) => (
          <Row
            key={entry.path}
            variant="nav"
            selected={entry.path === current}
            aria-current={entry.path === current ? "page" : undefined}
            xstyle={sidebarStyles.navRow}
            onClick={() => void navigate({ to: entry.path })}
          >
            <Row.Leading xstyle={sidebarStyles.navLeading}>
              <Icon name={entry.prototype.icon} size="sm" />
            </Row.Leading>
            <Row.Label>{entry.prototype.title}</Row.Label>
          </Row>
        ))}
      </div>
      <div {...props(styles.footer)}>
        <AppearanceDialog />
        <CoreDialog />
      </div>
    </nav>
  );
}
