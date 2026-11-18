// Package shop holds the fixture for Go to Declaration.
package shop

import (
	"fmt"
	"sync"

	"example.com/money"
)

// Item is something for sale.
type Item struct {
	Name  string
	Price money.Cents
}

// Notifier reports what happened to an order.
type Notifier interface {
	Notify(order *Order) error
}

// Ledger counts orders and embeds a mutex.
type Ledger struct {
	sync.Mutex
	Audit
	count int
}

// Audit is embedded in Ledger.
type Audit struct {
	Trail []string
}

// Record appends to the trail.
func (a *Audit) Record(entry string) {
	a.Trail = append(a.Trail, entry)
}

// Order is one purchase.
type Order struct {
	Items  []Item
	ledger *Ledger
}

// Total sums the order.
func (o *Order) Total() money.Cents {
	var sum money.Cents
	for _, item := range o.Items {
		sum += item.Price
	}
	return sum
}

// Place records the order and tells the notifier.
func Place(order *Order, notifier Notifier) error {
	order.ledger.Lock()
	defer order.ledger.Unlock()
	order.ledger.count++
	order.ledger.Record(fmt.Sprintf("order of %d items", len(order.Items)))
	label := "😀 total " + money.Format(order.Total())
	_ = label
	return notifier.Notify(order)
}

// Pair holds two values of one type.
type Pair[T any] struct {
	First, Second T
}

// Swap returns the pair reversed.
func Swap[T any](pair Pair[T]) Pair[T] {
	return Pair[T]{First: pair.Second, Second: pair.First}
}
