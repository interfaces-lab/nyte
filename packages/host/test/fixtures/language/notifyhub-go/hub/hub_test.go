package hub

import (
	"context"
	"errors"
	"testing"
)

func TestSubmitCountsPerChannel(t *testing.T) {
	h := New()
	h.Register(NewEmail("ops@example.com"))
	h.Register(NewWebhook("http://insecure.example.com"))

	ctx := context.Background()
	if err := h.Submit(ctx, Message{Channel: "email", Subject: "one"}); err != nil {
		t.Fatalf("email: %v", err)
	}
	if err := h.Submit(ctx, Message{Channel: "webhook", Subject: "two"}); err == nil {
		t.Fatal("webhook: expected an error for a non-https endpoint")
	}
	if err := h.Submit(ctx, Message{Channel: "pager"}); !errors.Is(err, ErrUnknownChannel) {
		t.Fatalf("pager: got %v, want ErrUnknownChannel", err)
	}

	stats := h.Stats()
	if got, want := stats.Total, (Counts{Submitted: 3, Delivered: 1, Failed: 2}); got != want {
		t.Errorf("total = %+v, want %+v", got, want)
	}
	if got, want := stats.Channels["email"], (Counts{Submitted: 1, Delivered: 1}); got != want {
		t.Errorf("email = %+v, want %+v", got, want)
	}
	if got, want := stats.Channels["webhook"], (Counts{Submitted: 1, Failed: 1}); got != want {
		t.Errorf("webhook = %+v, want %+v", got, want)
	}
}
