import type { ComponentProps } from "react";
import { router, type Href } from "expo-router";
import { Stack } from "expo-router/stack";
import { Keyboard } from "react-native";

// Expo filters menu children by element type, so return its native item directly.
export function navigationMenuAction({
  href,
  ...properties
}: Omit<ComponentProps<typeof Stack.Toolbar.MenuAction>, "onPress"> & { href: Href }) {
  return (
    <Stack.Toolbar.MenuAction
      {...properties}
      onPress={() => {
        Keyboard.dismiss();
        router.push(href);
      }}
    />
  );
}
