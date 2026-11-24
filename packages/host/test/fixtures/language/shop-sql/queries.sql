SELECT   o.id,c.email,SUM(oi.quantity*oi.unit_price) AS order_total FROM orders o JOIN customers c ON c.id=o.customer_id JOIN order_items oi ON oi.order_id=o.id WHERE o.status='paid' GROUP BY o.id,c.email ORDER BY order_total DESC;

SELECT p.sku, p.title, p.unit_price
FROM products p
WHERE p.unit_price > 10
ORDER BY p.title ASC;
