import { Button } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { buttonStyle, type ButtonSize, type ButtonVariant } from "./button.tsx";

const chatButtonVariants = cva("cn-button", {
  variants: {
    variant: {
      default: "cn-button-variant-default",
      outline: "cn-button-variant-outline",
      secondary: "cn-button-variant-secondary",
      ghost: "cn-button-variant-ghost",
      destructive: "cn-button-variant-destructive",
      link: "cn-button-variant-link",
    },
    size: {
      default: "cn-button-size-default",
      xs: "cn-button-size-xs",
      sm: "cn-button-size-sm",
      lg: "cn-button-size-lg",
      icon: "cn-button-size-icon",
      "icon-xs": "cn-button-size-icon-xs",
      "icon-sm": "cn-button-size-icon-sm",
      "icon-lg": "cn-button-size-icon-lg",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ChatButtonProps = Button.Props & VariantProps<typeof chatButtonVariants>;

const variants = {
  default: "solid",
  outline: "outline",
  secondary: "ghost",
  ghost: "ghost",
  destructive: "solid",
  link: "text",
} as const satisfies Record<NonNullable<ChatButtonProps["variant"]>, ButtonVariant>;

const sizes = {
  default: "md",
  xs: "xs",
  sm: "sm",
  lg: "lg",
  icon: "md",
  "icon-xs": "xs",
  "icon-sm": "sm",
  "icon-lg": "lg",
} as const satisfies Record<NonNullable<ChatButtonProps["size"]>, ButtonSize>;

export function ChatButton({
  variant = "default",
  size = "default",
  className,
  style,
  render,
  ...props
}: ChatButtonProps) {
  const appearance = (disabled: boolean) =>
    render === undefined
      ? buttonStyle(variants[variant ?? "ghost"], sizes[size ?? "default"], {
          iconOnly: size?.startsWith("icon") ?? false,
          disabled,
          tone: variant === "destructive" ? "danger" : "neutral",
        })
      : undefined;

  return (
    <Button
      data-slot="button"
      {...props}
      render={render}
      className={(state) =>
        cn(
          appearance(state.disabled)?.className,
          chatButtonVariants({ variant, size }),
          typeof className === "function" ? className(state) : className,
        )
      }
      style={(state) => ({
        ...appearance(state.disabled)?.style,
        ...(typeof style === "function" ? style(state) : style),
      })}
    />
  );
}
