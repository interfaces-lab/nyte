"use client";

import { Button } from "@nyte-ai/ui/button";
import { Toaster, toast } from "@nyte-ai/ui/toast";

export function ToastDemo() {
  return (
    <>
      <Button variant="outline" onClick={() => toast.add({ title: "Workspace saved" })}>
        Default
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.add({
            type: "success",
            title: "3 chats archived",
            id: "archive-demo",
            actionProps: {
              children: "Undo",
              onClick: () => {
                toast.close("archive-demo");
                toast.add({ title: "Chats restored" });
              },
            },
          })
        }
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.add({
            type: "error",
            title: "Could not reach the server",
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
