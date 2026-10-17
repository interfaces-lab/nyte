import type { Connection, ModelInfo, ModelRef } from "@nyte-ai/sdk";
import { LegendList } from "@legendapp/list/react-native";
import { SymbolView } from "expo-symbols";
import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, TextInput, View } from "react-native";
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
  client: Connection;
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
 * is ever fresh. Each open starts a clean search, reset from the prop rather
 * than an effect. Re-choosing the session's explicit model just closes, since
 * configuring it again would queue a no-op.
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
  const searchRef = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [seenOpen, setSeenOpen] = useState(open);

  if (seenOpen !== open) {
    setSeenOpen(open);

    if (open) setQuery("");
  }

  const { catalog, refresh } = useModelCatalog(client, open);

  const current =
    selectedModel ?? (catalog.kind === "ready" ? catalog.defaultModel?.ref : undefined);

  const models = catalog.kind === "ready" ? catalog.models : [];

  const selected = models.find(
    (model) => model.ref.id === current?.id && model.ref.provider === current.provider,
  );

  const search = query.trim().toLocaleLowerCase();

  const matches = models.filter((model) =>
    `${model.name} ${model.ref.provider} ${model.ref.id}`.toLocaleLowerCase().includes(search),
  );

  async function choose(model: ModelInfo) {
    if (selectedModel?.provider === model.ref.provider && selectedModel.id === model.ref.id) {
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Focus model search"
            onPress={() => searchRef.current?.focus()}
          >
            <html.div style={styles.searchField}>
              <SymbolView name="magnifyingglass" size={controls.iconSm} tintColor={theme.muted} />
              <TextInput
                ref={searchRef}
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
                  minHeight: controls.touchTarget,
                  padding: 0,
                }}
              />
            </html.div>
          </Pressable>
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
              <GlassButton label="Try Again" onPress={refresh} fill />
            </html.div>
          ) : (
            <LegendList
              data={matches}
              keyExtractor={(model) => JSON.stringify([model.ref.provider, model.ref.id])}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              renderItem={({ item }) => {
                const chosen = item === selected;

                return (
                  <html.button
                    aria-label={`${item.name}, ${item.ref.provider}`}
                    aria-pressed={chosen}
                    disabled={selectingModel}
                    onClick={() => void choose(item)}
                    style={[styles.row, chosen && styles.selectedRow]}
                  >
                    <html.div style={styles.rowText}>
                      <html.span style={textStyles.body}>{item.name}</html.span>
                      <html.span style={[textStyles.caption, styles.modelName]}>
                        {item.ref.provider} / {item.ref.id}
                      </html.span>
                    </html.div>
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
    minHeight: controls.touchTarget,
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
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radii.control,
    minHeight: controls.touchTarget,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginInline: spacing.gutter,
    marginBlock: spacing.xs,
    paddingInline: spacing.md,
    paddingBlock: spacing.sm,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  selectedRow: { borderColor: tokens.accent, backgroundColor: tokens.selection },
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
