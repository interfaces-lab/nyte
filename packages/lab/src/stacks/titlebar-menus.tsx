import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { button, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import type { Stack } from "./model.ts";

const styles = create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    height: button.heightXs,
    paddingInline: space.s2,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": role.bgHover,
      "[data-popup-open]": role.bgHover,
    },
    color: role.contentSecondary,
    fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
  },
  hot: { color: role.contentInteractivePrimary },
  value: { color: role.contentPrimary },
  quiet: { color: role.contentTertiary },
  ring: { flexShrink: 0, transform: "rotate(-90deg)" },
  track: { opacity: 0.25 },
});

/** How much of today's budget is gone across the stacks in focus; red once it's nearly spent. */
export function SpendMenu({
  stacks,
  onOpen,
}: {
  readonly stacks: readonly Stack[];
  readonly onOpen: (stack: string) => void;
}): ReactElement {
  const spent = stacks.reduce((sum, stack) => sum + stack.spent, 0);
  const budget = stacks.reduce((sum, stack) => sum + stack.budget, 0);
  const share = budget === 0 ? 0 : Math.min(1, spent / budget);
  const tone = share >= 0.9 ? intent.danger : share >= 0.75 ? intent.warning : null;

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Spent $${spent.toFixed(2)} of $${String(budget)} today`}
        {...props(tone, text.sm, styles.trigger, tone !== null && styles.hot)}
      >
        <Ring share={share} />
        {Math.round(share * 100)}%
      </MenuTrigger>
      <MenuContent align="end">
        <MenuGroup>
          <MenuGroupLabel>Spent Today</MenuGroupLabel>
          {stacks.map((stack) => (
            <MenuItem
              key={stack.id}
              icon={stack.icon}
              meta={`$${stack.spent.toFixed(2)} of $${String(stack.budget)}`}
              onClick={() => onOpen(stack.id)}
            >
              {stack.name}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}

function Ring({ share }: { readonly share: number }): ReactElement {
  const around = 2 * Math.PI * 5;

  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" {...props(styles.ring)}>
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        {...props(styles.track)}
      />
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${String(around * share)} ${String(around)}`}
      />
    </svg>
  );
}

/** Which stacks Home shows and which ones may interrupt you with a toast. */
export function FocusMenu({
  stacks,
  focus,
  onFocus,
}: {
  readonly stacks: readonly Stack[];
  readonly focus: string | null;
  readonly onFocus: (stack: string | null) => void;
}): ReactElement {
  const current = stacks.find((stack) => stack.id === focus);

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Focus: ${current?.name ?? "All work"}`}
        {...props(text.sm, styles.trigger)}
      >
        Focus
        <span {...props(styles.value)}>{current?.name ?? "All work"}</span>
        <span {...props(styles.quiet)}>
          <Icon name="chevron-down" size={10} />
        </span>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuGroup>
          <MenuGroupLabel>Home and Alerts Show</MenuGroupLabel>
          <MenuRadioGroup
            value={focus ?? "all"}
            onValueChange={(value) => onFocus(value === "all" ? null : String(value))}
          >
            <MenuRadioItem value="all" icon="layers">
              All Work
            </MenuRadioItem>
            {stacks.map((stack) => (
              <MenuRadioItem key={stack.id} value={stack.id} icon={stack.icon}>
                {stack.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}
