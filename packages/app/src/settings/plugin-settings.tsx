import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { Switch } from "@nyte-ai/ui/switch";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import type { Json, SettingInfo } from "@nyte-ai/sdk";
import { useApplyPluginSetting } from "../data/plugins.ts";
import type { PluginGroup } from "./plugin-pages.ts";
import { SettingsRow, SettingsSection } from "./rows.tsx";

/** Plugin settings on a page: one section per plugin, each setting with the field its definition calls for. A page with one plugin's settings needs no heading. */
export function PluginGroups({
  groups,
}: {
  readonly groups: readonly PluginGroup[];
}): ReactElement {
  const apply = useApplyPluginSetting(undefined);

  return (
    <>
      {groups.map((group) => (
        <SettingsSection key={group.owner} title={groups.length === 1 ? undefined : group.owner}>
          {group.settings.map((setting) => (
            <SettingsRow
              key={setting.id}
              title={setting.title}
              description={setting.description}
              controlWidth="wide"
            >
              <PluginSetting
                setting={setting}
                disabled={apply.isPending}
                onApply={(value) => apply.mutate({ id: setting.id, value })}
              />
            </SettingsRow>
          ))}
        </SettingsSection>
      ))}
    </>
  );
}

function choiceKey(value: Json): string {
  return JSON.stringify(value);
}

export function PluginSetting({
  setting,
  disabled,
  onApply,
}: {
  readonly setting: SettingInfo;
  readonly disabled: boolean;
  readonly onApply: (value: Json) => void;
}): ReactElement {
  const choices = setting.choices ?? [];

  if (choices.length === 0 && setting.secret === true) {
    return <SecretField setting={setting} disabled={disabled} onApply={onApply} />;
  }

  if (choices.length === 0 && typeof setting.value === "boolean") {
    return (
      <Switch
        label={setting.title}
        checked={setting.value}
        disabled={disabled}
        onCheckedChange={(checked) => onApply(checked)}
      />
    );
  }

  if (choices.length === 0 && setting.schema.type === "string") {
    return <TextField setting={setting} disabled={disabled} onApply={onApply} />;
  }

  if (
    choices.length === 0 &&
    (setting.schema.type === "number" || setting.schema.type === "integer")
  ) {
    return <NumberField setting={setting} disabled={disabled} onApply={onApply} />;
  }

  const note = choices.find((choice) => choiceKey(choice.value) === choiceKey(setting.value))?.note;

  return (
    <>
      <Select
        items={choices.map((choice) => ({ value: choiceKey(choice.value), label: choice.title }))}
        disabled={disabled || choices.length === 0}
        value={choiceKey(setting.value)}
        onValueChange={(key) => {
          const choice = choices.find((candidate) => choiceKey(candidate.value) === key);

          if (choice !== undefined) onApply(choice.value);
        }}
      >
        <SelectTrigger aria-label={setting.title}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem
              key={choiceKey(choice.value)}
              value={choiceKey(choice.value)}
              label={choice.title}
            >
              {choice.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {note !== undefined && <span {...props(text.sm, styles.note)}>{note}</span>}
    </>
  );
}

interface FieldProps {
  readonly setting: SettingInfo;
  readonly disabled: boolean;
  readonly onApply: (value: Json) => void;
}

function TextField({ setting, disabled, onApply }: FieldProps): ReactElement {
  const saved = typeof setting.value === "string" ? setting.value : "";
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <form
      {...props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();

        if (draft !== null && draft !== saved) onApply(draft);
        setDraft(null);
      }}
    >
      <Input
        aria-label={setting.title}
        autoComplete="off"
        spellCheck={false}
        placeholder={setting.placeholder}
        value={draft ?? saved}
        disabled={disabled}
        xstyle={styles.input}
        onValueChange={setDraft}
      />
      <Button
        type="submit"
        variant="outline"
        disabled={disabled || draft === null || draft === saved}
      >
        Save
      </Button>
    </form>
  );
}

function NumberField({ setting, disabled, onApply }: FieldProps): ReactElement {
  const saved = typeof setting.value === "number" ? String(setting.value) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const typed = draft === null || draft.trim() === "" ? Number.NaN : Number(draft);

  const valid =
    Number.isFinite(typed) && (setting.schema.type !== "integer" || Number.isInteger(typed));

  return (
    <form
      {...props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();

        if (valid) onApply(typed);
        setDraft(null);
      }}
    >
      <Input
        variant="code"
        inputMode="decimal"
        aria-label={setting.title}
        autoComplete="off"
        placeholder={setting.placeholder}
        value={draft ?? saved}
        disabled={disabled}
        xstyle={styles.input}
        onValueChange={setDraft}
      />
      <Button type="submit" variant="outline" disabled={disabled || !valid || draft === saved}>
        Save
      </Button>
    </form>
  );
}

function SecretField({ setting, disabled, onApply }: FieldProps): ReactElement {
  const [draft, setDraft] = useState("");
  const value = draft.trim();
  const saved = setting.value !== null;

  return (
    <form
      {...props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();

        if (value === "") return;
        onApply({ secret: true, value });
        setDraft("");
      }}
    >
      <Input
        variant="code"
        type="password"
        aria-label={setting.title}
        autoComplete="off"
        spellCheck={false}
        placeholder={saved ? "Saved" : setting.placeholder}
        value={draft}
        disabled={disabled}
        xstyle={styles.input}
        onValueChange={setDraft}
      />
      <Button type="submit" variant="outline" disabled={disabled || value === ""}>
        Save
      </Button>
      {saved && (
        <Button variant="outline" disabled={disabled} onClick={() => onApply(null)}>
          Remove
        </Button>
      )}
    </form>
  );
}

const styles = create({
  form: { display: "flex", alignItems: "center", gap: space.s2, width: "100%" },
  input: { flex: 1, minWidth: 0 },
  note: { margin: 0, color: role.contentSecondary },
});
