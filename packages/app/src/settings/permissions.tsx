import type { ReactElement } from "react";
import { APPROVAL_POLICIES, PERMISSIONS } from "@nyte-ai/plugin/approvals/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { useApplyPluginSetting } from "../queries.ts";
import { hostWatch, useWatch } from "../sdk.tsx";
import { SettingsRow, SettingsSection } from "./rows.tsx";

/** The host's tool approval policy, the one the terminal's `/permissions` changes. */
export function PermissionsSection(): ReactElement | null {
  const setting = useWatch(hostWatch("host")).value?.settings.find(
    (candidate) => candidate.id === PERMISSIONS,
  );

  const apply = useApplyPluginSetting(undefined);
  const current = APPROVAL_POLICIES.find((policy) => policy.value === setting?.value);

  if (setting === undefined) return null;

  return (
    <SettingsSection title="Permissions" description="Applies to every chat at its next tool call">
      <SettingsRow title="Tool approvals" description={current?.description}>
        <Select
          items={APPROVAL_POLICIES}
          value={current?.value ?? null}
          disabled={apply.isPending}
          onValueChange={(next) => {
            if (next !== null) apply.mutate({ id: PERMISSIONS, value: next });
          }}
        >
          <SelectTrigger aria-label="Tool approvals">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPROVAL_POLICIES.map((policy) => (
              <SelectItem key={policy.value} value={policy.value} label={policy.label}>
                {policy.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </SettingsSection>
  );
}
