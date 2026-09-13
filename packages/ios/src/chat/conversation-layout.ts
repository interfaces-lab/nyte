import { conversation } from "../theme.ts";

/** Horizontal geometry shared by message rows and the composer. */
export type ConversationLayout = {
  /** Width of one row's content between the gutters. */
  contentWidth: number;
  paddingLeft: number;
  paddingRight: number;
};

/**
 * Centers the content column inside the viewport, keeps it inside the safe
 * area, and caps it at the shared chat width. Rows receive explicit widths
 * because native Markdown and virtualized rows do not reliably inherit a
 * width from percentage or stretch layout.
 */
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
