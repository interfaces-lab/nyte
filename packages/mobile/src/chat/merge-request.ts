import { Alert } from "react-native";

export const MERGE_PROMPT =
  "Squash these changes into one commit and merge the branch into its base. If this work isn't on a branch, ask me first. Report the result.";

export function confirmMergeRequest({
  onSend,
  onEdit,
}: {
  onSend: () => void;
  onEdit?: () => void;
}) {
  Alert.alert("Ask the agent to merge?", `It will send this message:\n\n“${MERGE_PROMPT}”`, [
    { text: "Cancel", style: "cancel" },
    ...(onEdit === undefined ? [] : [{ text: "Edit message", onPress: onEdit }]),
    { text: "Send", onPress: onSend },
  ]);
}
