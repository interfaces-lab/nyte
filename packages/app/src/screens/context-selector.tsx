import { props } from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconProps } from "@nyte-ai/ui/icon";
import { Kbd, type KbdProps } from "@nyte-ai/ui/kbd";
import { Menu, MenuContent, MenuTrigger } from "@nyte-ai/ui/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import {
  clientActionAriaShortcut,
  clientActionKeys,
  clientActions,
  clientCapabilities,
  resolveClientAction,
} from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import { useHostState } from "../queries.ts";
import { contextStyles } from "./context-selector.stylex.ts";

export function ContextHint({
  label,
  value,
  keys = [],
}: Partial<Pick<KbdProps, "keys">> & { readonly label: string; readonly value: string }) {
  return (
    <>
      <div {...props(contextStyles.hintHeading)}>
        <span>{label}</span>
        {keys.length > 0 && (
          <span {...props(contextStyles.keys)}>
            {keys.map((key) => (
              <Kbd key={key} keys={[key]} xstyle={contextStyles.key} />
            ))}
          </span>
        )}
      </div>
      <div {...props(contextStyles.hintValue, contextStyles.text)}>{value}</div>
    </>
  );
}

export function ContextSelector({
  action,
  value,
  icon,
  active,
  children,
}: {
  readonly action: (typeof clientActions)["selectWorkspace" | "selectEnvironment"];
  readonly value: string;
  readonly icon?: IconProps["name"];
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  const host = useHostState();
  const mac = macPlatform(host.data?.platform);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        resolveClientAction(event, mac, "workspace", clientCapabilities(nyte.host))?.id !==
        action.id
      )
        return;

      event.preventDefault();
      triggerRef.current?.focus();
      setOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      setOpen(false);
    };
  }, [action, active, mac]);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  ref={triggerRef}
                  variant="plain"
                  aria-keyshortcuts={clientActionAriaShortcut(action, mac)}
                  xstyle={contextStyles.controlLayout}
                >
                  {icon !== undefined && (
                    <span {...props(contextStyles.icon)}>
                      <Icon name={icon} size={14} />
                    </span>
                  )}
                  <span {...props(contextStyles.text)}>{value}</span>
                  <span {...props(contextStyles.icon)}>
                    <Icon name="chevron-down" size={12} />
                  </span>
                </Button>
              }
            />
          }
        />
        <TooltipContent side="top" xstyle={contextStyles.hint}>
          <ContextHint label={action.label} value={value} keys={clientActionKeys(action, mac)} />
        </TooltipContent>
      </Tooltip>
      <MenuContent side="top" xstyle={contextStyles.menu}>
        {children}
      </MenuContent>
    </Menu>
  );
}
