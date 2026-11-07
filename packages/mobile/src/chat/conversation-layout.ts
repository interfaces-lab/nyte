import { conversation } from "../theme.ts";

export type ConversationLayout = {
  contentWidth: number;
  paddingLeft: number;
  paddingRight: number;
};

export function conversationLayout(
  viewportWidth: number,
  insets: { left: number; right: number },
): ConversationLayout {
  const available = Math.max(0, viewportWidth - insets.left - insets.right);

  const contentWidth = Math.min(
    Math.max(0, available - conversation.gutter * 2),
    conversation.contentMaxWidth,
  );

  const margin = (available - contentWidth) / 2;

  return {
    contentWidth,
    paddingLeft: insets.left + margin,
    paddingRight: insets.right + margin,
  };
}
