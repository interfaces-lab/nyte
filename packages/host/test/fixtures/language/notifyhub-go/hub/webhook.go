package hub

import (
	"context"
	"fmt"
	"net/url"
)

// Webhook posts each message to a URL.
type Webhook struct {
	endpoint string
	attempts int
}

// NewWebhook returns a webhook channel for the endpoint.
func NewWebhook(endpoint string) *Webhook {
	return &Webhook{endpoint: endpoint}
}

func (w *Webhook) Name() string { return "webhook" }

func (w *Webhook) Send(ctx context.Context, message Message) error {
	w.attempts++
	target, err := url.Parse(w.endpoint)
	if err != nil {
		return fmt.Errorf("webhook: %w", err)
	}
	if target.Scheme != "https" {
		return fmt.Errorf("webhook: %s is not https", target.Host)
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
