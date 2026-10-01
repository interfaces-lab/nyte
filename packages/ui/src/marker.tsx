import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ComponentProps } from "react";

export const markerVariants = cva("cn-marker", {
  variants: {
    variant: {
      default: "cn-marker-variant-default",
      separator: "cn-marker-variant-separator",
      border: "cn-marker-variant-border",
    },
  },
  defaultVariants: { variant: "default" },
});

export type MarkerProps = useRender.ComponentProps<"div"> & VariantProps<typeof markerVariants>;
export type MarkerIconProps = ComponentProps<"span">;
export type MarkerContentProps = ComponentProps<"span">;

export function Marker({ className, variant = "default", render, ...props }: MarkerProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ className: cn(markerVariants({ variant }), className) }, props),
    render,
    state: { slot: "marker", variant },
  });
}

export function MarkerIcon({ className, ...props }: MarkerIconProps) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn("cn-marker-icon", className)}
      {...props}
    />
  );
}

export function MarkerContent({ className, ...props }: MarkerContentProps) {
  return (
    <span data-slot="marker-content" className={cn("cn-marker-content", className)} {...props} />
  );
}
