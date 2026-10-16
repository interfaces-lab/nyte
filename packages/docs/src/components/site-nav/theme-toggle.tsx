import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { IconImac, IconMoon, IconSun } from "central-icons";
import { setTheme, useTheme } from "~/lib/theme";

const THEMES = [
  { value: "light", label: "Light", Icon: IconSun },
  { value: "dark", label: "Dark", Icon: IconMoon },
  { value: "system", label: "System", Icon: IconImac },
] as const;

export function ThemeToggle() {
  // The stored theme is unknown until the client reads storage; select nothing
  // on the server and let hydration fill it in.
  const { theme: value, resolvedTheme } = useTheme();
  const Current = resolvedTheme === "dark" ? IconMoon : IconSun;

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
    document.startViewTransition(() => setTheme(choice.value));
  };

  return (
    <Menu>
      <MenuTrigger
        aria-label="Theme"
        className="inline-flex size-(--site-nav-control) cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground hero:text-white/72 hero:hover:bg-white/12 hero:hover:text-white"
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
  );
}
