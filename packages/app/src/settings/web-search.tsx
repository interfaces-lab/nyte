import {
  PROVIDERS,
  SEARCH_KEYS_SETTING,
  SEARCH_OFF,
  SEARCH_PROVIDER_SETTING,
  SearchKeysType,
} from "@nyte-ai/plugin/web/schema";
import type { SearchKeys } from "@nyte-ai/plugin/web/schema";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { Type } from "typebox";
import { errorMessage } from "../contract/errors.ts";
import { connected } from "../data/connection.ts";
import { useSetting } from "../preferences/index.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { SelectRow, SettingsRow, SettingsSection } from "./rows.tsx";

const providerSetting = pluginSetting(SEARCH_PROVIDER_SETTING, Type.String());

const keysSetting = pluginSetting(SEARCH_KEYS_SETTING, SearchKeysType);

const OPTIONS = [
  SEARCH_OFF,
  ...PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name })),
] as const;

export function WebSearchSettings(): ReactElement {
  const keys = useSetting(keysSetting);

  const save = useMutation({
    mutationFn: async (next: SearchKeys) => {
      const outcome = await (await connected()).settings.apply(SEARCH_KEYS_SETTING, next);

      if (outcome.kind !== "applied") throw new Error("That key couldn't be saved.");
    },
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  return (
    <>
      <SettingsSection>
        <SelectRow title="Provider" setting={providerSetting} options={OPTIONS} />
      </SettingsSection>
      <SettingsSection title="API keys">
        {PROVIDERS.map((provider) => (
          <KeyRow
            key={provider.id}
            name={provider.name}
            saved={keys?.[provider.id] !== undefined}
            disabled={keys === undefined || save.isPending}
            onSave={(value, saved) =>
              save.mutate({ ...keys, [provider.id]: { secret: true, value } }, { onSuccess: saved })
            }
            onRemove={() =>
              save.mutate(
                Object.fromEntries(
                  Object.entries(keys ?? {}).filter((entry) => entry[0] !== provider.id),
                ),
              )
            }
          />
        ))}
      </SettingsSection>
    </>
  );
}

function KeyRow({
  name,
  saved,
  disabled,
  onSave,
  onRemove,
}: {
  readonly name: string;
  readonly saved: boolean;
  readonly disabled: boolean;
  readonly onSave: (value: string, saved: () => void) => void;
  readonly onRemove: () => void;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const value = draft.trim();

  return (
    <SettingsRow title={name} controlWidth="wide">
      <form
        {...props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();

          if (value !== "") onSave(value, () => setDraft(""));
        }}
      >
        <Input
          variant="code"
          type="password"
          aria-label={`${name} API key`}
          autoComplete="off"
          spellCheck={false}
          placeholder={saved ? "Saved" : "Paste an API key"}
          value={draft}
          disabled={disabled}
          xstyle={styles.input}
          onValueChange={setDraft}
        />
        <Button type="submit" variant="outline" disabled={disabled || value === ""}>
          Save
        </Button>
        {saved && (
          <Button variant="outline" disabled={disabled} onClick={onRemove}>
            Remove
          </Button>
        )}
      </form>
    </SettingsRow>
  );
}

const styles = create({
  form: { display: "flex", alignItems: "center", gap: space.s2, width: "100%" },
  input: { flex: 1, minWidth: 0 },
});
