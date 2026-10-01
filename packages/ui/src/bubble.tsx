import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ComponentProps } from "react";

const bubbleVariants = cva("cn-bubble", {
  variants: {
    variant: {
      default: "cn-bubble-variant-default",
      secondary: "cn-bubble-variant-secondary",
      muted: "cn-bubble-variant-muted",
      tinted: "cn-bubble-variant-tinted",
      outline: "cn-bubble-variant-outline",
      ghost: "cn-bubble-variant-ghost",
      destructive: "cn-bubble-variant-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

export type BubbleGroupProps = ComponentProps<"div">;
export type BubbleProps = ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & { align?: "start" | "end" };
export type BubbleContentProps = useRender.ComponentProps<"div">;
export type BubbleReactionsProps = ComponentProps<"div"> & {
  align?: "start" | "end";
  side?: "top" | "bottom";
};

export function BubbleGroup({ className, ...props }: BubbleGroupProps) {
  return <div data-slot="bubble-group" className={cn("cn-bubble-group", className)} {...props} />;
}

export function Bubble({ variant = "default", align = "start", className, ...props }: BubbleProps) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  );
}

export function BubbleContent({ className, render, ...props }: BubbleContentProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ className: cn("cn-bubble-content", className) }, props),
    render,
    state: { slot: "bubble-content" },
  });
}

export function BubbleReactions({
  side = "bottom",
  align = "end",
  className,
  ...props
}: BubbleReactionsProps) {
  return (
    <div
      data-slot="bubble-reactions"
      data-align={align}
      data-side={side}
      className={cn(
        "cn-bubble-reactions",
        `cn-bubble-reactions-side-${side}`,
        `cn-bubble-reactions-align-${align}`,
        className,
      )}
      {...props}
    />
  );
}
