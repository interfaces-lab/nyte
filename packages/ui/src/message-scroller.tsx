import { MessageScroller } from "@shadcn/react/message-scroller";
import { props } from "@stylexjs/stylex";
import type { ComponentProps } from "react";
import { srOnly } from "./a11y.stylex.ts";
import { ChatButton } from "./chat-button.tsx";
import { Icon } from "./icon.tsx";

export {
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";

export type MessageScrollerProviderProps = ComponentProps<typeof MessageScroller.Provider>;

export type MessageScrollerProps = ComponentProps<typeof MessageScroller.Root>;

export type MessageScrollerViewportProps = ComponentProps<typeof MessageScroller.Viewport>;

export type MessageScrollerContentProps = ComponentProps<typeof MessageScroller.Content>;

export type MessageScrollerItemProps = ComponentProps<typeof MessageScroller.Item>;

export type MessageScrollerButtonProps = ComponentProps<typeof MessageScroller.Button> &
  Pick<ComponentProps<typeof ChatButton>, "variant" | "size">;

function ScrollerProvider(properties: MessageScrollerProviderProps) {
  return <MessageScroller.Provider {...properties} />;
}

function Scroller(properties: MessageScrollerProps) {
  return <MessageScroller.Root data-slot="message-scroller" {...properties} />;
}

function ScrollerViewport(properties: MessageScrollerViewportProps) {
  return <MessageScroller.Viewport data-slot="message-scroller-viewport" {...properties} />;
}

function ScrollerContent(properties: MessageScrollerContentProps) {
  return <MessageScroller.Content data-slot="message-scroller-content" {...properties} />;
}

function ScrollerItem({ scrollAnchor = false, ...properties }: MessageScrollerItemProps) {
  return (
    <MessageScroller.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      {...properties}
    />
  );
}

function ScrollerButton({
  direction = "end",
  children,
  render,
  variant = "secondary",
  size = "icon-sm",
  ...properties
}: MessageScrollerButtonProps) {
  return (
    <MessageScroller.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      render={render ?? <ChatButton variant={variant} size={size} />}
      {...properties}
    >
      {children ?? (
        <>
          <Icon name={direction === "end" ? "arrow-down" : "arrow-up"} />
          <span {...props(srOnly)}>
            {direction === "end" ? "Scroll to end" : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScroller.Button>
  );
}

export {
  ScrollerProvider as MessageScrollerProvider,
  Scroller as MessageScroller,
  ScrollerViewport as MessageScrollerViewport,
  ScrollerContent as MessageScrollerContent,
  ScrollerItem as MessageScrollerItem,
  ScrollerButton as MessageScrollerButton,
};

export type {
  MessageScrollerDefaultScrollPosition,
  MessageScrollerScrollAlign,
  MessageScrollerScrollOptions,
  MessageScrollerScrollable,
  MessageScrollerVisibilityState,
} from "@shadcn/react/message-scroller";
