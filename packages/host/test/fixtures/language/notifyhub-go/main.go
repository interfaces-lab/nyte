// Command notifyhub submits a few sample messages and prints what each channel did with them.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"example.com/notifyhub/hub"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	h := hub.New()
	h.Register(hub.NewEmail("ops@example.com"))
	h.Register(hub.NewWebhook("https://hooks.example.com/deploys"))

	messages := []hub.Message{
		{Channel: "email", Subject: "Deploy finished", Body: "v1.8.2 is live."},
		{Channel: "webhook", Subject: "Deploy finished", Body: "v1.8.2 is live."},
		{Channel: "pager", Subject: "Disk almost full", Body: "92% on db-1."},
	}
	for _, message := range messages {
		if err := h.Submit(ctx, message); err != nil {
			fmt.Fprintln(os.Stderr, "submit:", err)
		}
	}

	stats := h.Stats()
	fmt.Printf("%d submitted, %d delivered, %d failed\n", stats.Total.Submitted, stats.Total.Delivered, stats.Total.Failed)
	for _, name := range stats.Names() {
		counts := stats.Channels[name]
		fmt.Printf("  %-8s %d delivered, %d failed\n", name, counts.Delivered, counts.Failed)
	}
}
