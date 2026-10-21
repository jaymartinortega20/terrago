-- TerraGo v0.4: player marketplace (escrowed listings) and direct trades.
CREATE TABLE marketplace_listings (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   uuid NOT NULL REFERENCES characters (id),
  item_id     text NOT NULL REFERENCES items (id),
  quantity    integer NOT NULL CHECK (quantity > 0),
  quality     smallint NOT NULL DEFAULT 0,
  durability  integer,
  enhance     smallint NOT NULL DEFAULT 0,
  unit_price  bigint NOT NULL CHECK (unit_price > 0 AND unit_price <= 100000000),
  category    text NOT NULL,
  rarity      text NOT NULL,
  item_name   text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled', 'returned')),
  buyer_id    uuid REFERENCES characters (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  closed_at   timestamptz
);
CREATE INDEX market_active_idx ON marketplace_listings (status, category, unit_price) WHERE status = 'active';
CREATE INDEX market_seller_idx ON marketplace_listings (seller_id, status);
CREATE INDEX market_name_idx ON marketplace_listings (lower(item_name)) WHERE status = 'active';

CREATE TABLE marketplace_transactions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id  bigint NOT NULL REFERENCES marketplace_listings (id),
  seller_id   uuid NOT NULL REFERENCES characters (id),
  buyer_id    uuid NOT NULL REFERENCES characters (id),
  item_id     text NOT NULL,
  quantity    integer NOT NULL,
  total       bigint NOT NULL,
  tax         bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE direct_trade_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  a_id        uuid NOT NULL REFERENCES characters (id),
  b_id        uuid NOT NULL REFERENCES characters (id),
  a_gold      bigint NOT NULL DEFAULT 0,
  b_gold      bigint NOT NULL DEFAULT 0,
  a_items     jsonb NOT NULL DEFAULT '[]',
  b_items     jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);
