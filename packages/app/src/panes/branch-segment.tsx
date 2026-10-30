import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import type { GitOutcome, WorkspaceId } from "@nyte-ai/sdk";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteSeparator,
  AutocompleteStatus,
} from "@nyte-ai/ui/autocomplete";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { Popover } from "@nyte-ai/ui/popover";
import { menu, space } from "@nyte-ai/ui/styles/schema.stylex";
import { toast } from "@nyte-ai/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { useCopyConfirmation } from "../components/copy-confirmation.ts";
import { errorMessage } from "../contract/errors.ts";
import { gitFor, refreshVcs, useGitRefs } from "../data/vcs.ts";
import { gitStatusWatch } from "../data/watches.ts";
import { useWatch } from "../data/watch-store.ts";
import { ContextHint, ContextTrigger, type ContextSize } from "./context-selector.tsx";
import { contextStyles } from "./context-selector.stylex.ts";

type BranchRow = { readonly kind: "branch"; readonly name: string } | { readonly kind: "create" };

const CREATE: BranchRow = { kind: "create" };

const styles = create({
  popup: {
    display: "flex",
    flexDirection: "column",
    width: `min(${menu.modelWidth}, var(--available-width))`,
    maxHeight: `min(${menu.maxHeight}, var(--available-height))`,
    padding: menu.padding,
    overflowY: "clip",
  },
  create: { display: "flex", flexDirection: "column", gap: space.s2, padding: space.s1 },
  createLabel: { display: "inline-flex", alignItems: "center", gap: space.s2 },
});

export function BranchSegment({
  workspace,
  switchable,
  size,
}: {
  readonly workspace: WorkspaceId;
  readonly switchable: boolean;
  readonly size: ContextSize;
}): ReactElement | null {
  const status = useWatch(gitStatusWatch(workspace)).value;

  if (status?.kind !== "repository") return null;

  const label =
    status.branch ?? (status.head === null ? undefined : `Detached ${status.head.slice(0, 7)}`);

  if (label === undefined) return null;

  return switchable ? (
    <BranchMenu workspace={workspace} label={label} current={status.branch} size={size} />
  ) : (
    <BranchCopy label={label} size={size} />
  );
}

function BranchCopy({
  label,
  size,
}: {
  readonly label: string;
  readonly size: ContextSize;
}): ReactElement {
  const confirmation = useCopyConfirmation();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextTrigger
            size={size}
            icon="git-branch"
            value={label}
            chevron={false}
            onClick={() => confirmation.copy(label)}
          />
        }
      />
      <TooltipContent side="top" xstyle={contextStyles.hint}>
        <ContextHint label={confirmation.copied ? "Copied" : "Copy Branch Name"} value={label} />
      </TooltipContent>
    </Tooltip>
  );
}

function BranchMenu({
  workspace,
  label,
  current,
  size,
}: {
  readonly workspace: WorkspaceId;
  readonly label: string;
  readonly current: string | null;
  readonly size: ContextSize;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [naming, setNaming] = useState<string>();
  const refs = useGitRefs(workspace, open);

  const checkout = useMutation({
    mutationFn: async (name: string) => (await gitFor(workspace)).checkout({ name }),
    onSuccess: (outcome, name) => {
      if (outcome.kind === "applied") {
        void refreshVcs();

        return;
      }

      refused(`Couldn’t switch to ${name}`, outcome);
    },
    onError: (cause, name) => failed(`Couldn’t switch to ${name}`, cause),
  });

  const branch = useMutation({
    mutationFn: async (name: string) => (await gitFor(workspace)).branch({ name, checkout: true }),
    onSuccess: (outcome, name) => {
      if (outcome.kind === "applied") {
        setOpen(false);

        return;
      }

      refused(`Couldn’t create ${name}`, outcome);
    },
    onError: (cause, name) => failed(`Couldn’t create ${name}`, cause),
  });

  const query = search.trim().toLowerCase();

  const branches = (refs.data?.branches ?? [])
    .filter((candidate) => candidate.name.toLowerCase().includes(query))
    .map((candidate): BranchRow => ({ kind: "branch", name: candidate.name }));

  const status = refs.isPending
    ? "Loading branches…"
    : refs.isError
      ? errorMessage(refs.error)
      : branches.length === 0
        ? "No branches found"
        : null;

  return (
    <Popover.Root
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (nextOpen) return;
        setSearch("");
        setNaming(undefined);
      }}
    >
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={
            <Popover.Trigger
              render={
                <ContextTrigger
                  size={size}
                  icon="git-branch"
                  value={label}
                  loading={checkout.isPending}
                />
              }
            />
          }
        />
        <TooltipContent side="top" xstyle={contextStyles.hint}>
          <ContextHint label="Switch Branch" value={label} />
        </TooltipContent>
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={4}>
          <Popover.Popup aria-label="Branches" xstyle={styles.popup}>
            {naming === undefined ? (
              <Autocomplete
                inline
                open
                autoHighlight
                items={[...branches, CREATE]}
                filter={null}
                value={current === null ? null : { kind: "branch", name: current }}
                inputValue={search}
                itemToStringLabel={(row) => (row.kind === "branch" ? row.name : "Create Branch…")}
                isItemEqualToValue={(row, value) =>
                  row.kind === "branch" && value.kind === "branch" && row.name === value.name
                }
                onInputValueChange={(next, { reason }) => {
                  if (reason !== "item-press") setSearch(next);
                }}
                onValueChange={(row) => {
                  if (row === null) return;

                  if (row.kind === "create") {
                    setNaming(search.trim());

                    return;
                  }

                  setOpen(false);

                  if (row.name !== current) checkout.mutate(row.name);
                }}
              >
                <AutocompleteInput
                  variant="inline"
                  aria-label="Search branches"
                  placeholder="Search branches"
                />
                <AutocompleteSeparator />
                <AutocompleteStatus>{status}</AutocompleteStatus>
                <AutocompleteList variant="inline" data-nyte-scrollport>
                  {(row: BranchRow) =>
                    row.kind === "branch" ? (
                      <AutocompleteItem variant="inline" key={row.name} value={row}>
                        {row.name}
                      </AutocompleteItem>
                    ) : (
                      <AutocompleteItem variant="inline" key="create" value={row}>
                        <span {...props(contextStyles.text, styles.createLabel)}>
                          <Icon name="plus" size="sm" />
                          Create Branch…
                        </span>
                      </AutocompleteItem>
                    )
                  }
                </AutocompleteList>
              </Autocomplete>
            ) : (
              <form
                {...props(styles.create)}
                onSubmit={(event) => {
                  event.preventDefault();
                  branch.mutate(naming.trim());
                }}
              >
                <Input
                  autoFocus
                  type="text"
                  aria-label="New branch name"
                  placeholder="Branch name"
                  autoComplete="off"
                  spellCheck={false}
                  value={naming}
                  readOnly={branch.isPending}
                  onValueChange={setNaming}
                />
                <Button type="submit" variant="solid" loading={branch.isPending}>
                  Create Branch
                </Button>
              </form>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function refused(title: string, outcome: Exclude<GitOutcome, { readonly kind: "applied" }>): void {
  toast.add({ type: "error", title, description: refusalReason(outcome) });
}

function failed(title: string, cause: unknown): void {
  toast.add({ type: "error", title, description: errorMessage(cause) });
}

function refusalReason(outcome: Exclude<GitOutcome, { readonly kind: "applied" }>): string {
  switch (outcome.kind) {
    case "rejected":
      return outcome.reason;
    case "busy":
      if (outcome.runs.length === 0)
        return "Another git command is using this repository. Try again when it finishes.";

      return outcome.runs.length === 1
        ? "An agent is working in this workspace. Stop it or let it finish, then try again."
        : "Agents are working in this workspace. Stop them or let them finish, then try again.";
    case "stale":
      return "The repository changed. Try again.";
    case "unchanged":
      return "Nothing changed.";
  }
}
