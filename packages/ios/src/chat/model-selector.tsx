import type { NyteClient } from "@nyte-ai/client";
import type { ModelInfo, ModelRef } from "@nyte-ai/protocol";
import { LegendList } from "@legendapp/list/react-native";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { ActivityIndicator, Modal, TextInput, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { css, html } from "react-strict-dom";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { useModelCatalog } from "./remote-models.ts";
import { controls, radii, spacing, textStyles, tokens, typography, useTheme } from "../theme.ts";

/** The model picker sheet, opened from the chat's overflow menu. */
export function ModelPickerSheet({
  client,
  open,
  onClose,
  selectedModel,
  selectingModel,
  modelError,
  onSelect,
}: {
  client: NyteClient;
  open: boolean;
  onClose: () => void;
  selectedModel: ModelRef | undefined;
  selectingModel: boolean;
  modelError: string | undefined;
  onSelect: (model: ModelInfo) => Promise<boolean>;
}) {
  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SheetBody
        client={client}
        open={open}
        onClose={onClose}
        selectedModel={selectedModel}
        selectingModel={selectingModel}
        modelError={modelError}
        onSelect={onSelect}
      />
    </Modal>
  );
}

/**
 * Stays mounted so the Modal's dismissal carries the content down with it; the
 * catalog fetch is gated on `open`, and reopening refetches since nothing here
 * is ever fresh.
 */
function SheetBody({
  client,
  open,
  onClose,
  selectedModel,
  selectingModel,
  modelError,
  onSelect,
}: Parameters<typeof ModelPickerSheet>[0]) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  // Each open starts a clean search; the reset rides the prop, not an effect.
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) setQuery("");
  }
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
      onClose();
      return;
    }
    if (await onSelect(model)) onClose();
  }

  return (
    <SafeAreaProvider>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingBottom: insets.bottom,
        }}
      >
        <html.div style={styles.sheet}>
          <html.div style={styles.header}>
            <html.h1 style={[textStyles.title, styles.heading]}>Choose model</html.h1>
            <GlassButton
              label="Close model picker"
              systemImage="xmark"
              onPress={onClose}
              iconOnly
            />
          </html.div>
          <html.div style={styles.searchField}>
            <SymbolView name="magnifyingglass" size={controls.iconSm} tintColor={theme.muted} />
            <TextInput
              accessibilityLabel="Search models"
              value={query}
              onChangeText={setQuery}
              placeholder="Search models or providers"
              placeholderTextColor={theme.muted}
              selectionColor={theme.accent}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              returnKeyType="search"
              style={{
                ...typography.body,
                color: theme.foreground,
                flexGrow: 1,
                padding: 0,
              }}
            />
          </html.div>
          {modelError && (
            <html.p role="alert" style={[textStyles.error, styles.notice]}>
              {modelError}
            </html.p>
          )}
          {selectingModel && (
            <html.div style={styles.progress} aria-live="polite">
              <ActivityIndicator color={theme.muted} />
              <html.span style={textStyles.caption}>Changing model…</html.span>
            </html.div>
          )}
          {catalog.kind === "loading" ? (
            <html.div style={styles.progress}>
              <ActivityIndicator color={theme.muted} />
              <html.span style={textStyles.caption}>Loading host models…</html.span>
            </html.div>
          ) : catalog.kind === "failed" ? (
            <html.div style={styles.failure}>
              <html.p role="alert" style={textStyles.error}>
                {catalog.message}
              </html.p>
              <GlassButton label="Try again" onPress={refresh} fill />
            </html.div>
          ) : (
            <LegendList
              data={matches}
              keyExtractor={(model) => JSON.stringify([model.provider, model.id])}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              renderItem={({ item, index }) => {
                const chosen = item === selected;
                return (
                  <html.button
                    aria-label={`${item.name}, ${item.provider}`}
                    aria-pressed={chosen}
                    disabled={selectingModel}
                    onClick={() => void choose(item)}
                    style={[styles.row, index === matches.length - 1 && styles.rowLast]}
                  >
                    <html.div style={styles.rowText}>
                      <html.span style={textStyles.body}>{item.name}</html.span>
                      <html.span style={[textStyles.caption, styles.modelName]}>
                        {item.provider} / {item.id}
                      </html.span>
                    </html.div>
                    {chosen && (
                      <SymbolView
                        name="checkmark"
                        size={controls.iconSm}
                        weight="semibold"
                        tintColor={theme.accent}
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
      </View>
    </SafeAreaProvider>
  );
}

const styles = css.create({
  sheet: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    gap: spacing.sm,
    backgroundColor: tokens.background,
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.gutter,
    gap: spacing.md,
  },
  heading: { flexGrow: 1, margin: 0 },
  searchField: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: controls.chipHeight,
    borderRadius: radii.control,
    backgroundColor: tokens.fill,
    paddingInline: spacing.sm,
    marginInline: spacing.gutter,
  },
  empty: { paddingInline: spacing.gutter },
  notice: { padding: spacing.gutter, margin: 0 },
  progress: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.gutter,
  },
  failure: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: spacing.md,
    padding: spacing.gutter,
  },
  row: {
    borderWidth: 0,
    minHeight: controls.touchTarget,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.gutter,
    paddingBlock: spacing.sm,
    borderBottomWidth: controls.hairline,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.separator,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  modelName: { lineClamp: 1, textAlign: "start" },
});
