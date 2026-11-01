/**
 * One specimen per component page: the component itself, live, sized to a
 * catalogue tile. Parts that ship without a look of their own render in
 * x-ray, outlined and labelled with the name a reader imports.
 */

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@nyte-ai/ui/attachment";
import { Avatar, AvatarFallback, AvatarImage } from "@nyte-ai/ui/avatar";
import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from "@nyte-ai/ui/bubble";
import { Button } from "@nyte-ai/ui/button";
import { BarChart, Sparkline, type ChartBucket, type ChartSeries } from "@nyte-ai/ui/chart";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Command } from "@nyte-ai/ui/command";
import { Icon, PanelToggleIcon, type IconName } from "@nyte-ai/ui/icon";
import { Input, InputGroup, Textarea } from "@nyte-ai/ui/input";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Marker, MarkerContent, MarkerIcon } from "@nyte-ai/ui/marker";
import { Message, MessageAvatar, MessageContent, MessageGroup } from "@nyte-ai/ui/message";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@nyte-ai/ui/message-scroller";
import { Meter } from "@nyte-ai/ui/meter";
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireItem,
  QuestionnaireTitle,
} from "@nyte-ai/ui/questionnaire";
import { Row } from "@nyte-ai/ui/row";
import { Slider } from "@nyte-ai/ui/slider";
import { Tabs } from "@nyte-ai/ui/tabs";
import { toast } from "@nyte-ai/ui/toast";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { AutocompleteDemo } from "~/components/components/demos/autocomplete";
import { CheckboxDemo } from "~/components/components/demos/checkbox";
import { ContextMenuDemo } from "~/components/components/demos/context-menu";
import { AlertDialogDemo, DialogDemo } from "~/components/components/demos/dialog";
import { KbdDemo } from "~/components/components/demos/kbd";
import { MenuDemo } from "~/components/components/demos/menu";
import { NumberFieldDemo } from "~/components/components/demos/number-field";
import { PopoverDemo } from "~/components/components/demos/popover";
import { PreviewCardDemo } from "~/components/components/demos/preview-card";
import { SelectDemo } from "~/components/components/demos/select";
import { SpinnerDemo } from "~/components/components/demos/spinner";
import { SwitchDemo } from "~/components/components/demos/switch";
import { ToggleDemo, ToggleGroupDemo } from "~/components/components/demos/toggle";
import { ToolbarDemo } from "~/components/components/demos/toolbar";
import { TooltipDemo } from "~/components/components/demos/tooltip";

const styles = create({
  stack: { display: "flex", flexDirection: "column", gap: space.s3, width: "100%", maxWidth: 240 },
  row: { display: "flex", alignItems: "center", gap: space.s2 },
  avatars: { display: "flex", alignItems: "center", gap: space.s2 },
  chart: { display: "flex", flexDirection: "column", gap: space.s3, width: "100%", maxWidth: 260 },
  chartFoot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontVariantNumeric: "tabular-nums",
  },
  collapsible: { display: "flex", flexDirection: "column", width: "100%", maxWidth: 240 },
  collapsiblePanel: {
    marginBlockStart: space.s1,
    paddingInlineStart: 15,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  icons: { display: "grid", gridTemplateColumns: "repeat(4, 32px)", gap: space.s2 },
  iconCell: {
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    borderRadius: radius.control,
    color: role.contentSecondary,
    backgroundColor: role.bgMutedTranslucent,
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    width: "100%",
    maxWidth: 240,
    padding: space.s1,
    borderRadius: radius.control,
    backgroundColor: role.sidebarMaterial,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  slider: { display: "flex", flexDirection: "column", gap: space.s1, width: "100%", maxWidth: 220 },
  sliderHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between" },
  questionnaire: { width: "100%", maxWidth: 240 },
});

function AlertDialogSpecimen() {
  return <AlertDialogDemo />;
}

function AutocompleteSpecimen() {
  return <AutocompleteDemo />;
}

function AttachmentSpecimen() {
  return (
    <div className="design-xray">
      <Attachment data-xray="Attachment" state="done">
        <AttachmentMedia data-xray="AttachmentMedia">PDF</AttachmentMedia>
        <AttachmentContent data-xray="AttachmentContent">
          <AttachmentTitle data-xray="AttachmentTitle">report.pdf</AttachmentTitle>
          <AttachmentDescription data-xray="AttachmentDescription">2.4 MB</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    </div>
  );
}

function AvatarSpecimen() {
  return (
    <div {...props(styles.avatars)}>
      <Avatar size="lg">
        <AvatarImage src="https://github.com/interfaces-lab.png" alt="interfaces-lab" />
        <AvatarFallback>IL</AvatarFallback>
      </Avatar>
      <Avatar size="lg" tone="orange">
        <AvatarFallback>OR</AvatarFallback>
      </Avatar>
      <Avatar size="md" tone="blue">
        <AvatarFallback>BL</AvatarFallback>
      </Avatar>
      <Avatar size="sm" tone="violet" corners="rounded">
        <AvatarFallback>VI</AvatarFallback>
      </Avatar>
      <Avatar size="xs" tone="green" corners="rounded">
        <AvatarFallback>GR</AvatarFallback>
      </Avatar>
    </div>
  );
}

function BubbleSpecimen() {
  return (
    <div className="design-xray">
      <BubbleGroup data-xray="BubbleGroup">
        <Bubble data-xray="Bubble" align="end">
          <BubbleContent data-xray="BubbleContent">Ship it?</BubbleContent>
          <BubbleReactions data-xray="BubbleReactions">+1</BubbleReactions>
        </Bubble>
      </BubbleGroup>
    </div>
  );
}

function ButtonSpecimen() {
  return (
    <div {...props(styles.row)}>
      <Button variant="solid" tone="primary">
        Commit
      </Button>
      <Button variant="outline">Cancel</Button>
      <Button iconOnly icon="more-horizontal" aria-label="More actions" />
    </div>
  );
}

const usage = [
  { key: "input", label: "Input", tint: "blue" },
  { key: "output", label: "Output", tint: "purple" },
] satisfies readonly ChartSeries[];

const week = [
  { key: "mon", label: "Mon", values: [1200, 400] },
  { key: "tue", label: "Tue", values: [1800, 600] },
  { key: "wed", label: "Wed", values: [900, 300] },
  { key: "thu", label: "Thu", values: [2200, 900] },
  { key: "fri", label: "Fri", values: [1600, 700] },
  { key: "sat", label: "Sat", values: [500, 200] },
  { key: "sun", label: "Sun", values: [700, 250] },
] satisfies readonly ChartBucket[];

function ChartSpecimen() {
  return (
    <div {...props(styles.chart)}>
      <BarChart
        label="Daily token usage this week"
        series={usage}
        buckets={week}
        format={(value) => `${value.toLocaleString("en-US")} tokens`}
        height={72}
        ticks={7}
      />
      <div {...props(styles.chartFoot)}>
        <span>Requests 42</span>
        <Sparkline values={[2, 8, 4, 6, 10, 5, 7]} tint="blue" />
      </div>
    </div>
  );
}

function CheckboxSpecimen() {
  return <CheckboxDemo />;
}

function CollapsibleSpecimen() {
  return (
    <Collapsible.Root defaultOpen xstyle={styles.collapsible}>
      <Collapsible.Trigger>
        <Collapsible.Chevron />
        Advanced settings
      </Collapsible.Trigger>
      <Collapsible.Panel xstyle={styles.collapsiblePanel}>
        Tools run without a prompt while this session is trusted.
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

const commands: readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly keys: readonly string[];
}[] = [
  { id: "new-chat", label: "New chat", icon: "new-chat", keys: ["⌘", "N"] },
  { id: "open-folder", label: "Open folder", icon: "folder-open", keys: ["⌘", "O"] },
  { id: "settings", label: "Settings", icon: "settings", keys: ["⌘", ","] },
];

function CommandSpecimen() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const matches = commands.filter((command) =>
    command.label.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Command.Root open={open} onOpenChange={setOpen}>
      <Command.Trigger
        render={
          <Button variant="outline" icon="command">
            Run a command
          </Button>
        }
      />
      <Command.Popup
        title="Run a command"
        items={matches.map((command) => command.id)}
        value={query}
        onValueChange={setQuery}
      >
        <Command.Input aria-label="Search commands" placeholder="Search commands" />
        <Command.List>
          <Command.Empty>No commands match "{query}"</Command.Empty>
          <Command.Group heading="Commands">
            {matches.map((command) => (
              <Command.Item
                key={command.id}
                value={command.id}
                leading={<Icon name={command.icon} size="md" />}
                meta={<Kbd keys={command.keys} plain />}
                onClick={() => setOpen(false)}
              >
                {command.label}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command.Popup>
    </Command.Root>
  );
}

function ContextMenuSpecimen() {
  return <ContextMenuDemo />;
}

function DialogSpecimen() {
  return <DialogDemo />;
}

const glyphs: readonly IconName[] = [
  "folder",
  "git-branch",
  "console",
  "sparkle",
  "pencil",
  "bolt",
  "globe",
  "settings",
];

function IconSpecimen() {
  const [visible, setVisible] = useState(true);

  return (
    <div {...props(styles.icons)}>
      {glyphs.map((name) => (
        <span key={name} {...props(styles.iconCell)}>
          <Icon name={name} size="md" />
        </span>
      ))}
      <Button
        iconOnly
        aria-label={visible ? "Hide sidebar" : "Show sidebar"}
        onClick={() => setVisible(!visible)}
      >
        <PanelToggleIcon side="left" visible={visible} />
      </Button>
    </div>
  );
}

function InputSpecimen() {
  return (
    <div {...props(styles.stack)}>
      <Input placeholder="Chat name" aria-label="Chat name" />
      <InputGroup>
        <Icon name="search" size="xs" />
        <Input placeholder="Search" aria-label="Search workspace" />
      </InputGroup>
    </div>
  );
}

function KbdSpecimen() {
  return <KbdDemo />;
}

function MarkerSpecimen() {
  return (
    <div className="design-xray">
      <Marker data-xray="Marker" role="status">
        <MarkerIcon data-xray="MarkerIcon">
          <Icon name="clock" size="xs" />
        </MarkerIcon>
        <MarkerContent data-xray="MarkerContent">Waiting for input</MarkerContent>
      </Marker>
    </div>
  );
}

function MenuSpecimen() {
  return <MenuDemo />;
}

function MessageSpecimen() {
  return (
    <div className="design-xray">
      <MessageGroup data-xray="MessageGroup">
        <Message data-xray="Message">
          <MessageAvatar data-xray="MessageAvatar">NY</MessageAvatar>
          <MessageContent data-xray="MessageContent">Inspect this file?</MessageContent>
        </Message>
      </MessageGroup>
    </div>
  );
}

function MessageScrollerSpecimen() {
  return (
    <div className="design-xray">
      <MessageScrollerProvider>
        <MessageScroller data-xray="MessageScroller">
          <MessageScrollerViewport data-xray="MessageScrollerViewport">
            <MessageScrollerContent data-xray="MessageScrollerContent">
              <MessageScrollerItem data-xray="MessageScrollerItem" messageId="question">
                Hello.
              </MessageScrollerItem>
              <MessageScrollerItem data-xray="MessageScrollerItem" messageId="answer">
                Hi there.
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}

function MeterSpecimen() {
  return (
    <div {...props(styles.stack)}>
      <Meter.Root value={64}>
        <Meter.Label>Storage used</Meter.Label>
        <Meter.Value />
        <Meter.Track>
          <Meter.Indicator />
        </Meter.Track>
      </Meter.Root>
    </div>
  );
}

function NumberFieldSpecimen() {
  return <NumberFieldDemo />;
}

function PopoverSpecimen() {
  return <PopoverDemo />;
}

function PreviewCardSpecimen() {
  return <PreviewCardDemo />;
}

const timing = [{ name: "timing", choices: [{ value: "now" }, { value: "review" }] }] as const;

function QuestionnaireSpecimen() {
  return (
    <Questionnaire items={timing} xstyle={styles.questionnaire}>
      <QuestionnaireItem name="timing">
        <QuestionnaireTitle>When should it run?</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="now">Now</QuestionnaireChoice>
          <QuestionnaireChoice value="review">After review</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
    </Questionnaire>
  );
}

const sessions = [
  { id: "onboarding", title: "Onboarding flow", updatedAt: "2m" },
  { id: "migration", title: "Schema migration", updatedAt: "1h" },
  { id: "release", title: "Release notes", updatedAt: "1d" },
];

function RowSpecimen() {
  const [currentId, setCurrentId] = useState("migration");

  return (
    <div {...props(styles.rows)}>
      {sessions.map((session) => (
        <Row key={session.id} interactive selected={session.id === currentId}>
          <Row.Primary
            aria-current={session.id === currentId ? "page" : undefined}
            onClick={() => setCurrentId(session.id)}
          >
            <Row.Leading>
              <Icon name="new-chat" size="sm" />
            </Row.Leading>
            <Row.Label>{session.title}</Row.Label>
            <Row.Meta>{session.updatedAt}</Row.Meta>
          </Row.Primary>
        </Row>
      ))}
    </div>
  );
}

function SelectSpecimen() {
  return <SelectDemo />;
}

function SliderSpecimen() {
  return (
    <Slider.Root defaultValue={40} thumbAlignment="edge" {...props(styles.slider)}>
      <div {...props(styles.sliderHead)}>
        <Slider.Label>Intensity</Slider.Label>
        <Slider.Value />
      </div>
      <Slider.Control>
        <Slider.Track>
          <Slider.Indicator />
          <Slider.Thumb />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

/** At its size, then four times over, where its dithered phases read cell by cell. */
function SpinnerSpecimen() {
  return (
    <>
      <SpinnerDemo />
      <span className="design-magnify">
        <SpinnerDemo />
      </span>
    </>
  );
}

function SwitchSpecimen() {
  return <SwitchDemo />;
}

function TabsSpecimen() {
  return (
    <Tabs.Root variant="segmented" defaultValue="spend">
      <Tabs.List aria-label="Usage">
        <Tabs.Tab value="spend">Spend</Tabs.Tab>
        <Tabs.Tab value="limits">Limits</Tabs.Tab>
        <Tabs.Tab value="tools">Tools</Tabs.Tab>
      </Tabs.List>
    </Tabs.Root>
  );
}

function TextareaSpecimen() {
  return (
    <div {...props(styles.stack)}>
      <Textarea placeholder="System prompt" aria-label="System prompt" />
    </div>
  );
}

/** Raises toasts on the page's one `Toaster`, which the landing and the toast page each mount. */
function ToastSpecimen() {
  return (
    <div {...props(styles.row)}>
      <Button variant="outline" onClick={() => toast.add({ title: "Workspace saved" })}>
        Save
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.add({
            type: "error",
            title: "Could not reach the server",
            description: "The request timed out after 30 seconds.",
          })
        }
      >
        Fail
      </Button>
    </div>
  );
}

function ToggleSpecimen() {
  return <ToggleDemo />;
}

function ToggleGroupSpecimen() {
  return <ToggleGroupDemo />;
}

function ToolbarSpecimen() {
  return <ToolbarDemo />;
}

function TooltipSpecimen() {
  return <TooltipDemo />;
}

export const componentSpecimens = {
  "alert-dialog": AlertDialogSpecimen,
  autocomplete: AutocompleteSpecimen,
  attachment: AttachmentSpecimen,
  avatar: AvatarSpecimen,
  bubble: BubbleSpecimen,
  button: ButtonSpecimen,
  chart: ChartSpecimen,
  checkbox: CheckboxSpecimen,
  collapsible: CollapsibleSpecimen,
  command: CommandSpecimen,
  "context-menu": ContextMenuSpecimen,
  dialog: DialogSpecimen,
  icon: IconSpecimen,
  input: InputSpecimen,
  kbd: KbdSpecimen,
  marker: MarkerSpecimen,
  menu: MenuSpecimen,
  message: MessageSpecimen,
  "message-scroller": MessageScrollerSpecimen,
  meter: MeterSpecimen,
  "number-field": NumberFieldSpecimen,
  popover: PopoverSpecimen,
  "preview-card": PreviewCardSpecimen,
  questionnaire: QuestionnaireSpecimen,
  row: RowSpecimen,
  select: SelectSpecimen,
  slider: SliderSpecimen,
  spinner: SpinnerSpecimen,
  switch: SwitchSpecimen,
  tabs: TabsSpecimen,
  textarea: TextareaSpecimen,
  toast: ToastSpecimen,
  toggle: ToggleSpecimen,
  "toggle-group": ToggleGroupSpecimen,
  toolbar: ToolbarSpecimen,
  tooltip: TooltipSpecimen,
} satisfies Readonly<Record<string, () => ReactElement>>;
