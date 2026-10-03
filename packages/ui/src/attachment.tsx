import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ComponentProps } from "react";
import { ChatButton, type ChatButtonProps } from "./chat-button.tsx";

const attachmentVariants = cva("cn-attachment", {
  variants: {
    size: {
      default: "cn-attachment-size-default",
      sm: "cn-attachment-size-sm",
      xs: "cn-attachment-size-xs",
    },
    orientation: {
      horizontal: "cn-attachment-orientation-horizontal",
      vertical: "cn-attachment-orientation-vertical",
    },
  },
});

const attachmentMediaVariants = cva("cn-attachment-media", {
  variants: {
    variant: {
      icon: "cn-attachment-media-variant-icon",
      image: "cn-attachment-media-variant-image",
    },
  },
  defaultVariants: { variant: "icon" },
});

export function Attachment({
  className,
  state = "done",
  size = "default",
  orientation = "horizontal",
  ...props
}: ComponentProps<"div"> &
  VariantProps<typeof attachmentVariants> & {
    state?: "idle" | "uploading" | "processing" | "error" | "done";
  }) {
  return (
    <div
      data-slot="attachment"
      data-state={state}
      data-size={size}
      data-orientation={orientation}
      className={cn(attachmentVariants({ size, orientation }), className)}
      {...props}
    />
  );
}

export function AttachmentMedia({
  className,
  variant = "icon",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof attachmentMediaVariants>) {
  return (
    <div
      data-slot="attachment-media"
      data-variant={variant}
      className={cn(attachmentMediaVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AttachmentContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn("cn-attachment-content", className)}
      {...props}
    />
  );
}

export function AttachmentTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-title"
      className={cn("cn-attachment-title", className)}
      {...props}
    />
  );
}

export function AttachmentDescription({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-description"
      className={cn("cn-attachment-description", className)}
      {...props}
    />
  );
}

export function AttachmentActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn("cn-attachment-actions", className)}
      {...props}
    />
  );
}

export function AttachmentAction({
  className,
  variant,
  size = "icon-xs",
  ...props
}: ChatButtonProps) {
  return (
    <ChatButton
      data-slot="attachment-action"
      variant={variant ?? "ghost"}
      size={size}
      className={(state) =>
        cn("cn-attachment-action", className instanceof Function ? className(state) : className)
      }
      {...props}
    />
  );
}

export function AttachmentTrigger({
  className,
  render,
  type,
  ...props
}: useRender.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        type: render ? type : (type ?? "button"),
        className: cn("cn-attachment-trigger", className),
      },
      props,
    ),
    render,
    state: { slot: "attachment-trigger" },
  });
}

export function AttachmentGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="attachment-group" className={cn("cn-attachment-group", className)} {...props} />
  );
}
