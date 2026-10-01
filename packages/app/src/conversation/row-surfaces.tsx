import { intent } from "@nyte-ai/ui/surface-theme";
/**
 * Row surfaces after shadcn's Message, Bubble and Marker. Each draws one
 * look the transcript already uses and knows nothing about scrolling.
 */
import { props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { bubbleStyles, markerStyles, messageStyles } from "./styles.stylex.ts";

/** Only the user's side is drawn as a message; it spans the measure. */
export function Message({
  align,
  children,
}: {
  readonly align: "end";
  readonly children: ReactNode;
}): ReactElement {
  return <div {...props(messageStyles[align])}>{children}</div>;
}

export function Bubble({
  variant = "default",
  children,
}: {
  /** `editable` lifts on hover and rings on focus: the bubble holds an edit trigger. */
  readonly variant?: "default" | "editable";
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div {...props(bubbleStyles.default, variant === "editable" && bubbleStyles.editable)}>
      {children}
    </div>
  );
}

export function Marker({
  variant = "default",
  role,
  title,
  children,
}: Pick<ComponentProps<"div">, "role" | "title" | "children"> & {
  /** `default` is a muted status line, `destructive` its failure tone, `retrying` a shimmering tail status. */
  readonly variant?: "default" | "destructive" | "retrying";
}): ReactElement {
  return (
    <div
      role={role}
      title={title}
      {...props(
        variant === "retrying" ? markerStyles.retrying : markerStyles.default,
        variant === "destructive" && intent.danger,
        variant === "destructive" && markerStyles.destructive,
      )}
    >
      {variant === "retrying" ? <span {...props(markerStyles.shimmer)}>{children}</span> : children}
    </div>
  );
}
