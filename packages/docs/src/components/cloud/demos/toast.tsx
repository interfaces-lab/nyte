"use client";

import { Button } from "@nyte-ai/ui";
import { Toaster, toast } from "@nyte-ai/ui/toast";

export function ToastDemo() {
  return (
    <>
      <Button variant="secondary" onClick={() => toast("Workspace saved")}>
        Default
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.success("3 chats archived", {
            action: { label: "Undo", onClick: () => toast("Chats restored") },
          })
        }
      >
        Success
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.error("Could not reach the server", {
            description: "The request timed out after 30 seconds.",
          })
        }
      >
        Error
      </Button>
      <Toaster />
    </>
  );
}
