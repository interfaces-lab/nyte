import { useColorScheme } from "react-native";
import { SvgXml } from "react-native-svg";
import { platformColors } from "@nyte-ai/ui/platform-colors";
import completionIcons from "../../build/completion-icons.json";
import { controls } from "../theme.ts";

type CompletionIconProps = (
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "command" | "skill" }
) & { readonly size?: number };

export function CompletionIcon(props: CompletionIconProps) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const kind = props.kind === "file" && props.path.endsWith("/") ? "folder" : props.kind;

  return (
    <SvgXml
      xml={completionIcons[kind]}
      color={platformColors[scheme].contentSecondary}
      width={props.size ?? controls.icon}
      height={props.size ?? controls.icon}
      accessible={false}
      pointerEvents="none"
    />
  );
}
