// Command goto exercises Go to Declaration.
package main

import (
	"fmt"

	"example.com/goto/shop"
)

type printer struct{}

func (printer) Notify(order *shop.Order) error {
	fmt.Println(order.Total())
	return nil
}

func main() {
	order := &shop.Order{Items: []shop.Item{{Name: "tea", Price: 450}}}
	if err := shop.Place(order, printer{}); err != nil {
		fmt.Println(err)
	}
	fmt.Println(shop.Receipt(order), shop.Swap(shop.Pair[int]{First: 1, Second: 2}))
}
