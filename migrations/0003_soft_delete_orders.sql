ALTER TABLE orders ADD COLUMN deleted_at TEXT;
ALTER TABLE orders ADD COLUMN deleted_by TEXT;
ALTER TABLE orders ADD COLUMN delete_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at);
CREATE INDEX IF NOT EXISTS idx_orders_deleted_by ON orders(deleted_by);
