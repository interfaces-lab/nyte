// Package money is a vendored dependency.
package money

// Cents is an amount in the smallest unit.
type Cents int64

// Format renders an amount as dollars.
func Format(amount Cents) string {
	return "$" + string(rune('0'+amount%10))
}
