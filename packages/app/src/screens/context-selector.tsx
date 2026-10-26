import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useEffectEvent, useRef, useState } from "react";
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
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { contextStyles } from "./context-selector.stylex.ts";

function ContextHint({
  label,
  value,
  keys = [],
}: Partial<Pick<KbdProps, "keys">> & { readonly label: string; readonly value: string }) {
  return (
    <>
      <div {...props(text.base, contextStyles.hintHeading)}>
        <span>{label}</span>
        {keys.length > 0 && (
          <span {...props(contextStyles.keys)}>
            {keys.map((key) => (
              <Kbd key={key} keys={[key]} keycap />
            ))}
          </span>
        )}
      </div>
      <div {...props(text.sm, contextStyles.hintValue, contextStyles.text)}>{value}</div>
    </>
  );
}

export function ContextSelector({
  action,
  value,
  icon,
  active,
  footer,
  children,
}: {
  readonly action: (typeof clientActions)["selectWorkspace" | "selectEnvironment"];
  readonly value: string;
  readonly icon?: IconProps["name"];
  readonly active: boolean;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  const mac = nyte.platform === "darwin";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      {active && (
        <ContextShortcut
          action={action}
          mac={mac}
          onShortcut={() => {
            triggerRef.current?.focus();
            setOpen(true);
          }}
          onInactive={() => setOpen(false)}
        />
      )}
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
      <MenuContent side="top" footer={footer} xstyle={contextStyles.menu}>
        {children}
      </MenuContent>
    </Menu>
  );
}

/** Mounted while the selector is active: its shortcut opens the menu, and going inactive closes it. */
function ContextShortcut({
  action,
  mac,
  onShortcut,
  onInactive,
}: {
  readonly action: (typeof clientActions)["selectWorkspace" | "selectEnvironment"];
  readonly mac: boolean;
  readonly onShortcut: () => void;
  readonly onInactive: () => void;
}): null {
  const onKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    if (
      resolveClientAction(event, mac, "workspace", clientCapabilities(nyte.host))?.id !== action.id
    )
      return;

    event.preventDefault();
    onShortcut();
  });

  const release = useEffectEvent(onInactive);

  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => onKeyDown(event);
    window.addEventListener("keydown", listener);

    return () => {
      window.removeEventListener("keydown", listener);
      release();
    };
  });

  return null;
}
