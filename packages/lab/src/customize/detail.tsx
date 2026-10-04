import { ConnectionList } from "@nyte-ai/app/chrome/connection-list.tsx";
import { SettingsRow, SettingsSwitchRow } from "@nyte-ai/app/chrome/settings-controls.tsx";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import { reveal } from "./actions";
import { customizeStyles as styles } from "./customize.stylex";
import { sourceLabel, type Contribution, type LabPlugin, type PluginSetting } from "./fixtures";
import { Section } from "./overview";

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.fact)}>
      <span {...props(styles.factLabel)}>{label}</span>
      <span {...props(styles.factValue)}>{children}</span>
    </div>
  );
}

function SettingControl({ setting }: { readonly setting: PluginSetting }): ReactElement {
  const [current, setCurrent] = useState(setting.current);
  const isSwitch =
    setting.choices.length === 2 && setting.choices.every(({ id }) => id === "on" || id === "off");

  if (isSwitch)
    return (
      <SettingsSwitchRow
        title={setting.label}
        description={setting.description}
        checked={current === "on"}
        onCheckedChange={(checked) => setCurrent(checked ? "on" : "off")}
      />
    );

  return (
    <SettingsRow title={setting.label} description={setting.description}>
      <Select
        items={setting.choices.map((choice) => ({ value: choice.id, label: choice.label }))}
        value={current}
        onValueChange={(next) => {
          if (next !== null) setCurrent(next);
        }}
      >
        <SelectTrigger aria-label={setting.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {setting.choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id} label={choice.label}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

function Contributions({ items }: { readonly items: readonly Contribution[] }): ReactElement {
  return (
    <ConnectionList>
      {items.map((item) => (
        <div key={item.name} {...props(styles.contribution)}>
          <span {...props(styles.contributionName)}>{item.name}</span>
          <span {...props(styles.contributionDescription)}>{item.description}</span>
        </div>
      ))}
    </ConnectionList>
  );
}

export function Detail({
  plugin,
  onBack,
}: {
  readonly plugin: LabPlugin;
  readonly onBack: () => void;
}): ReactElement {
  const failed = plugin.standing.kind === "failed" ? plugin.standing.error : undefined;
  const path = plugin.path;

  return (
    <>
      <Button variant="ghost" icon="arrow-left" xstyle={styles.back} onClick={onBack}>
        Customize
      </Button>

      <header {...props(styles.detailHeader)}>
        <span {...props(styles.tile, styles.tileLarge)}>
          <Icon name={plugin.icon} size={24} />
        </span>
        <div {...props(styles.pageCopy)}>
          <h1 {...props(settingsPatterns.pageTitle)}>{plugin.name}</h1>
          {plugin.description !== "" && (
            <p {...props(settingsPatterns.sectionDescription)}>{plugin.description}</p>
          )}
        </div>
      </header>

      {failed !== undefined && path !== undefined && (
        <div role="alert" {...props(intent.danger, styles.failure)}>
          <div {...props(styles.failureHead)}>
            <span {...props(styles.failureIcon)}>
              <Icon name="circle-x" size={16} />
            </span>
            <span {...props(styles.cardCopy)}>
              Couldn&rsquo;t load this plugin
              <span {...props(styles.muted)}>
                Nyte tries again when a file in its folder changes.
              </span>
            </span>
          </div>
          <pre {...props(styles.trace)}>{failed}</pre>
          <div {...props(styles.actions)}>
            <Button icon="folder-open" onClick={() => reveal(path, "open")}>
              Show in Finder
            </Button>
            <Button variant="text" icon="copy" onClick={() => reveal(failed, "copy")}>
              Copy error
            </Button>
          </div>
        </div>
      )}

      <div {...props(styles.facts)}>
        <Fact label="Source">{sourceLabel(plugin.source)}</Fact>
        {plugin.version !== undefined && <Fact label="Version">{plugin.version}</Fact>}
        {path !== undefined && (
          <span {...props(styles.fact, styles.factGrow)}>
            <span {...props(styles.factLabel)}>Location</span>
            <span {...props(styles.factValue, styles.factPath)} title={path}>
              {path}
            </span>
          </span>
        )}
        {path !== undefined && failed === undefined && (
          <Button icon="folder-open" onClick={() => reveal(path, "open")}>
            Show in Finder
          </Button>
        )}
      </div>

      {plugin.settings.length > 0 && (
        <Section title="Settings" description="Defaults for new chats">
          <div {...props(settingsPatterns.group)}>
            {plugin.settings.map((setting) => (
              <SettingControl key={setting.id} setting={setting} />
            ))}
          </div>
        </Section>
      )}

      {plugin.tools.length > 0 && (
        <Section title="Tools">
          <Contributions items={plugin.tools} />
        </Section>
      )}

      {plugin.commands.length > 0 && (
        <Section title="Commands">
          <Contributions items={plugin.commands} />
        </Section>
      )}
    </>
  );
}
