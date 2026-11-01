import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useEffectEvent, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Button, buttonGlyphSize, type ButtonProps } from "@nyte-ai/ui/button";
import { Icon, type GlyphSize, type IconName } from "@nyte-ai/ui/icon";
import { Kbd, type KbdProps } from "@nyte-ai/ui/kbd";
import { Menu, MenuContent, MenuTrigger } from "@nyte-ai/ui/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import {
  clientActionAriaShortcut,
  clientActionKeys,
  clientActions,
  clientCapabilities,
  resolveClientAction,
} from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { contextStyles } from "./context-selector.stylex.ts";

export type ContextSize = "xs" | "md";

const CHEVRON_SIZES = { xs: "2xs", md: "xs" } as const satisfies Record<ContextSize, GlyphSize>;

export function ContextHint({
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

export function ContextTrigger({
  size,
  icon,
  value,
  chevron = true,
  ...rest
}: Omit<
  ButtonProps,
  "size" | "variant" | "icon" | "iconOnly" | "pill" | "children" | "aria-label" | "xstyle"
> & {
  readonly size: ContextSize;
  readonly icon?: IconName;
  readonly value: string;
  readonly chevron?: boolean;
}): ReactElement {
  return (
    <Button
      variant={size === "xs" ? "quiet" : "plain"}
      size={size}
      xstyle={[contextStyles.controlLayout, size === "xs" && contextStyles.footerLayout]}
      {...rest}
    >
      {icon !== undefined && (
        <span {...props(contextStyles.icon)}>
          <Icon name={icon} size={buttonGlyphSize(size, false)} />
        </span>
      )}
      <span {...props(contextStyles.text)}>{value}</span>
      {chevron && (
        <span {...props(contextStyles.icon)}>
          <Icon name="chevron-down" size={CHEVRON_SIZES[size]} />
        </span>
      )}
    </Button>
  );
}

export function ContextSelector({
  action,
  value,
  icon,
  size = "md",
  active,
  footer,
  children,
}: {
  readonly action: (typeof clientActions)["selectWorkspace" | "selectEnvironment"];
  readonly value: string;
  readonly icon?: IconName;
  readonly size?: ContextSize;
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
                <ContextTrigger
                  ref={triggerRef}
                  size={size}
                  icon={icon}
                  value={value}
                  aria-keyshortcuts={clientActionAriaShortcut(action, mac)}
                />
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
