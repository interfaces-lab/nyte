import { useState } from "react";
import { Linking, View, useColorScheme } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { router } from "expo-router";
import remend from "remend";
import { setStringAsync } from "expo-clipboard";
import { FILE_LINK, markdownStyle, useTheme } from "../theme.ts";
import { useTranscriptFont } from "../settings/preferences.ts";
import { toast } from "../ui/toast.tsx";
import { parseSessionId } from "../view-helpers.ts";

const linkContextMenuItems = {
  [FILE_LINK]: [
    {
      text: "Copy Path",
      icon: "doc.on.doc",
      onPress: ({ url }: { url: string }) => void setStringAsync(filePath(url)),
    },
  ],
};

function filePath(url: string): string {
  const path = url.replace(/^file:\/\//u, "");

  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

export function openExternalLink(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return Promise.resolve(false);

  return Linking.openURL(url).then(
    () => true,
    () => {
      toast.error("Couldn't open link", url);

      return false;
    },
  );
}

function openLink(url: string): void {
  if (url.startsWith("agent:")) {
    const session = parseSessionId(url.slice("agent:".length));

    if (session !== undefined) router.push(`/chat/${session}`);

    return;
  }

  void openExternalLink(url);
}

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
          linkContextMenuItems={linkContextMenuItems}
          onLinkPress={({ url }) => openLink(url)}
        />
      ) : null}
    </View>
  );
}
