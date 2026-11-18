// Package hub routes messages to the channels registered for them and counts the outcomes.
package hub

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

// Message is one notification on its way to a channel.
type Message struct {
	Channel string
	Subject string
	Body    string
}

// Channel delivers messages somewhere: a mailbox, a webhook, a pager.
type Channel interface {
	// Name is the key messages use to pick this channel.
	Name() string
	Send(ctx context.Context, message Message) error
}

// ErrUnknownChannel is returned for a message whose channel was never registered.
var ErrUnknownChannel = errors.New("unknown channel")

// Hub owns the registered channels and the running counts.
type Hub struct {
	mu       sync.Mutex
	channels map[string]Channel
	stats    Stats
}

// New returns an empty hub.
func New() *Hub {
	return &Hub{channels: map[string]Channel{}, stats: newStats()}
}

// Register adds a channel, replacing any channel with the same name.
func (h *Hub) Register(channel Channel) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.channels[channel.Name()] = channel
	h.stats.track(channel.Name())
}

// Submit sends a message through its channel and records how it went.
func (h *Hub) Submit(ctx context.Context, message Message) error {
	h.mu.Lock()
	channel, ok := h.channels[message.Channel]
	h.mu.Unlock()
	if !ok {
		h.record("", false)
		return fmt.Errorf("%w: %q", ErrUnknownChannel, message.Channel)
	}

	err := channel.Send(ctx, message)
	h.record(channel.Name(), err == nil)
	return err
}

// Stats returns a copy of the counts so far.
func (h *Hub) Stats() Stats {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.stats.clone()
}

func (h *Hub) record(name string, delivered bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.stats.add(name, delivered)
}

// describe is unused on purpose: the fixture needs a warning for the editor to show.
func describe(channel Channel, verbose bool) string {
	var fallback *Email
	if channel == nil {
		return fallback.address
	}
	return channel.Name()
}
