import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

import { mergeStyleProps, type XStyle } from "../../style.ts";
import { t } from "../../vars.stylex.ts";

const styles = stylex.create({
  root: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
    boxSizing: "border-box",
    borderWidth: 0.5,
    borderStyle: "solid",
    borderColor: t.imageOutline,
    fontFamily: t.fontSans,
    fontWeight: 600,
    lineHeight: 1,
    userSelect: "none",
  },
  image: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: "inherit",
  },
  fallback: {
    display: "flex",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "inherit",
    backgroundColor: "inherit",
    color: "inherit",
    font: "inherit",
  },
});

const sizeStyles = stylex.create({
  xs: { width: 20, height: 20, fontSize: 9 },
  sm: { width: 24, height: 24, fontSize: 10 },
  md: { width: 28, height: 28, fontSize: 11 },
  lg: { width: 36, height: 36, fontSize: 14 },
});

const shapeStyles = stylex.create({
  circle: { borderRadius: t.radiusFull },
  rounded: { borderRadius: "42%" },
});

const toneStyles = stylex.create({
  neutral: { backgroundColor: t.fillStrong, color: t.textSecondary },
  orange: {
    backgroundColor: `color-mix(in srgb, ${t.orange} 12%, transparent)`,
    color: t.orange,
  },
  blue: { backgroundColor: t.fillAccentSubtle, color: t.textAccent },
  violet: {
    backgroundColor: `color-mix(in srgb, ${t.purple} 12%, transparent)`,
    color: t.purple,
  },
  green: { backgroundColor: t.fillSuccessSubtle, color: t.textSuccess },
});

export type AvatarSize = keyof typeof sizeStyles;

export type AvatarShape = keyof typeof shapeStyles;

export type AvatarTone = keyof typeof toneStyles;

export interface AvatarProps extends Omit<AvatarPrimitive.Root.Props, "className" | "style"> {
  className?: string;
  shape?: AvatarShape;
  size?: AvatarSize;
  tone?: AvatarTone;
  style?: React.CSSProperties;
  xstyle?: XStyle;
}

export function Avatar({
  className,
  shape = "circle",
  size = "md",
  tone = "neutral",
  style,
  xstyle,
  ...props
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-tone={tone}
      {...mergeStyleProps(
        stylex.props(styles.root, sizeStyles[size], shapeStyles[shape], toneStyles[tone], xstyle),
        className,
        style,
      )}
      {...props}
    />
  );
}

export interface AvatarImageProps extends Omit<AvatarPrimitive.Image.Props, "className" | "style"> {
  className?: string;
  style?: React.CSSProperties;
  xstyle?: XStyle;
}

export function AvatarImage({ className, style, xstyle, ...props }: AvatarImageProps) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      {...mergeStyleProps(stylex.props(styles.image, xstyle), className, style)}
      {...props}
    />
  );
}

export interface AvatarFallbackProps extends Omit<
  AvatarPrimitive.Fallback.Props,
  "className" | "style"
> {
  className?: string;
  style?: React.CSSProperties;
  xstyle?: XStyle;
}

export function AvatarFallback({ className, style, xstyle, ...props }: AvatarFallbackProps) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      {...mergeStyleProps(stylex.props(styles.fallback, xstyle), className, style)}
      {...props}
    />
  );
}
