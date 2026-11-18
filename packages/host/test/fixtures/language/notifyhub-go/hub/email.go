package hub

import (
	"context"
	"fmt"
	"strings"
)

// Email delivers to one mailbox.
type Email struct {
	address string
	sent    []string
}

// NewEmail returns an email channel for the address.
func NewEmail(address string) *Email {
	return &Email{address: address}
}

func (e *Email) Name() string { return "email" }

func (e *Email) Send(ctx context.Context, message Message) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !strings.Contains(e.address, "@") {
		return fmt.Errorf("email: %q is not an address", e.address)
	}
	e.sent = append(e.sent, message.Subject)
	return nil
}
