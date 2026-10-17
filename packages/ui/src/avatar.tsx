import { avatar, radius } from "./styles/schema.stylex.ts";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { create, props } from "@stylexjs/stylex";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { surfaceTheme } from "./surface-theme.ts";
import { role, type } from "./styles/vars.stylex.ts";

const styles = create({
  root: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "clip",
    boxSizing: "border-box",
    borderWidth: 0.5,
    borderStyle: "solid",
    borderColor: role.borderPrimaryTranslucent,
    fontFamily: type.fontSans,
    fontWeight: type.weightSemibold,
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

const cornerStyles = create({
  circle: { borderRadius: radius.pill },
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

export function Avatar({
  className,
  corners = "circle",
  size = "md",
  tone = "neutral",
  style,
  xstyle,
  ...rest
}: StyledProps<AvatarPrimitive.Root.Props, Restyle<"Avatar">> & {
  readonly corners?: keyof typeof cornerStyles;
  readonly size?: keyof typeof sizeStyles;
  readonly tone?: keyof typeof toneScopes;
}) {
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
          cornerStyles[corners],
          toneFill.base,
          xstyle,
        ),
        className,
        style,
      )}
      {...rest}
    />
  );
}

export function AvatarImage({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AvatarPrimitive.Image.Props, Restyle<"AvatarImage">>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      {...mergeStyleProps(props(styles.image, xstyle), className, style)}
      {...rest}
    />
  );
}

export function AvatarFallback({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AvatarPrimitive.Fallback.Props, Restyle<"AvatarFallback">>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      {...mergeStyleProps(props(styles.fallback, xstyle), className, style)}
      {...rest}
    />
  );
}
