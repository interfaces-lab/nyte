import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import type { LabEnvironment } from "./fixtures";
import { newChatStyles as styles } from "./environments.stylex";

function EnvironmentMenu({
  environments,
  current,
  onChange,
}: {
  readonly environments: readonly LabEnvironment[];
  readonly current: LabEnvironment;
  readonly onChange: (environmentId: string) => void;
}): ReactElement {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button title={current.reach ?? current.name}>
            <Icon name={current.icon} size={13} />
            <span {...props(styles.chipText)}>{current.name}</span>
            <Icon name="chevron-down" size={10} />
          </Button>
        }
      />
      <MenuContent align="start">
        <MenuGroup>
          <MenuGroupLabel>Run on</MenuGroupLabel>
          <MenuRadioGroup
            value={current.id}
            onValueChange={(value: unknown) => {
              const next = environments.find((environment) => environment.id === value);

              if (next !== undefined) onChange(next.id);
            }}
          >
            {environments.map((environment) => (
              <MenuRadioItem
                key={environment.id}
                value={environment.id}
                icon={environment.icon}
                disabled={!environment.online}
                meta={
                  <span {...props(styles.menuMeta)}>
                    {environment.online ? environment.reach : "Offline"}
                  </span>
                }
              >
                {environment.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem icon="plus" onClick={() => undefined}>
          Add connection…
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function FolderMenu({ environment }: { readonly environment: LabEnvironment }): ReactElement {
  const folders = environment.folders ?? [];
  const first = folders[0];

  if (first === undefined) return <span {...props(styles.staticChip)}>No folder</span>;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button title={`${first.name} on ${environment.name}`}>
            <span {...props(styles.chipText)}>{first.name}</span>
            <Icon name="chevron-down" size={10} />
          </Button>
        }
      />
      <MenuContent align="start">
        <MenuGroup>
          <MenuGroupLabel>{`Folders on ${environment.name}`}</MenuGroupLabel>
          {folders.map((folder) => (
            <MenuItem key={folder.name} icon="folder" onClick={() => undefined}>
              {folder.name}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem icon="folder-add" onClick={() => undefined}>
          Open folder…
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function NewChat({
  environments,
  current,
  onChange,
}: {
  readonly environments: readonly LabEnvironment[];
  readonly current: LabEnvironment;
  readonly onChange: (environmentId: string) => void;
}): ReactElement {
  return (
    <div {...props(styles.frame)}>
      <div {...props(styles.context)}>
        <EnvironmentMenu environments={environments} current={current} onChange={onChange} />
        <span {...props(styles.chipDivider)}>/</span>
        <FolderMenu environment={current} />
        {current.folders !== undefined && (
          <span {...props(styles.staticChip)}>
            <Icon name="git-branch" size={13} />
            main
          </span>
        )}
      </div>
      <div {...props(styles.composer)}>
        <span>Ask Nyte, or type / for skills and @ for context</span>
        <div {...props(styles.composerFoot)}>
          <span>Opus 4.8 · High</span>
          <span {...props(styles.send)}>
            <Icon name="arrow-up" size={14} />
          </span>
        </div>
      </div>
    </div>
  );
}
