/**
 * The head this send lands on, shown above the draft. The share serves one
 * workspace chosen on the Mac and never reports which, so naming it here would
 * be a guess: `workspace.list` is the whole registry, not the shared folder.
 */
import { HStack, Host, Image, Menu, Text, Button } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { css, html } from "react-strict-dom";
import { controls, spacing, textStyles, typography, useTheme } from "../theme.ts";

export function ContextRow({
  head,
  heads,
  onChooseHead,
}: {
  head: string | undefined;
  heads: readonly string[];
  onChooseHead: (head: string) => void;
}) {
  const theme = useTheme();
  if (head === undefined) return null;

  return (
    <html.div style={styles.row}>
      {heads.length < 2 ? (
        <html.span style={textStyles.caption}>{head}</html.span>
      ) : (
        <Host matchContents={{ horizontal: true }} style={headHost} ignoreSafeArea="all">
          <Menu
            label={
              <HStack spacing={4}>
                <Text modifiers={[font(chipFont), foregroundStyle(theme.muted)]}>{head}</Text>
                <Image
                  systemName="chevron.down"
                  size={10}
                  modifiers={[foregroundStyle(theme.muted)]}
                />
              </HStack>
            }
            modifiers={[buttonStyle("plain")]}
          >
            {heads.map((name) => (
              <Button
                key={name}
                label={name}
                systemImage={name === head ? "checkmark" : undefined}
                onPress={() => onChooseHead(name)}
              />
            ))}
          </Menu>
        </Host>
      )}
    </html.div>
  );
}

const chipFont = { size: typography.caption.fontSize, weight: "medium" } as const;
const headHost = { height: controls.metaTarget } as const;

const styles = css.create({
  row: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
