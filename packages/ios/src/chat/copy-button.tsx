import { memo, useEffect, useRef, useState } from "react";
import { Alert, Pressable } from "react-native";
import { SymbolView } from "expo-symbols";
import { setStringAsync } from "expo-clipboard";
import { controls, nativeTheme } from "../theme.ts";

const COPIED_FEEDBACK_MS = 1200;

/** Copies the supplied text, including Markdown formatting, and confirms with a checkmark. */
export const CopyButton = memo(function CopyButton({
  text,
  label = "Copy message",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : label}
      disabled={text.length === 0}
      hitSlop={8}
      onPress={async () => {
        try {
          await setStringAsync(text);
        } catch {
          Alert.alert("Couldn't copy message", "Try again.");
          return;
        }
        setCopied(true);
        clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      }}
      style={({ pressed }) => ({
        width: controls.metaTarget,
        height: controls.metaTarget,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? controls.disabledOpacity : 1,
      })}
    >
      <SymbolView
        name={copied ? "checkmark" : "doc.on.doc"}
        size={controls.iconXs}
        weight={controls.iconWeight}
        tintColor={nativeTheme.muted}
      />
    </Pressable>
  );
});
