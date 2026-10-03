import { cn } from "cn";
import type { ComponentProps } from "react";

export type MessageGroupProps = ComponentProps<"div">;

export type MessageProps = ComponentProps<"div"> & { align?: "start" | "end" };

export type MessageAvatarProps = ComponentProps<"div">;

export type MessageContentProps = ComponentProps<"div">;

export type MessageHeaderProps = ComponentProps<"div">;

export type MessageFooterProps = ComponentProps<"div">;

export function MessageGroup({ className, ...props }: MessageGroupProps) {
  return <div data-slot="message-group" className={cn("cn-message-group", className)} {...props} />;
}

export function Message({ className, align = "start", ...props }: MessageProps) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn("cn-message", className)}
      {...props}
    />
  );
}

export function MessageAvatar({ className, ...props }: MessageAvatarProps) {
  return (
    <div data-slot="message-avatar" className={cn("cn-message-avatar", className)} {...props} />
  );
}

export function MessageContent({ className, ...props }: MessageContentProps) {
  return (
    <div data-slot="message-content" className={cn("cn-message-content", className)} {...props} />
  );
}

export function MessageHeader({ className, ...props }: MessageHeaderProps) {
  return (
    <div data-slot="message-header" className={cn("cn-message-header", className)} {...props} />
  );
}

export function MessageFooter({ className, ...props }: MessageFooterProps) {
  return (
    <div data-slot="message-footer" className={cn("cn-message-footer", className)} {...props} />
  );
}
