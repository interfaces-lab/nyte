import { ActivityIndicator, Keyboard, StyleSheet, View } from "react-native";
import { Host } from "@expo/ui";
import { Button, HStack, Image, Menu, Picker, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  lineLimit,
  pickerStyle,
  shapes,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import type { Delivery } from "@nyte-ai/sdk";
import { controls, radii, spacing, tokens, useTheme } from "../theme.ts";
import type { ComposerTarget } from "./composer-target.ts";
import { ContextRow } from "./context-row.tsx";
import { THINKING_LABELS } from "./thinking.ts";
import type { ComposerModel } from "./use-composer-model.ts";

const MODEL_FONT = { textStyle: "subheadline", weight: "semibold" } as const;

/**
 * The controls above the composer card: the head switcher while the composer is expanded, how a message
 * lands on a running response (steer or queue) beside the stop button, and the model and thinking
 * pickers, which give way to the waveform while dictating.
 */
export function ComposerControls({
  target,
  expanded,
  recording,
  busy,
  delivery,
  onDelivery,
  model,
  onOpenModelPicker,
  onHeight,
}: {
  target: ComposerTarget;
  expanded: boolean;
  recording: boolean;
  busy: boolean;
  delivery: Delivery;
  onDelivery: (delivery: Delivery) => void;
  model: ComposerModel;
  onOpenModelPicker: () => void;
  onHeight: (height: number) => void;
}) {
  const theme = useTheme();
  const session = target.kind === "session" ? target : undefined;
  const stopping = session?.stopping ?? false;
  const { chosenModel, chosenThinking, thinkingStops } = model;

  return (
    <View style={field.topControls} onLayout={(event) => onHeight(event.nativeEvent.layout.height)}>
      {expanded && session !== undefined && session.heads.length > 1 ? (
        <html.div style={styles.context}>
          <ContextRow
            head={session.head}
            heads={session.heads}
            onChooseHead={(head) => {
              const name = session.heads.find((candidate) => candidate === head);

              if (name !== undefined) session.onChooseHead(name);
            }}
          />
        </html.div>
      ) : null}
      {session?.running ? (
        <html.div style={[styles.deliveryRow, delivery === "queue" && styles.queuedDelivery]}>
          <Host style={field.deliveryHost} matchContents={{ vertical: true }} ignoreSafeArea="all">
            <Menu
              label={
                <HStack spacing={spacing.xs}>
                  <Image
                    systemName={delivery === "queue" ? "clock" : "arrow.turn.up.right"}
                    size={14}
                    modifiers={[foregroundStyle(theme.accent)]}
                  />
                  <Text modifiers={[font(MODEL_FONT), foregroundStyle(theme.accent), lineLimit(1)]}>
                    {delivery === "queue" ? "After this response" : "Steer response"}
                  </Text>
                  <Image
                    systemName="chevron.down"
                    size={10}
                    modifiers={[foregroundStyle(theme.accent)]}
                  />
                </HStack>
              }
              modifiers={[
                buttonStyle("plain"),
                frame({ minHeight: controls.touchTarget }),
                disabled(busy),
              ]}
            >
              <Button
                label="Steer current response"
                systemImage={delivery === "steer" ? "checkmark" : undefined}
                onPress={() => onDelivery("steer")}
              />
              <Button
                label="Queue after response"
                systemImage={delivery === "queue" ? "checkmark" : undefined}
                onPress={() => onDelivery("queue")}
              />
            </Menu>
          </Host>
          <html.button
            aria-label="Stop response"
            aria-busy={stopping}
            disabled={stopping}
            onClick={() => session.onStop()}
            style={styles.stop}
          >
            {stopping ? (
              <ActivityIndicator color={theme.muted} size="small" />
            ) : (
              <SymbolView name="stop.fill" size={16} tintColor={theme.foreground} />
            )}
          </html.button>
        </html.div>
      ) : null}
      {recording ? null : (
        <View style={field.options}>
          <Host style={field.modelHost} matchContents={{ vertical: true }} ignoreSafeArea="all">
            <Button
              onPress={() => {
                Keyboard.dismiss();
                onOpenModelPicker();
              }}
              modifiers={[
                buttonStyle("plain"),
                disabled(busy),
                accessibilityLabel(`Choose model, ${chosenModel?.name ?? "Model"}`),
              ]}
            >
              <HStack
                spacing={spacing.xs}
                modifiers={[
                  frame({
                    minHeight: controls.touchTarget,
                    maxWidth: Infinity,
                    alignment: "leading",
                  }),
                  contentShape(shapes.rectangle()),
                ]}
              >
                <Text
                  modifiers={[font(MODEL_FONT), foregroundStyle(theme.foreground), lineLimit(1)]}
                >
                  {chosenModel?.name ?? "Choose model"}
                </Text>
                <Image
                  systemName="chevron.down"
                  size={12}
                  modifiers={[foregroundStyle(theme.foreground)]}
                />
              </HStack>
            </Button>
          </Host>
          {thinkingStops.length > 1 ? (
            <Host style={field.thinkingHost} matchContents ignoreSafeArea="all">
              <Menu
                label={
                  <HStack
                    spacing={spacing.xs}
                    modifiers={[
                      frame({ minWidth: controls.touchTarget, minHeight: controls.touchTarget }),
                      contentShape(shapes.rectangle()),
                    ]}
                  >
                    <Text
                      modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(theme.muted)]}
                    >
                      {THINKING_LABELS[chosenThinking]}
                    </Text>
                    <Image
                      systemName="chevron.down"
                      size={12}
                      modifiers={[foregroundStyle(theme.muted)]}
                    />
                  </HStack>
                }
                modifiers={[
                  buttonStyle("plain"),
                  disabled(busy),
                  accessibilityLabel(`Thinking level, ${THINKING_LABELS[chosenThinking]}`),
                ]}
              >
                <Picker
                  label="Thinking level"
                  selection={chosenThinking}
                  onSelectionChange={model.chooseThinking}
                  modifiers={[pickerStyle("inline"), labelsHidden()]}
                >
                  {thinkingStops.map((level) => (
                    <Text key={level} modifiers={[tag(level)]}>
                      {THINKING_LABELS[level]}
                    </Text>
                  ))}
                </Picker>
              </Menu>
            </Host>
          ) : null}
        </View>
      )}
    </View>
  );
}

const field = StyleSheet.create({
  topControls: { gap: spacing.xs },
  options: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  thinkingHost: {
    minHeight: controls.touchTarget,
    paddingHorizontal: spacing.sm,
  },
  modelHost: { flex: 1, minHeight: controls.touchTarget, minWidth: 0 },
  deliveryHost: { flex: 1, minHeight: controls.touchTarget, minWidth: 0 },
});

const styles = css.create({
  context: { paddingInline: spacing.md },
  deliveryRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    marginInline: spacing.sm,
    marginTop: spacing.sm,
    paddingLeft: spacing.sm,
    borderBottomWidth: controls.hairline,
    borderBottomColor: tokens.border,
  },
  queuedDelivery: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.accent,
    borderRadius: radii.control,
  },
  stop: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: controls.touchTarget,
    height: controls.touchTarget,
    borderWidth: 0,
    padding: 0,
    opacity: {
      default: 1,
      ":active": controls.pressedOpacity,
      ":disabled": controls.disabledOpacity,
    },
  },
});
