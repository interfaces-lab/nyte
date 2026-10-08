import { createContext, use, useRef, useState } from "react";
import type { ComponentProps } from "react";
import type { View } from "react-native";
import { css, html } from "react-strict-dom";
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from "@legendapp/list/keyboard";
import type { LegendListRef } from "@legendapp/list/react-native";
import { spacing } from "../theme.ts";
import { GlassButton } from "../ui/glass-button.tsx";

export type MessageScrollerItem = { messageId: string; scrollAnchor: boolean };

export function useMessageScrollerProvider({
  autoScroll,
  scrollPreviousItemPeek,
}: {
  autoScroll: boolean;
  scrollPreviousItemPeek: number;
}) {
  const listRef = useRef<LegendListRef>(null);
  const composerRef = useRef<View>(null);
  const anchorScrollPending = useRef(false);
  const [following, setFollowing] = useState(true);
  const [end, setEnd] = useState(false);
  const [anchorId, setAnchorId] = useState<string>();

  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerRef,
  );

  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });

  return {
    listRef,
    composerRef,
    onComposerLayout,
    contentInsetEndAdjustment,
    freeze,
    scrollPreviousItemPeek,
    anchorId,
    maintainScrollAtEnd:
      autoScroll && following ? { on: { dataChange: true, itemLayout: true } } : false,
    scrollable: { end },
    scrollToEnd: () => {
      setFollowing(true);
      void scrollMessageToEnd({ animated: false, closeKeyboard: false });
    },
    anchorSend: async (sent: Promise<boolean>, key: string | undefined) => {
      const accepted = await sent;

      if (accepted && key !== undefined) {
        anchorScrollPending.current = true;
        setAnchorId(`submission:${key}`);
        setFollowing(true);
      }

      return accepted;
    },
    onAnchorReady: () => {
      if (!anchorScrollPending.current) return;
      anchorScrollPending.current = false;
      void scrollMessageToEnd({ animated: false, closeKeyboard: false });
    },
    onScrollBeginDrag: () => setFollowing(false),
    onEndVisible: (visible: boolean) => {
      setEnd(!visible);

      if (visible) setFollowing(true);
    },
  };
}

export const MessageScrollerProvider = createContext<ReturnType<
  typeof useMessageScrollerProvider
> | null>(null);

function useMessageScroller() {
  const scroller = use(MessageScrollerProvider);

  if (scroller === null) throw new Error("MessageScroller parts need a MessageScrollerProvider");

  return scroller;
}

export function MessageScroller<T extends MessageScrollerItem>(
  props: { data: readonly T[] } & Pick<
    ComponentProps<typeof KeyboardAwareLegendList<T>>,
    | "renderItem"
    | "getItemType"
    | "extraData"
    | "contentContainerStyle"
    | "ListEmptyComponent"
    | "ListFooterComponent"
  >,
) {
  const {
    listRef,
    contentInsetEndAdjustment,
    freeze,
    scrollPreviousItemPeek,
    anchorId,
    maintainScrollAtEnd,
    onAnchorReady,
    onScrollBeginDrag,
    onEndVisible,
  } = useMessageScroller();

  const anchorIndex =
    anchorId === undefined
      ? undefined
      : props.data.findIndex((item) => item.messageId === anchorId);

  return (
    <KeyboardAwareLegendList
      {...props}
      ref={listRef}
      recycleItems={false}
      keyExtractor={(item) => item.messageId}
      anchoredEndSpace={
        anchorIndex === undefined
          ? undefined
          : {
              // Until the sent row arrives, an index past the end keeps the previous space.
              anchorIndex: anchorIndex === -1 ? props.data.length : anchorIndex,
              anchorOffset: scrollPreviousItemPeek,
              onReady: onAnchorReady,
            }
      }
      style={{ flex: 1 }}
      estimatedItemSize={140}
      initialScrollAtEnd
      keyboardLiftBehavior="whenAtEnd"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentInsetEndAdjustment={contentInsetEndAdjustment}
      freeze={freeze}
      maintainScrollAtEnd={maintainScrollAtEnd}
      onScrollBeginDrag={onScrollBeginDrag}
      onEndVisible={onEndVisible}
    />
  );
}

export function MessageScrollerButton({ label, prominent }: { label: string; prominent: boolean }) {
  const { scrollable, scrollToEnd } = useMessageScroller();

  if (!scrollable.end) return null;

  return (
    <html.div style={styles.button}>
      <GlassButton
        label={label}
        systemImage="arrow.down"
        iconOnly={!prominent}
        prominent={prominent}
        onPress={scrollToEnd}
      />
    </html.div>
  );
}

const styles = css.create({
  button: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "center",
    paddingBottom: spacing.sm,
  },
});
