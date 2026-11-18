package shop

// Receipt prints an order.
func Receipt(order *Order) string {
	ledger := &Ledger{}
	ledger.Audit.Record("receipt")
	return "receipt"
}
