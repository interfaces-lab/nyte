import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactNode } from "react";
import { AlertDialog, ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteTrigger,
} from "@nyte-ai/ui/autocomplete";
import { Button, ButtonGroup, ButtonLink, SplitButton } from "@nyte-ai/ui/button";
import { Checkbox, CheckboxField } from "@nyte-ai/ui/checkbox";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Command } from "@nyte-ai/ui/command";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuSwitchItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLinkItem,
  ContextMenuTrigger,
} from "@nyte-ai/ui/context-menu";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Input, InputGroup, Textarea } from "@nyte-ai/ui/input";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@nyte-ai/ui/number-field";
import { Popover } from "@nyte-ai/ui/popover";
import { PreviewCard, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { Row } from "@nyte-ai/ui/row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Slider } from "@nyte-ai/ui/slider";
import { Switch, SwitchField } from "@nyte-ai/ui/switch";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { Toolbar } from "@nyte-ai/ui/toolbar";
import { Tooltip, TooltipProvider, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Toaster, toast } from "@nyte-ai/ui/toast";
import "../src/theme/tokens.stylex.ts";

const selector =
  'button, a[href], input:not([type="hidden"]), textarea, [role="slider"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]';

function Sample({ children }: { children: ReactNode }) {
  return (
    <section style={{ display: "flex", alignItems: "center", gap: 16, padding: 16 }}>
      {children}
    </section>
  );
}

function hitArea(control: Element) {
  control.scrollIntoView({ block: "center", inline: "center" });
  const rect = control.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const hits = (x: number, y: number): boolean => {
    const target = document.elementFromPoint(x, y);

    if (target === null) return false;

    if (control.contains(target)) return true;

    if (!(control instanceof HTMLInputElement)) return false;

    if (target.closest("button, a, input, textarea, [role=button]")) return false;

    return [...(control.labels ?? [])].some((label) => label.contains(target));
  };

  const reach = (dx: number, dy: number): number => {
    let distance = 0;

    while (distance < 512 && hits(x + dx * (distance + 0.125), y + dy * (distance + 0.125)))
      distance += 0.25;

    return distance;
  };

  const left = x - reach(-1, 0);
  const right = x + reach(1, 0);
  const top = y - reach(0, -1);
  const bottom = y + reach(0, 1);

  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

export async function run(): Promise<string> {
  const coarse = matchMedia("(pointer: coarse)").matches;

  if (!coarse && !matchMedia("(pointer: fine)").matches)
    throw new Error("Pointer emulation failed");
  const floor = coarse ? 44 : 24;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const failures: string[] = [];

  const measure = (container: ParentNode) => {
    const controls = [...container.querySelectorAll(selector)].filter((control) => {
      const style = getComputedStyle(control);

      return (
        control.getBoundingClientRect().width > 0 &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        control.getAttribute("aria-hidden") !== "true"
      );
    });

    for (const control of controls) {
      const box = hitArea(control);

      if (box.width < floor - 0.25 || box.height < floor - 0.25)
        failures.push(
          `${control.outerHTML.slice(0, 180)} hit area ${box.width}x${box.height}, expected ${floor}`,
        );
    }

    return controls.length;
  };

  const paint = async (children: ReactNode, selector: string): Promise<void> => {
    flushSync(() => root.render(children));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const content = document.querySelector(selector);

    if (content === null) throw new Error(`Missing control container ${selector}`);

    if (measure(content) === 0) throw new Error(`No controls in ${selector}`);
  };

  try {
    flushSync(() =>
      root.render(
        <TooltipProvider>
          {(["ghost", "pill", "outline", "solid", "plain", "text"] as const).flatMap((variant) =>
            (["2xs", "xs", "sm", "md", "lg", "xl"] as const).map((size) => (
              <Sample key={`${variant}:${size}`}>
                <Button variant={variant} size={size}>
                  Save
                </Button>
                <Button variant={variant} size={size} iconOnly icon="plus" aria-label="Add" />
                <ButtonLink variant={variant} size={size} href="#">
                  View
                </ButtonLink>
                <Toggle size={size} iconOnly icon="plus" aria-label="Pin" />
              </Sample>
            )),
          )}
          {(["2xs", "xs", "sm", "md", "lg", "xl"] as const).map((size) => (
            <Sample key={size}>
              <ButtonGroup data-no-overlap>
                <Button size={size}>Save</Button>
                <Button size={size} iconOnly icon="plus" aria-label="Add" />
                <ButtonLink size={size} href="#">
                  View
                </ButtonLink>
              </ButtonGroup>
              <SplitButton.Root data-no-overlap>
                <SplitButton.Main size={size}>Run</SplitButton.Main>
                <SplitButton.MenuTrigger size={size} aria-label="Run options" />
              </SplitButton.Root>
              <Toolbar.Root data-no-overlap>
                <Toolbar.Button size={size} iconOnly icon="plus" aria-label="Add" />
                <Toolbar.Button
                  render={<Toggle size={size} iconOnly icon="pin" aria-label="Pin" />}
                />
                <Toolbar.Group>
                  <Toolbar.Button size={size}>Save</Toolbar.Button>
                </Toolbar.Group>
              </Toolbar.Root>
            </Sample>
          ))}
          <Sample>
            <Button loading>Save</Button>
            <Button disabled disabledReason="Offline">
              Save
            </Button>
          </Sample>
          <Sample>
            <Checkbox aria-label="Select" />
            <Checkbox size="lg" aria-label="Select" />
            <CheckboxField label="Select item" />
            <Switch label="Enable" />
            <SwitchField label="Enable feature" />
          </Sample>
          {(["md", "lg", "xl"] as const).map((size) => (
            <Sample key={size}>
              <Input size={size} aria-label="Name" />
              <InputGroup size={size}>
                <Input aria-label="Search" />
              </InputGroup>
              <Textarea size={size} aria-label="Message" />
            </Sample>
          ))}
          <Sample>
            <Select items={[{ value: "local", label: "Local" }]} value="local">
              <SelectTrigger aria-label="Environment">
                <SelectValue />
              </SelectTrigger>
            </Select>
            <NumberField defaultValue={2}>
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput aria-label="Count" />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
          </Sample>
          <Sample>
            <Slider.Root defaultValue={50} style={{ width: 240 }}>
              <Slider.Control>
                <Slider.Track>
                  <Slider.Indicator />
                </Slider.Track>
                <Slider.Thumb aria-label="Volume" />
              </Slider.Control>
            </Slider.Root>
          </Sample>
          {(["segmented", "underline", "pill", "plain"] as const).map((variant) => (
            <Sample key={variant}>
              <Tabs.Root variant={variant} defaultValue="a">
                <Tabs.List>
                  <Tabs.Tab value="a">A</Tabs.Tab>
                  <Tabs.Tab value="b">B</Tabs.Tab>
                </Tabs.List>
              </Tabs.Root>
            </Sample>
          ))}
          <Sample>
            <ToggleGroup defaultValue={["a"]}>
              <Toggle value="a">A</Toggle>
              <Toggle value="b">B</Toggle>
            </ToggleGroup>
          </Sample>
          <Sample>
            <Row>
              <Row.Primary>File</Row.Primary>
              <Row.Actions>
                <Button iconOnly icon="more" aria-label="File options" />
              </Row.Actions>
            </Row>
          </Sample>
          <Sample>
            <Collapsible.Root>
              <Collapsible.Trigger>Details</Collapsible.Trigger>
            </Collapsible.Root>
          </Sample>
          <Sample>
            <Dialog.Root>
              <Dialog.Trigger render={<Button>Open Dialog</Button>} />
            </Dialog.Root>
            <AlertDialog.Root>
              <AlertDialog.Trigger render={<Button>Delete File</Button>} />
            </AlertDialog.Root>
            <Popover.Root>
              <Popover.Trigger render={<Button>Options</Button>} />
            </Popover.Root>
            <Tooltip>
              <TooltipTrigger render={<Button iconOnly icon="copy" aria-label="Copy" />} />
            </Tooltip>
            <PreviewCard>
              <PreviewCardTrigger render={<ButtonLink href="#">Preview</ButtonLink>} />
            </PreviewCard>
          </Sample>
          <Sample>
            <Autocomplete items={["Alpha", "Beta"]} defaultValue="Alpha">
              <AutocompleteInputGroup>
                <AutocompleteInput aria-label="Search" />
                <AutocompleteTrigger aria-label="Show suggestions" />
                <AutocompleteClear aria-label="Clear search" />
              </AutocompleteInputGroup>
            </Autocomplete>
          </Sample>
        </TooltipProvider>,
      ),
    );
    const count = measure(host);

    if (count < 200) throw new Error(`Control matrix is incomplete: ${count}`);

    for (const group of host.querySelectorAll("[data-no-overlap]")) {
      const controls = [...group.querySelectorAll("button, a")];
      const boxes = controls.map(hitArea);

      for (let index = 0; index < boxes.length; index += 1) {
        for (const next of boxes.slice(index + 1)) {
          const box = boxes[index];

          if (
            Math.min(box.right, next.right) - Math.max(box.left, next.left) > 0.25 &&
            Math.min(box.bottom, next.bottom) - Math.max(box.top, next.top) > 0.25
          )
            failures.push("ButtonGroup/Toolbar hit areas overlap");
        }
      }
    }

    flushSync(() =>
      root.render(
        <Menu open>
          <MenuTrigger render={<Button>Options</Button>} />
          <MenuContent>
            <MenuItem>Rename File</MenuItem>
            <MenuLinkItem href="#">View File</MenuLinkItem>
            <MenuCheckboxItem checked onCheckedChange={() => {}}>
              Show Files
            </MenuCheckboxItem>
            <MenuRadioGroup value="a">
              <MenuRadioItem value="a">Local</MenuRadioItem>
            </MenuRadioGroup>
            <MenuSwitchItem checked onCheckedChange={() => {}}>
              Enable
            </MenuSwitchItem>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>More</MenuSubTrigger>
              <MenuSubContent>
                <MenuItem>Copy File</MenuItem>
              </MenuSubContent>
            </MenuSub>
          </MenuContent>
        </Menu>,
      ),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const popup = document.querySelector('[role="menu"]');

    if (popup === null) throw new Error("Missing menu popup");
    measure(popup);
    await paint(
      <ContextMenu open>
        <ContextMenuTrigger render={<div>File</div>} />
        <ContextMenuContent aria-label="File options">
          <ContextMenuItem>Rename File</ContextMenuItem>
          <ContextMenuLinkItem href="#">View File</ContextMenuLinkItem>
        </ContextMenuContent>
      </ContextMenu>,
      '[role="menu"]',
    );
    await paint(
      <Command.Root open onOpenChange={() => {}}>
        <Command.Popup items={["open"]}>
          <Command.Input aria-label="Search commands" />
          <Command.List>
            <Command.Item value="open">Open File</Command.Item>
          </Command.List>
        </Command.Popup>
      </Command.Root>,
      '[role="dialog"]',
    );
    await paint(
      <Autocomplete open items={["Alpha", "Beta"]}>
        <AutocompleteInput aria-label="Find" />
        <AutocompleteContent>
          <AutocompleteList>
            {(item: string) => <AutocompleteItem value={item}>{item}</AutocompleteItem>}
          </AutocompleteList>
        </AutocompleteContent>
      </Autocomplete>,
      '[role="listbox"]',
    );
    await paint(
      <Dialog.Root open>
        <Dialog.Popup>
          <Dialog.Title>Settings</Dialog.Title>
          <Dialog.Description>Preferences</Dialog.Description>
          <Dialog.Close render={<Button>Close</Button>} />
        </Dialog.Popup>
      </Dialog.Root>,
      '[role="dialog"]',
    );
    await paint(
      <ConfirmDialog
        open
        title="Delete File"
        description="This cannot be undone."
        confirmLabel="Delete File"
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
      '[role="alertdialog"]',
    );
    flushSync(() =>
      root.render(
        <Select
          items={[
            { value: "local", label: "Local" },
            { value: "cloud", label: "Cloud" },
          ]}
          value="local"
        >
          <SelectTrigger aria-label="Environment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local" label="Local">
              Local
            </SelectItem>
            <SelectItem value="cloud" label="Cloud">
              Cloud
            </SelectItem>
          </SelectContent>
        </Select>,
      ),
    );
    host.querySelector("button")?.click();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const options = document.querySelector('[role="listbox"]');

    if (options === null) throw new Error("Missing Select options");
    measure(options);
    flushSync(() => root.render(<Toaster />));
    toast.add({
      title: "File saved",
      timeout: 0,
      actionProps: { children: "Undo", onClick: () => {} },
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const notification = document.querySelector('[data-slot="toast"]');

    if (notification === null) throw new Error("Missing notification controls");
    measure(notification);
    toast.close();

    if (failures.length) throw new Error(`${coarse ? "coarse" : "fine"}:\n${failures.join("\n")}`);

    return "passed";
  } finally {
    root.unmount();
    host.remove();
  }
}
