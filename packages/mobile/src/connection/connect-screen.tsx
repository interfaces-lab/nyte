import { useState } from "react";
import { Keyboard, Modal, View } from "react-native";
import { BottomSheet, RNHostView } from "@expo/ui";
import { useReducedMotion } from "react-native-reanimated";
import { useAccount } from "../account/account-provider.tsx";
import { DesignPreview } from "../development/design-preview.tsx";
import { useTheme } from "../theme.ts";
import { ConnectWelcome } from "./connect-welcome.tsx";
import { ConnectionForm, type ConnectionMethod } from "./connection-form.tsx";
import type { HostRecovery } from "./host-context.tsx";

export function ConnectScreen({
  notice,
  recovery,
}: {
  notice: string | undefined;
  recovery: HostRecovery | undefined;
}) {
  const account = useAccount();
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [method, setMethod] = useState<ConnectionMethod>();
  const [previewing, setPreviewing] = useState(false);
  const initial = recovery?.saved.kind === "manual" ? recovery.saved.connection : undefined;

  return (
    <>
      <Modal
        visible={previewing}
        animationType={reducedMotion ? "none" : "slide"}
        presentationStyle="pageSheet"
        onRequestClose={() => setPreviewing(false)}
      >
        <DesignPreview onClose={() => setPreviewing(false)} />
      </Modal>
      <ConnectWelcome
        account={account}
        notice={notice}
        recovery={recovery}
        onManual={setMethod}
        onPreview={() => {
          Keyboard.dismiss();
          setPreviewing(true);
        }}
      />
      <BottomSheet
        isPresented={method !== undefined}
        onDismiss={() => setMethod(undefined)}
        snapPoints={["full"]}
        contentPadding={0}
        containerColor={theme.background}
      >
        <RNHostView>
          <View style={{ flex: 1 }}>
            {method === undefined ? null : (
              <ConnectionForm
                mode={{ kind: "connect", method, initial }}
                onCancel={() => setMethod(undefined)}
                onSaved={() => setMethod(undefined)}
              />
            )}
          </View>
        </RNHostView>
      </BottomSheet>
    </>
  );
}
