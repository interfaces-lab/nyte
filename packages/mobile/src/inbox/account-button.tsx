import { useState } from "react";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { css, html } from "react-strict-dom";
import { useAccount } from "../account/account-provider.tsx";
import { AccountAvatar, ConnectSheet } from "../account/connect-panel.tsx";
import { useHost } from "../connection/host-context.tsx";
import { controls } from "../theme.ts";

export function AccountButton() {
  const account = useAccount();
  const { saved, edit } = useHost();
  const [open, setOpen] = useState(false);
  const profile = account?.status.kind === "signedIn" ? account.status : undefined;

  function showAccount() {
    if (account === undefined) {
      router.navigate("/settings");

      return;
    }

    setOpen(true);
  }

  return (
    <>
      <Stack.Toolbar placement="left">
        {profile?.avatarUrl === undefined ? (
          <Stack.Toolbar.Button
            icon="person"
            accessibilityLabel="Nyte account"
            onPress={showAccount}
          />
        ) : (
          <Stack.Toolbar.View>
            <html.button
              aria-label={`${profile.label}, account`}
              onClick={showAccount}
              style={styles.button}
            >
              <AccountAvatar key={profile.avatarUrl} url={profile.avatarUrl} />
            </html.button>
          </Stack.Toolbar.View>
        )}
      </Stack.Toolbar>
      {account === undefined ? null : (
        <ConnectSheet
          open={open}
          onClose={() => setOpen(false)}
          account={account}
          current={{ saved, reconnect: false }}
          onManual={() => {
            setOpen(false);
            edit();
          }}
        />
      )}
    </>
  );
}

const styles = css.create({
  button: {
    display: "flex",
    width: controls.touchTarget,
    height: controls.touchTarget,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    opacity: { default: 1, ":active": controls.pressedOpacity },
  },
});
