import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

import { tokens } from "../../platform-tokens.stylex.ts";
import { mergeStyleProps, type XStyle } from "../../style.ts";

const styles = stylex.create({
  root: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
    boxSizing: "border-box",
    borderWidth: tokens.avatar["--nyte-avatar-ring-width"],
    borderStyle: "solid",
    borderColor: tokens.color["--nyte-color-border"],
    backgroundColor: tokens.color["--nyte-color-avatar-background"],
    color: tokens.color["--nyte-color-avatar-foreground"],
    fontFamily: tokens.font["--nyte-font-family-ui"],
    fontWeight: tokens.font["--nyte-font-weight-semibold"],
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
  xs: {
    width: tokens.avatar["--nyte-avatar-size-xs"],
    height: tokens.avatar["--nyte-avatar-size-xs"],
    fontSize: tokens.avatar["--nyte-avatar-font-xs"],
  },
  sm: {
    width: tokens.avatar["--nyte-avatar-size-sm"],
    height: tokens.avatar["--nyte-avatar-size-sm"],
    fontSize: tokens.avatar["--nyte-avatar-font-sm"],
  },
  md: {
    width: tokens.avatar["--nyte-avatar-size-md"],
    height: tokens.avatar["--nyte-avatar-size-md"],
    fontSize: tokens.avatar["--nyte-avatar-font-md"],
  },
  lg: {
    width: tokens.avatar["--nyte-avatar-size-lg"],
    height: tokens.avatar["--nyte-avatar-size-lg"],
    fontSize: tokens.avatar["--nyte-avatar-font-lg"],
  },
});

const shapeStyles = stylex.create({
  circle: { borderRadius: tokens.radius["--nyte-radius-pill"] },
  rounded: { borderRadius: tokens.radius["--nyte-radius-avatar"] },
});

const toneStyles = stylex.create({
  neutral: {
    backgroundColor: tokens.color["--nyte-color-avatar-background"],
    color: tokens.color["--nyte-color-avatar-foreground"],
  },
  orange: {
    backgroundColor: tokens.color["--nyte-color-avatar-orange-background"],
    color: tokens.color["--nyte-color-avatar-orange-foreground"],
  },
  blue: {
    backgroundColor: tokens.color["--nyte-color-avatar-blue-background"],
    color: tokens.color["--nyte-color-avatar-blue-foreground"],
  },
  violet: {
    backgroundColor: tokens.color["--nyte-color-avatar-violet-background"],
    color: tokens.color["--nyte-color-avatar-violet-foreground"],
  },
  green: {
    backgroundColor: tokens.color["--nyte-color-avatar-green-background"],
    color: tokens.color["--nyte-color-avatar-green-foreground"],
  },
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
