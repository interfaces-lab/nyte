import { props } from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../errors.ts";
import type { RemotePairing } from "../bridge.ts";
import { Input } from "@nyte-ai/ui/input";
import { nyte } from "../nyte.ts";
import { keys } from "../queries.ts";
import {
  SettingsDialog,
  SettingsDialogCard,
  SettingsField,
  SettingsFormDialog,
} from "../settings/dialog.tsx";
import { PairingCode, pairingPayload } from "./pairing-code.tsx";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { CopyButton, ValueRow, shareStyles } from "./remote-share.tsx";

export function useRevokeDevice() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (deviceId: string) => nyte.host.remote.revoke({ plugin: "cloudflare", deviceId }),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't remove the device: ${errorMessage(cause)}`,
        id: "cloudflare-device",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });
}

/** One device's pairing code, until it's claimed, removed, expires, or you close it. */
export function PairingDialog({
  pairing,
  name,
  onDone,
  onExpired,
}: {
  pairing: RemotePairing;
  name: string;
  onDone: () => void;
  onExpired: () => void;
}): ReactElement {
  const link = `${pairing.address}/pair#host=${encodeURIComponent(pairing.address)}&token=${encodeURIComponent(pairing.token)}`;

  useMountEffect(() => {
    const timer = setTimeout(onExpired, Math.max(0, pairing.expiresAt - Date.now()));

    return () => clearTimeout(timer);
  });

  return (
    <SettingsDialog
      open
      title={`Pair ${name}`}
      description={`In the Nyte iOS app, tap Scan QR code. Anyone with this code can connect as ${name} until you remove it. It expires at ${new Date(pairing.expiresAt).toLocaleTimeString()} if unused.`}
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
    >
      <div {...props(shareStyles.pair)}>
        <PairingCode
          value={pairingPayload({ address: pairing.address, token: pairing.token })}
          size={160}
        />
      </div>
      <SettingsDialogCard>
        <ValueRow title="Pairing link" value={`${pairing.address}/pair`}>
          <CopyButton label="Pairing link" value={link} />
        </ValueRow>
      </SettingsDialogCard>
    </SettingsDialog>
  );
}

/** Names a new device, then hands its pairing code back without caching it in a mutation. */
export function NameDeviceDialog({
  onOpenChange,
  onPaired,
}: {
  onOpenChange: (open: boolean) => void;
  onPaired: (pairing: RemotePairing, name: string) => void;
}): ReactElement {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const pair = async (): Promise<void> => {
    const chosen = name.trim();
    setPending(true);
    setFailure(undefined);

    const outcome = await nyte.host.remote.pair({ plugin: "cloudflare", name: chosen }).then(
      (pairing) => ({ kind: "paired" as const, pairing }),
      (cause: unknown) => ({ kind: "failed" as const, cause }),
    );

    setPending(false);
    void client.invalidateQueries({ queryKey: keys.remoteAccess });

    if (outcome.kind === "failed") {
      setFailure(`Couldn't add the device: ${errorMessage(outcome.cause)}`);

      return;
    }

    onPaired(outcome.pairing, chosen);
  };

  return (
    <SettingsFormDialog
      open
      title="Pair a Device"
      description="Each device gets its own code, so you can remove one without the others."
      submitLabel="Create Pairing Code"
      canSubmit={name.trim() !== ""}
      pending={pending}
      error={failure}
      onOpenChange={onOpenChange}
      onSubmit={() => void pair()}
    >
      <SettingsField label="Device name">
        <Input
          aria-label="Device name"
          autoComplete="off"
          spellCheck={false}
          placeholder="iPhone"
          maxLength={64}
          value={name}
          onValueChange={setName}
        />
      </SettingsField>
    </SettingsFormDialog>
  );
}
