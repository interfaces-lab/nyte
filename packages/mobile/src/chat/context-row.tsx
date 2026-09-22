import { HStack, Host, Image, Menu, Text, Button } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { controls, typography, useTheme } from "../theme.ts";

/**
 * The head this send lands on, when the session has more than one. A single
 * head (almost always `main`) is not a choice, so it stays off the composer.
 */
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

  if (head === undefined || heads.length < 2) return null;

  return (
    <Host matchContents={{ horizontal: true }} style={headHost} ignoreSafeArea="all">
      <Menu
        label={
          <HStack spacing={4}>
            <Text modifiers={[font(chipFont), foregroundStyle(theme.muted)]}>{head}</Text>
            <Image systemName="chevron.down" size={10} modifiers={[foregroundStyle(theme.muted)]} />
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
  );
}

const chipFont = { size: typography.caption.fontSize, weight: "medium" } as const;

const headHost = { height: controls.metaTarget } as const;
