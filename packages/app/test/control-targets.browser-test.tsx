import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactNode } from "react";
import {
  AlertDialog,
  Autocomplete,
  Button,
  ButtonGroup,
  ButtonLink,
  Checkbox,
  CheckboxField,
  Collapsible,
  CommandMenu,
  ConfirmDialog,
  ContextMenu,
  ContextMenuItem,
  ContextMenuLinkItem,
  Dialog,
  Input,
  InputGroup,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  MenuSwitchItem,
  NumberField,
  Popover,
  PreviewCard,
  PreviewCardTrigger,
  Row,
  Select,
  Slider,
  SplitButton,
  Switch,
  SwitchField,
  Tabs,
  Textarea,
  Toggle,
  ToggleGroup,
  Toolbar,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  Toaster,
  toast,
} from "@nyte-ai/ui";
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
          {(["ghost", "outline", "solid", "plain", "text"] as const).flatMap((variant) =>
            (["2xs", "xs", "sm", "md", "lg", "xl"] as const).map((size) => (
              <Sample key={`${variant}:${size}`}>
                <Button variant={variant} size={size}>
                  Save
                </Button>
                <Button variant={variant} size={size} iconOnly icon="plus" aria-label="Add" />
                <Button variant={variant} size={size} round iconOnly icon="plus" aria-label="Add" />
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
            <Select
              label="Environment"
              value="local"
              options={[{ value: "local", label: "Local" }]}
              onValueChange={() => {}}
            />
            <NumberField label="Count" defaultValue={2} />
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
            <Autocomplete.Root items={["Alpha", "Beta"]} defaultValue="Alpha">
              <Autocomplete.InputGroup>
                <Autocomplete.Input aria-label="Search" />
                <Autocomplete.Trigger aria-label="Show suggestions" />
                <Autocomplete.Clear aria-label="Clear search" />
              </Autocomplete.InputGroup>
            </Autocomplete.Root>
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
        <Menu open label="Options" trigger={<Button>Options</Button>}>
          <MenuItem onSelect={() => {}}>Rename File</MenuItem>
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
          <MenuSubmenu label="More">
            <MenuItem onSelect={() => {}}>Copy File</MenuItem>
          </MenuSubmenu>
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
      <ContextMenu open label="File options" trigger={<div>File</div>}>
        <ContextMenuItem onSelect={() => {}}>Rename File</ContextMenuItem>
        <ContextMenuLinkItem href="#">View File</ContextMenuLinkItem>
      </ContextMenu>,
      '[role="menu"]',
    );
    await paint(
      <CommandMenu
        open
        label="Commands"
        onOpenChange={() => {}}
        trigger={<Button>Commands</Button>}
      >
        <MenuItem onSelect={() => {}}>Open File</MenuItem>
      </CommandMenu>,
      '[role="menu"]',
    );
    await paint(
      <Autocomplete.Root open items={["Alpha", "Beta"]}>
        <Autocomplete.Input aria-label="Find" />
        <Autocomplete.Portal>
          <Autocomplete.Positioner>
            <Autocomplete.Popup>
              <Autocomplete.List>
                {(item: string) => <Autocomplete.Item value={item}>{item}</Autocomplete.Item>}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>,
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
          label="Environment"
          value="local"
          options={[
            { value: "local", label: "Local" },
            { value: "cloud", label: "Cloud" },
          ]}
          onValueChange={() => {}}
        />,
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
    toast("File saved", {
      duration: Infinity,
      action: { label: "Undo", onClick: () => {} },
      cancel: { label: "Keep", onClick: () => {} },
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const notification = document.querySelector("[data-sonner-toast]");
    if (notification === null) throw new Error("Missing notification controls");
    measure(notification);
    toast.dismiss();
    if (failures.length) throw new Error(`${coarse ? "coarse" : "fine"}:\n${failures.join("\n")}`);
    return "passed";
  } finally {
    root.unmount();
    host.remove();
  }
}
