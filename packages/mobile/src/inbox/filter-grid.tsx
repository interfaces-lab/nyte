import { Pressable, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "expo-symbols";
import { radii, spacing, useTheme } from "../theme.ts";

type FilterCard<Filter extends string> = {
  readonly id: Filter;
  readonly label: string;
  readonly icon: SFSymbol;
  readonly tint: string;
  readonly count?: number;
};

export function FilterGrid<Filter extends string>({
  cards,
  active,
  onSelect,
}: {
  cards: readonly FilterCard<Filter>[];
  active: Filter;
  onSelect: (filter: Filter) => void;
}) {
  const theme = useTheme();

  const rows = cards.reduce<FilterCard<Filter>[][]>((acc, card, index) => {
    if (index % 2 === 0) acc.push([card]);
    else acc[acc.length - 1]?.push(card);

    return acc;
  }, []);

  return (
    <View
      style={{
        gap: spacing.md,
        paddingHorizontal: spacing.gutter,
        paddingTop: spacing.lg,
        paddingBottom: spacing.xl,
      }}
    >
      {rows.map((row, index) => (
        <View key={index} style={{ flexDirection: "row", gap: spacing.md }}>
          {row.map((card) => (
            <Pressable
              key={card.id}
              accessibilityRole="button"
              accessibilityLabel={
                card.count === undefined ? card.label : `${card.label}, ${String(card.count)}`
              }
              accessibilityState={{ selected: card.id === active }}
              onPress={() => onSelect(card.id)}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 0,
                minHeight: 104,
                padding: spacing.lg - (card.id === active ? 1 : 0),
                justifyContent: "space-between",
                gap: spacing.md,
                borderRadius: radii.card,
                borderCurve: "continuous",
                borderWidth: card.id === active ? 2 : 1,
                borderColor: card.id === active ? theme.accent : theme.border,
                backgroundColor: pressed ? theme.raised : theme.surface,
              })}
            >
              <SymbolView name={card.icon} size={22} tintColor={card.tint} />
              <Text
                dynamicTypeRamp="body"
                style={{ fontSize: 17, lineHeight: 22, color: theme.foreground }}
              >
                {card.label}
                {card.count === undefined ? null : (
                  <Text style={{ color: theme.muted, fontVariant: ["tabular-nums"] }}>
                    {` ${String(card.count)}`}
                  </Text>
                )}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}
