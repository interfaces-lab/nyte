/**
 * Adding a device to a Cloudflare tunnel: name it, then show its pairing code
 * once. Removing one acts at once.
 */
import { props } from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../errors.ts";
import type { RemotePairing } from "../bridge.ts";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { nyte } from "../nyte.ts";
import { keys } from "../queries.ts";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { PairingCode, pairingPayload } from "./pairing-code.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import { CopyButton, shareStyles } from "./remote-share.tsx";

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

/**
 * A new device's code. Its token is that device's lasting credential, held
 * only in the serving panel's state; Done, a claim, a removal, or expiry
 * drops it, and so does leaving the page. The host stops listing an unused
 * code once it expires but says nothing then, so the panel times it out.
 */
export function PairingPanel({
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
    <div {...props(shareStyles.panel)}>
      <div {...props(shareStyles.scan)}>
        <PairingCode
          value={pairingPayload({ address: pairing.address, token: pairing.token })}
          size={132}
        />
        <span {...props(shareStyles.scanText)}>
          <span {...props(text.sm, shareStyles.label)}>
            In the iOS app, tap Scan QR code on the connect screen.
          </span>
          <span {...props(text.sm, styles.deviceCodeNote)}>
            {`Anyone with this code can connect as ${name} until you remove it. It expires at ${new Date(pairing.expiresAt).toLocaleTimeString()} if unused.`}
          </span>
        </span>
      </div>
      <div {...props(shareStyles.fields)}>
        <span {...props(text.sm, shareStyles.label)}>Link</span>
        <code aria-label="Pairing link" {...props(text.sm, shareStyles.value)}>
          {pairing.address}/pair
        </code>
        <span {...props(shareStyles.fieldActions)}>
          <CopyButton label="Pairing link" value={link} />
        </span>
      </div>
      <Button onClick={onDone}>Done</Button>
    </div>
  );
}

export function AddDevice({
  onPaired,
}: {
  onPaired: (pairing: RemotePairing, name: string) => void;
}): ReactElement {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const add = async (): Promise<void> => {
    const chosen = name.trim();
    setPending(true);

    const outcome = await nyte.host.remote.pair({ plugin: "cloudflare", name: chosen }).then(
      (pairing) => ({ kind: "paired" as const, pairing }),
      (cause: unknown) => ({ kind: "failed" as const, cause }),
    );

    setPending(false);
    void client.invalidateQueries({ queryKey: keys.remoteAccess });

    if (outcome.kind === "failed") {
      toast.add({
        type: "error",
        title: `Couldn't add the device: ${errorMessage(outcome.cause)}`,
        id: "cloudflare-device",
      });

      return;
    }

    setName("");
    onPaired(outcome.pairing, chosen);
  };

  return (
    <form
      {...props(styles.keyRow)}
      onSubmit={(event) => {
        event.preventDefault();

        if (!pending && name.trim() !== "") void add();
      }}
    >
      <Input
        variant="code"
        aria-label="Device name"
        autoComplete="off"
        spellCheck={false}
        placeholder="iPhone"
        maxLength={64}
        value={name}
        disabled={pending}
        xstyle={styles.keyInput}
        onValueChange={setName}
      />
      <Button type="submit" loading={pending} disabled={name.trim() === ""}>
        Add Device
      </Button>
    </form>
  );
}
