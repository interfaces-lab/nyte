import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { connectDirectly, useRouteState } from "./routes.ts";

const styles = create({
  frame: { display: "flex", flexDirection: "column", height: "100%" },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s1,
    paddingInline: space.s3,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.strokeQuaternary,
    backgroundColor: role.bgBase,
    color: role.contentSecondary,
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: role.contentPrimary,
    overflowWrap: "anywhere",
  },
  shell: { flex: 1, minHeight: 0, position: "relative" },
});

export function DesktopFrame({
  name,
  actions,
  children,
}: {
  readonly name: string;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const route = useRouteState();
  const [trying, setTrying] = useState(false);

  return (
    <div {...props(styles.frame)}>
      <div {...props(text.sm, styles.bar)}>
        <Icon name="laptop" size="sm" />
        <span {...props(styles.name)}>{route.direct ? `${name} · Tailscale` : name}</span>
        {route.offer !== undefined && (
          <Button
            size="xs"
            disabled={trying}
            onClick={() => {
              const url = route.offer;

              if (url === undefined) return;
              setTrying(true);
              void connectDirectly(url).then(() => setTrying(false));
            }}
          >
            Connect Over Tailscale
          </Button>
        )}
        {actions}
      </div>
      <div {...props(styles.shell)}>{children}</div>
    </div>
  );
}
