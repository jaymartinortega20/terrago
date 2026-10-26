-- Gems: premium currency per account. Bought with real money (PayMongo), spent on
-- cosmetics, earned by selling items to other players. Never cashed out.
CREATE TABLE gem_wallets (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  balance    bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gem_transactions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  character_id  uuid REFERENCES characters (id) ON DELETE SET NULL,
  amount        bigint NOT NULL CHECK (amount <> 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  reason        text NOT NULL CHECK (reason IN ('purchase', 'cosmetic', 'market_sale', 'market_purchase', 'admin', 'refund')),
  ref           text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gem_transactions_user ON gem_transactions (user_id, created_at DESC);

-- One row per checkout. Credited exactly once: pending -> paid.
CREATE TABLE gem_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pack_id          text NOT NULL,
  gems             integer NOT NULL CHECK (gems > 0),
  amount_centavos  integer NOT NULL CHECK (amount_centavos > 0),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  provider         text NOT NULL CHECK (provider IN ('paymongo', 'fake')),
  provider_ref     text UNIQUE,
  livemode         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz
);
CREATE INDEX gem_orders_user ON gem_orders (user_id, created_at DESC);

-- Premium cosmetics belong to the account (every character can wear them).
CREATE TABLE account_cosmetics (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  cosmetic_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cosmetic_id)
);

-- Marketplace listings can be priced in Gold or Gems.
ALTER TABLE marketplace_listings ADD COLUMN currency text NOT NULL DEFAULT 'gold' CHECK (currency IN ('gold', 'gems'));
ALTER TABLE marketplace_transactions ADD COLUMN currency text NOT NULL DEFAULT 'gold' CHECK (currency IN ('gold', 'gems'));
