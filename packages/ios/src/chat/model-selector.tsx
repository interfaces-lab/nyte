import type { NyteClient } from "@nyte-ai/client";
import type { ModelInfo, ModelRef } from "@nyte-ai/protocol";
import { LegendList } from "@legendapp/list/react-native";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { ActivityIndicator, Keyboard, Modal, TextInput } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { css, html } from "react-strict-dom";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { useModelCatalog } from "./remote-models.ts";
import { controls, nativeTheme, radii, spacing, textStyles, tokens, typography } from "../theme.ts";

export function ModelSelector({
  client,
  selectedModel,
  selectingModel,
  modelError,
  onSelect,
}: {
  client: NyteClient;
  selectedModel: ModelRef | undefined;
  selectingModel: boolean;
  modelError: string | undefined;
  onSelect: (model: ModelInfo) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { catalog, refresh } = useModelCatalog(client, open);
  const current = selectedModel ?? (catalog.kind === "ready" ? catalog.defaultModel : undefined);
  const models = catalog.kind === "ready" ? catalog.models : [];
  const selected = models.find(
    (model) =>
      model.id === current?.id &&
      (current?.provider === undefined || model.provider === current.provider),
  );
  const search = query.trim().toLocaleLowerCase();
  const matches = models.filter((model) =>
    `${model.name} ${model.provider} ${model.id}`.toLocaleLowerCase().includes(search),
  );

  async function choose(model: ModelInfo) {
    // Re-choosing the session's explicit model would only queue a no-op configure.
    if (selectedModel?.provider === model.provider && selectedModel.id === model.id) {
      setOpen(false);
      return;
    }
    if (await onSelect(model)) setOpen(false);
  }

  return (
    <>
      <html.div style={styles.trigger}>
        <GlassButton
          label="Model"
          systemImage="chevron.up.chevron.down"
          disabled={selectingModel}
          onPress={() => {
            Keyboard.dismiss();
            setQuery("");
            setOpen(true);
          }}
        />
        <html.span style={[textStyles.caption, styles.modelName]}>
          {selectingModel ? "Changing model…" : (selected?.name ?? current?.id ?? "Host default")}
        </html.span>
      </html.div>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaProvider>
          <SafeAreaView style={{ flex: 1, backgroundColor: nativeTheme.background }}>
            <html.div style={styles.sheet}>
              <html.div style={styles.header}>
                <html.h1 style={[textStyles.title, styles.heading]}>Choose model</html.h1>
                <GlassButton
                  label="Refresh models"
                  systemImage="arrow.clockwise"
                  onPress={refresh}
                  disabled={catalog.kind === "loading" || selectingModel}
                  iconOnly
                />
                <GlassButton
                  label="Close model picker"
                  systemImage="xmark"
                  onPress={() => setOpen(false)}
                  iconOnly
                />
              </html.div>
              <TextInput
                accessibilityLabel="Search models"
                value={query}
                onChangeText={setQuery}
                placeholder="Search models or providers"
                placeholderTextColor={nativeTheme.muted}
                selectionColor={nativeTheme.accent}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
                returnKeyType="search"
                style={{
                  ...typography.body,
                  color: nativeTheme.foreground,
                  backgroundColor: nativeTheme.surface,
                  borderRadius: radii.control,
                  minHeight: controls.touchTarget,
                  padding: spacing.md,
                  marginHorizontal: spacing.lg,
                }}
              />
              {modelError && (
                <html.p role="alert" style={[textStyles.error, styles.notice]}>
                  {modelError}
                </html.p>
              )}
              {selectingModel && (
                <html.div style={styles.progress} aria-live="polite">
                  <ActivityIndicator color={nativeTheme.muted} />
                  <html.span style={textStyles.caption}>Changing model…</html.span>
                </html.div>
              )}
              {catalog.kind === "loading" ? (
                <html.div style={styles.progress}>
                  <ActivityIndicator color={nativeTheme.muted} />
                  <html.span style={textStyles.caption}>Loading host models…</html.span>
                </html.div>
              ) : catalog.kind === "failed" ? (
                <html.div style={styles.failure}>
                  <html.p role="alert" style={textStyles.error}>
                    {catalog.message}
                  </html.p>
                  <GlassButton label="Try again" onPress={refresh} />
                </html.div>
              ) : (
                <LegendList
                  data={matches}
                  keyExtractor={(model) => JSON.stringify([model.provider, model.id])}
                  style={{ flex: 1 }}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  renderItem={({ item }) => {
                    const chosen = item === selected;
                    return (
                      <html.button
                        aria-label={`${item.name}, ${item.provider}`}
                        aria-pressed={chosen}
                        disabled={selectingModel}
                        onClick={() => void choose(item)}
                        style={[styles.row, selectingModel && styles.disabled]}
                      >
                        <html.div style={styles.rowText}>
                          <html.span style={[textStyles.body, chosen && styles.selected]}>
                            {item.name}
                          </html.span>
                          <html.span style={[textStyles.caption, styles.modelName]}>
                            {item.provider} / {item.id}
                          </html.span>
                        </html.div>
                        {chosen && (
                          <SymbolView
                            name="checkmark"
                            size={controls.iconSm}
                            tintColor={nativeTheme.accent}
                          />
                        )}
                      </html.button>
                    );
                  }}
                  ListEmptyComponent={
                    <html.div style={styles.empty}>
                      <EmptyState
                        title={models.length === 0 ? "No models available" : "No matching models"}
                        description={
                          models.length === 0
                            ? "Enable a model on your Mac, then refresh."
                            : "Try another name or provider."
                        }
                      />
                    </html.div>
                  }
                />
              )}
            </html.div>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}

const styles = css.create({
  trigger: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  modelName: { flexShrink: 1, lineClamp: 1 },
  sheet: { flexGrow: 1, gap: spacing.sm, backgroundColor: tokens.background },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: { flexGrow: 1, margin: 0 },
  empty: { paddingInline: spacing.lg },
  notice: { padding: spacing.lg, margin: 0 },
  progress: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  failure: { alignItems: "center", gap: spacing.md, padding: spacing.lg },
  row: {
    borderWidth: 0,
    minHeight: controls.touchTarget,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: { default: tokens.background, ":active": tokens.surface },
  },
  rowText: { flexGrow: 1, flexShrink: 1, alignItems: "flex-start", gap: spacing.xs },
  selected: { color: tokens.accent },
  disabled: { opacity: controls.disabledOpacity },
});
