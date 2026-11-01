import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { focus, srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { glyph, media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { appearance, role } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Switch } from "@nyte-ai/ui/switch";
import { TOAST_POSITIONS, type ToastPosition } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { TaskMark } from "../components/task-mark.tsx";
import { Deferred } from "../lib/deferred.tsx";
import {
  ALERT_OFFERS,
  chosenChannels,
  DESKTOP_SETTING_SCHEMAS,
  effectiveChannels,
  findAlertBlocker,
  type AlertBlocker,
  type AlertChannel,
  type AlertSettings,
  type AlertState,
} from "../contract/desktop-settings.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { available } from "./capability.ts";
import { SettingsDialog, SettingsDialogCard } from "./dialog.tsx";
import { SettingsRow, SettingsSection, SettingsSwitchRow, SwitchRow } from "./rows.tsx";

const CHANNEL_LABEL: Readonly<Record<AlertChannel, string>> = {
  notification: "Notification",
  badge: "Dock badge",
  sound: "Sound",
  bounce: "Bounce Dock",
  remind: "Remind until answered",
};

const CHANNEL_DETAIL: Readonly<Record<AlertChannel, string>> = {
  notification: "A system notification, even while Nyte is in the background",
  badge: "Count it on the Dock icon",
  sound: "Play a sound with the notification",
  bounce: "Bounce the Dock icon until you switch to Nyte",
  remind: "Notify again until you answer",
};

const MASTER_LABEL = {
  notifications: "Show system notifications",
  dockBadge: "Badge Dock icon",
  notificationSounds: "Play sounds",
} as const;

/** The Dock lives on macOS; elsewhere those channels aren't offered. */
const DOCK_CHANNELS: ReadonlySet<AlertChannel> = new Set(["badge", "bounce"]);

const notifications = pluginSetting("desktop.notifications", DESKTOP_SETTING_SCHEMAS.notifications);

const dockBadge = pluginSetting("desktop.dockBadge", DESKTOP_SETTING_SCHEMAS.dockBadge);

const notificationSounds = pluginSetting(
  "desktop.notificationSounds",
  DESKTOP_SETTING_SCHEMAS.notificationSounds,
);

const alertsWaiting = pluginSetting("desktop.alertsWaiting", DESKTOP_SETTING_SCHEMAS.alertsWaiting);

const alertsFailed = pluginSetting("desktop.alertsFailed", DESKTOP_SETTING_SCHEMAS.alertsFailed);

const alertsDone = pluginSetting("desktop.alertsDone", DESKTOP_SETTING_SCHEMAS.alertsDone);

const remindMinutes = pluginSetting("desktop.remindMinutes", DESKTOP_SETTING_SCHEMAS.remindMinutes);

const REMIND_MINUTES = DESKTOP_SETTING_SCHEMAS.remindMinutes.anyOf.map((literal) => literal.const);

const INTERVALS = REMIND_MINUTES.map((minutes) => ({
  value: String(minutes),
  label: minutes === 1 ? "Every minute" : `Every ${String(minutes)} minutes`,
}));

const notifyViewedChat = pluginSetting(
  "desktop.notifyViewedChat",
  DESKTOP_SETTING_SCHEMAS.notifyViewedChat,
);

const notifySubagents = pluginSetting(
  "desktop.notifySubagents",
  DESKTOP_SETTING_SCHEMAS.notifySubagents,
);

const terminalNotifications = pluginSetting(
  "desktop.terminalNotifications",
  DESKTOP_SETTING_SCHEMAS.terminalNotifications,
);

const STATES = [
  { id: "waiting", title: "Needs you", detail: "A question or an approval", mark: "waiting" },
  { id: "failed", title: "Failed", detail: "A run stopped on an error", mark: "failed" },
  { id: "done", title: "Done", detail: "A run finished", mark: "done" },
] as const satisfies readonly {
  readonly id: AlertState;
  readonly title: string;
  readonly detail: string;
  /** The sidebar's own mark for the state; Done is the unread mark. */
  readonly mark: TaskState;
}[];

type State = (typeof STATES)[number];

export function NotificationsSettings(): ReactElement {
  const mac = available(["mac"]);
  const [open, setOpen] = useState<AlertState | undefined>(undefined);
  const position = useSetting(preferences.toastPosition);
  const terminal = useSetting(terminalNotifications);
  const every = useSetting(remindMinutes) ?? 2;

  const settings: AlertSettings = {
    notifications: useSetting(notifications) ?? false,
    dockBadge: (useSetting(dockBadge) ?? false) && mac,
    notificationSounds: useSetting(notificationSounds) ?? false,
    alertsWaiting: useSetting(alertsWaiting) ?? [],
    alertsFailed: useSetting(alertsFailed) ?? [],
    alertsDone: useSetting(alertsDone) ?? [],
  };

  const waiting = effectiveChannels("waiting", settings);

  return (
    <>
      <SettingsSection title="In-app notifications">
        <SettingsRow title="Position" description={`Shown ${positionLabel(position)}`}>
          <PositionPicker
            value={position}
            onChange={(next) => preferences.toastPosition.set(next)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Agent activity"
        preview={
          <Deferred entry="previews">
            {(previews) => (
              <previews.ActivityPreview
                notification={waiting.includes("notification")}
                badge={waiting.includes("badge")}
                dock={mac}
              />
            )}
          </Deferred>
        }
      >
        <SwitchRow
          setting={notifications}
          title={MASTER_LABEL.notifications}
          description="Also while Nyte is in the background"
        />
        <SwitchRow
          setting={dockBadge}
          title={MASTER_LABEL.dockBadge}
          description="Count the chats that need you"
          needs={["mac"]}
        />
        <SwitchRow setting={notificationSounds} title={MASTER_LABEL.notificationSounds} />
      </SettingsSection>

      <SettingsSection note={reminderNote(waiting, every)}>
        {STATES.map((state) => (
          <div key={state.id} data-settings-row="" {...props(settingsPatterns.rowRule)}>
            <Row.Primary
              aria-haspopup="dialog"
              onClick={() => setOpen(state.id)}
              xstyle={[settingsPatterns.row, styles.stateRow, focus.ringInset]}
            >
              <StateCopy
                mark={state.mark}
                title={state.title}
                description={[
                  "Sidebar",
                  ...effectiveChannels(state.id, settings).map((channel) => CHANNEL_LABEL[channel]),
                ].join(", ")}
              />
              <span {...props(styles.chevron)}>
                <Icon name="chevron-right" size="sm" />
              </span>
            </Row.Primary>
          </div>
        ))}
        <div data-settings-row="" {...props(settingsPatterns.rowRule, settingsPatterns.row)}>
          <StateCopy mark="working" title="Working" description="Sidebar" />
        </div>
      </SettingsSection>
      {STATES.flatMap((state) =>
        state.id === open
          ? [
              <ChannelsDialog
                key={state.id}
                state={state}
                settings={settings}
                mac={mac}
                every={every}
                onClose={() => setOpen(undefined)}
              />,
            ]
          : [],
      )}

      <SettingsSection>
        <SwitchRow setting={notifyViewedChat} title="Notify about the chat you're viewing" />
        <SwitchRow
          setting={notifySubagents}
          title="Include subagent chats"
          description="Chats an agent starts to delegate work"
        />
      </SettingsSection>

      <SettingsSection title="System notifications">
        <SettingsSwitchRow
          title="Terminal notifications"
          description={
            settings.notifications
              ? "Programs in Nyte terminals can notify with OSC 9 or OSC 777"
              : `Turn on ${MASTER_LABEL.notifications} first`
          }
          checked={(terminal ?? false) && settings.notifications}
          disabled={terminal === undefined || !settings.notifications}
          onCheckedChange={(checked) => terminalNotifications.set(checked)}
        />
      </SettingsSection>
    </>
  );
}

function StateCopy({
  mark,
  title,
  description,
}: {
  readonly mark: TaskState;
  readonly title: string;
  readonly description: string;
}): ReactElement {
  return (
    <>
      <span {...props(styles.stateGlyph)}>
        <TaskMark state={mark} unread={mark === "done"} />
      </span>
      <span {...props(settingsPatterns.rowCopy)}>
        <span {...props(settingsPatterns.rowTitle)}>{title}</span>
        <span {...props(settingsPatterns.rowDescription)}>{description}</span>
      </span>
    </>
  );
}

function ChannelsDialog({
  state,
  settings,
  mac,
  every,
  onClose,
}: {
  readonly state: State;
  readonly settings: AlertSettings;
  readonly mac: boolean;
  readonly every: number;
  readonly onClose: () => void;
}): ReactElement {
  const offered: readonly AlertChannel[] = ALERT_OFFERS[state.id].filter(
    (channel) => mac || !DOCK_CHANNELS.has(channel),
  );

  const chosen = chosenChannels(state.id, settings);

  return (
    <SettingsDialog
      open
      title={state.title}
      description={state.detail}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SettingsDialogCard>
        {offered.map((channel) => {
          const blocker = findAlertBlocker(channel, state.id, settings);
          const checked = blocker === undefined && chosen.includes(channel);

          return (
            <SettingsRow
              key={channel}
              title={CHANNEL_LABEL[channel]}
              description={
                blocker === undefined
                  ? CHANNEL_DETAIL[channel]
                  : `Turn on ${blockerLabel(blocker)} first`
              }
            >
              <span {...props(styles.inline)}>
                {channel === "remind" && checked && (
                  <Select
                    items={INTERVALS}
                    value={String(every)}
                    onValueChange={(next) => {
                      const minutes = REMIND_MINUTES.find((each) => String(each) === next);

                      if (minutes !== undefined) remindMinutes.set(minutes);
                    }}
                  >
                    <SelectTrigger aria-label="Remind every">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVALS.map((interval) => (
                        <SelectItem
                          key={interval.value}
                          value={interval.value}
                          label={interval.label}
                        >
                          {interval.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Switch
                  label={CHANNEL_LABEL[channel]}
                  checked={checked}
                  disabled={blocker !== undefined}
                  onCheckedChange={(next) =>
                    saveChannels(
                      state.id,
                      next ? [...chosen, channel] : chosen.filter((each) => each !== channel),
                    )
                  }
                />
              </span>
            </SettingsRow>
          );
        })}
      </SettingsDialogCard>
    </SettingsDialog>
  );
}

/** Stores a state's channels in the order it offers them, keeping only the ones it offers. */
function saveChannels(state: AlertState, channels: readonly AlertChannel[]): void {
  switch (state) {
    case "waiting":
      alertsWaiting.set(ALERT_OFFERS.waiting.filter((channel) => channels.includes(channel)));

      return;
    case "failed":
      alertsFailed.set(ALERT_OFFERS.failed.filter((channel) => channels.includes(channel)));

      return;
    case "done":
      alertsDone.set(ALERT_OFFERS.done.filter((channel) => channels.includes(channel)));

      return;
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

function blockerLabel(blocker: AlertBlocker): string {
  return blocker.kind === "master" ? MASTER_LABEL[blocker.setting] : CHANNEL_LABEL[blocker.channel];
}

/** The sentence under the states card: what Needs you does past the first alert, if anything. */
function reminderNote(waiting: readonly AlertChannel[], every: number): string | undefined {
  const remind = waiting.includes("remind");
  const bounce = waiting.includes("bounce");
  const interval = every === 1 ? "minute" : `${String(every)} minutes`;

  if (remind && bounce)
    return `Needs you reminds you every ${interval} until you answer, and the Dock bounces until you switch to Nyte.`;

  if (remind) return `Needs you reminds you every ${interval} until you answer.`;

  if (bounce) return "Needs you bounces the Dock until you switch to Nyte.";

  return undefined;
}

function positionLabel(position: ToastPosition): string {
  return position.replace("-", " ");
}

function PositionPicker({
  value,
  onChange,
}: {
  readonly value: ToastPosition;
  readonly onChange: (position: ToastPosition) => void;
}): ReactElement {
  return (
    <div role="radiogroup" aria-label="Notification position" {...props(styles.picker)}>
      {TOAST_POSITIONS.map((position) => (
        <label
          key={position}
          {...props(
            position === value && intent.primary,
            styles.cell,
            position === value && styles.cellOn,
          )}
        >
          <input
            type="radio"
            name="toast-position"
            value={position}
            checked={position === value}
            aria-label={positionLabel(position)}
            onChange={() => onChange(position)}
            {...props(srOnly)}
          />
          {position === value && <Icon name="checkmark" size="xs" />}
        </label>
      ))}
    </div>
  );
}

const styles = create({
  picker: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 32px)",
    gridTemplateRows: "16px 16px",
    rowGap: space.s6,
    columnGap: space.s2,
    padding: space.s2,
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  cell: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    outlineStyle: { default: "none", ":has(:focus-visible)": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: 1,
    backgroundColor: { default: role.bgMuted, ":hover": { [media.hover]: role.bgHover } },
    color: role.contentOnInteractiveStrong,
    cursor: appearance.cursorInteractive,
  },
  cellOn: {
    backgroundColor: role.bgInteractiveStrong,
  },
  stateRow: { width: "100%" },
  stateGlyph: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    width: glyph.md,
  },
  chevron: { display: "inline-flex", color: role.contentTertiary },
  inline: { display: "inline-flex", alignItems: "center", gap: space.s2 },
});
