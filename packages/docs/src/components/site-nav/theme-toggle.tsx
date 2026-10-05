"use client";

import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Tabs } from "@nyte-ai/ui/tabs";
import { IconImac, IconMoon, IconSun } from "central-icons";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

const THEMES = [
  { value: "light", label: "Light", Icon: IconSun },
  { value: "dark", label: "Dark", Icon: IconMoon },
  { value: "system", label: "System", Icon: IconImac },
] as const;

const noop = () => () => {};

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  // The stored theme is unknown until the client reads storage; select nothing
  // on the server and let hydration fill it in.
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const value = hydrated ? (theme ?? "system") : null;
  const Current = hydrated && resolvedTheme === "dark" ? IconMoon : IconSun;

  const choose = (next: unknown) => {
    const choice = THEMES.find((item) => item.value === next);
    if (!choice) return;
    if (
      !("startViewTransition" in document) ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setTheme(choice.value);
      return;
    }
    // next-themes writes the class in an effect; flushSync lands it before the snapshot.
    document.startViewTransition(() => flushSync(() => setTheme(choice.value)));
  };

  return (
    <>
      <Tabs.Root variant="pill" value={value} onValueChange={choose} className="max-lg:hidden">
        <Tabs.List aria-label="Theme">
          {THEMES.map(({ value: item, label, Icon }) => (
            <Tabs.Tab
              key={item}
              value={item}
              aria-label={label}
              className="w-8 justify-center px-0 hero:border-white/20 hero:text-white/72 hero:hover:bg-white/12 hero:hover:text-white hero:data-active:border-white/40 hero:data-active:bg-white/16 hero:data-active:text-white"
            >
              <Icon size={16} />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.Root>

      <Menu>
        <MenuTrigger
          aria-label="Theme"
          className="inline-flex size-(--site-nav-control) cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground lg:hidden hero:text-white/72 hero:hover:bg-white/12 hero:hover:text-white"
        >
          <Current size={16} />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuRadioGroup value={value} onValueChange={choose}>
            {THEMES.map(({ value: item, label, Icon }) => (
              <MenuRadioItem key={item} value={item} leading={<Icon size={14} />}>
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    </>
  );
}
