-- TerraGo admin tools: live server settings and review state for security flags.
CREATE TABLE server_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE security_events
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN review_note text;

CREATE INDEX security_events_open_idx ON security_events (created_at DESC) WHERE reviewed_at IS NULL;
CREATE INDEX currency_transactions_created_idx ON currency_transactions (created_at DESC);
CREATE INDEX item_transactions_created_idx ON item_transactions (created_at DESC);
CREATE INDEX marketplace_transactions_created_idx ON marketplace_transactions (created_at DESC);
