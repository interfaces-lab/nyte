import { useState } from "react";
import { Linking, View, useColorScheme } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import remend from "remend";
import { setStringAsync } from "expo-clipboard";
import { markdownStyle, useTheme } from "../theme.ts";
import { useTranscriptFont } from "../settings/preferences.ts";
import { toast } from "../ui/toast.tsx";

export function Markdown({
  text,
  width,
  streaming = false,
  copyMessage = false,
}: {
  text: string;
  width?: number;
  streaming?: boolean;
  copyMessage?: boolean;
}) {
  const theme = useTheme();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const transcriptFont = useTranscriptFont();
  const [measuredWidth, setMeasuredWidth] = useState(width ?? 0);
  const style = markdownStyle(theme, transcriptFont.value, scheme);

  return (
    <View
      style={{ width: width ?? "100%", minHeight: 23 }}
      onLayout={(event) => setMeasuredWidth(Math.max(0, event.nativeEvent.layout.width))}
    >
      {measuredWidth > 0 ? (
        <EnrichedMarkdownText
          markdown={streaming ? remend(text) : text}
          markdownStyle={style}
          flavor="github"
          streamingAnimation={streaming}
          enableTaskListItemToggle={false}
          selectable
          contextMenuItems={
            copyMessage && !streaming
              ? [
                  {
                    text: "Copy Message",
                    icon: "doc.on.doc",
                    onPress: () => void setStringAsync(text),
                  },
                ]
              : undefined
          }
          containerStyle={{ width: measuredWidth }}
          onLinkPress={({ url }) => {
            if (!/^https?:\/\//i.test(url)) return;
            void Linking.openURL(url).catch(() => toast.error("Couldn't open link", url));
          }}
        />
      ) : null}
    </View>
  );
}
