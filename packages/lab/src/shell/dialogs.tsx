import { create, props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { connectLocalHost } from "@nyte-ai/app/data/local-host.ts";
import { sidebarStyles } from "@nyte-ai/app/sidebar/sidebar.stylex.ts";
import { AppearanceSettings } from "@nyte-ai/app/settings/appearance.tsx";
import { ProvidersSettings } from "@nyte-ai/app/settings/models-settings.tsx";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

const Servers = Type.Array(Type.String());

const styles = create({
  popup: { width: "min(720px, calc(100vw - 48px))" },
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  facts: { display: "flex", flexDirection: "column", gap: space.s1, margin: 0 },
  fact: { margin: 0, color: role.contentSecondary },
  code: { fontFamily: type.fontMono, color: role.contentPrimary },
  failed: { margin: 0, color: role.contentPrimary },
});

/** The app's own Appearance settings, writing the preferences the app's boot applies. */
export function AppearanceDialog(): ReactElement {
  return (
    <RailDialog icon="customize" label="Appearance">
      <AppearanceSettings />
    </RailDialog>
  );
}

/**
 * The lab's core: a host the dev server opens on this checkout with its own home, read-only. Its
 * providers sign in here; its MCP servers come from the home's `.nyte/mcp.json`.
 */
export function CoreDialog(): ReactElement {
  return (
    <RailDialog icon="cube" label="Core">
      <CoreBody />
    </RailDialog>
  );
}

function CoreBody(): ReactElement {
  const core = useQuery({
    queryKey: ["lab", "core"],
    queryFn: connectLocalHost,
    staleTime: Infinity,
    retry: false,
  });

  const servers = useQuery({
    queryKey: ["lab", "mcp"],
    queryFn: async () => {
      const listed: unknown = await (await fetch("/core/mcp")).json();

      return Value.Check(Servers, listed) ? listed : [];
    },
    enabled: core.isSuccess,
  });

  if (core.isError)
    return (
      <p role="alert" {...props(text.base, styles.failed)}>
        Core didn&rsquo;t open: {core.error.message}
      </p>
    );

  return (
    <div {...props(styles.body)}>
      <div {...props(text.sm, styles.facts)}>
        <p {...props(styles.fact)}>
          {core.isSuccess
            ? "Open on this checkout. File edits and shell commands are off."
            : "Opening…"}
        </p>
        <p {...props(styles.fact)}>
          Home <span {...props(styles.code)}>packages/lab/.home</span>, apart from yours.
        </p>
        <p {...props(styles.fact)}>
          MCP{" "}
          {servers.data === undefined || servers.data.length === 0 ? (
            <>
              servers go in <span {...props(styles.code)}>.home/.nyte/mcp.json</span>.
            </>
          ) : (
            <span {...props(styles.code)}>{servers.data.join(", ")}</span>
          )}
        </p>
      </div>
      {core.isSuccess && <ProvidersSettings />}
    </div>
  );
}

function RailDialog({
  icon,
  label,
  children,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Row variant="nav" xstyle={sidebarStyles.navRow} onClick={() => setOpen(true)}>
        <Row.Leading xstyle={sidebarStyles.navLeading}>
          <Icon name={icon} size="sm" />
        </Row.Leading>
        <Row.Label>{label}</Row.Label>
      </Row>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Popup xstyle={styles.popup}>
          <Dialog.Header>
            <Dialog.Title>{label}</Dialog.Title>
          </Dialog.Header>
          {open && children}
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}
