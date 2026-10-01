import { avatar, shape } from "./schema.stylex.ts";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { create, props } from "@stylexjs/stylex";
import type { CSSProperties } from "react";

import { mergeStyleProps, type XStyle } from "./style.ts";
import { surfaceTheme } from "./surface-theme.ts";
import { role, type } from "./vars.stylex.ts";

const styles = create({
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
    borderColor: role.borderPrimaryTranslucent,
    fontFamily: type.fontSans,
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

const sizeStyles = create({
  xs: { width: avatar.xs, height: avatar.xs, fontSize: 9 },
  sm: { width: avatar.sm, height: avatar.sm, fontSize: 10 },
  md: { width: avatar.md, height: avatar.md, fontSize: 11 },
  lg: { width: avatar.lg, height: avatar.lg, fontSize: 14 },
});

const shapeStyles = create({
  circle: { borderRadius: shape.pill },
  rounded: { borderRadius: "42%" },
});

const toneFill = create({
  base: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    color: role.contentInteractivePrimary,
  },
});

/** Each tone but `neutral` scopes the avatar to its hue. */
const toneScopes = {
  neutral: null,
  orange: surfaceTheme.orange,
  blue: surfaceTheme.blue,
  violet: surfaceTheme.purple,
  green: surfaceTheme.green,
} as const;

export type AvatarSize = keyof typeof sizeStyles;

export type AvatarShape = keyof typeof shapeStyles;

export type AvatarTone = keyof typeof toneScopes;

export interface AvatarProps extends Omit<AvatarPrimitive.Root.Props, "className" | "style"> {
  className?: string;
  shape?: AvatarShape;
  size?: AvatarSize;
  tone?: AvatarTone;
  style?: CSSProperties;
  xstyle?: XStyle;
}

export function Avatar({
  className,
  shape = "circle",
  size = "md",
  tone = "neutral",
  style,
  xstyle,
  ...componentProps
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-tone={tone}
      {...mergeStyleProps(
        props(
          toneScopes[tone],
          styles.root,
          sizeStyles[size],
          shapeStyles[shape],
          toneFill.base,
          xstyle,
        ),
        className,
        style,
      )}
      {...componentProps}
    />
  );
}

export interface AvatarImageProps extends Omit<AvatarPrimitive.Image.Props, "className" | "style"> {
  className?: string;
  style?: CSSProperties;
  xstyle?: XStyle;
}

export function AvatarImage({ className, style, xstyle, ...componentProps2 }: AvatarImageProps) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      {...mergeStyleProps(props(styles.image, xstyle), className, style)}
      {...componentProps2}
    />
  );
}

export interface AvatarFallbackProps extends Omit<
  AvatarPrimitive.Fallback.Props,
  "className" | "style"
> {
  className?: string;
  style?: CSSProperties;
  xstyle?: XStyle;
}

export function AvatarFallback({
  className,
  style,
  xstyle,
  ...componentProps3
}: AvatarFallbackProps) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      {...mergeStyleProps(props(styles.fallback, xstyle), className, style)}
      {...componentProps3}
    />
  );
}
