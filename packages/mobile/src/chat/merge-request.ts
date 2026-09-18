import { Alert } from "react-native";

// Nyte has no PR or merge operation; merge means asking the agent to run git.
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
