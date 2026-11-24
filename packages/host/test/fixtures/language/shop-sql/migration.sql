ALTER TABLE customers DROP COLUMN legacy_code;

CREATE INDEX idx_orders_customer_id ON orders (customer_id);
