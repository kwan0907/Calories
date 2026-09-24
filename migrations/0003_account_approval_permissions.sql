ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN access_role TEXT NOT NULL DEFAULT 'viewer';
ALTER TABLE users ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN requested_at TEXT;
ALTER TABLE users ADD COLUMN reviewed_at TEXT;
ALTER TABLE users ADD COLUMN reviewed_by TEXT;

UPDATE users
SET account_status='active',
    access_role=CASE WHEN role='admin' THEN 'admin' ELSE 'investor' END,
    permissions_json=CASE
      WHEN role='admin' THEN '["*"]'
      ELSE '["dashboard","orders.read","products.read","expenses.read","investors.read","reports.read"]'
    END,
    requested_at=COALESCE(requested_at,created_at),
    reviewed_at=COALESCE(reviewed_at,created_at);

CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status);
CREATE INDEX IF NOT EXISTS idx_users_access_role ON users(access_role);
