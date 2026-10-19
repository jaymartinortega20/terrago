-- TerraGo v0.1 schema: accounts, sessions, characters, inventory, ledgers, chat, security.
-- Later versions add their own migrations (farms in v0.2, marketplace in v0.4, ...).

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL CHECK (char_length(email) <= 254),
  password_hash     text,
  auth_provider     text NOT NULL DEFAULT 'password' CHECK (auth_provider IN ('password', 'google', 'discord')),
  provider_subject  text,
  email_verified_at timestamptz,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  banned_until      timestamptz,
  ban_reason        text,
  security_flags    jsonb NOT NULL DEFAULT '{}'::jsonb,
  roles             text[] NOT NULL DEFAULT ARRAY['player']::text[],
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_login_at     timestamptz,
  CONSTRAINT users_password_required CHECK (auth_provider <> 'password' OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE UNIQUE INDEX users_provider_key ON users (auth_provider, provider_subject) WHERE provider_subject IS NOT NULL;

-- Opaque session tokens. Only a SHA-256 hash of the token is stored.
CREATE TABLE player_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           inet,
  user_agent   text
);
CREATE INDEX player_sessions_user_idx ON player_sessions (user_id);

-- ---------------------------------------------------------------------------
-- Item definitions (synced from @terrago/game-data at server start, for FK integrity)
-- ---------------------------------------------------------------------------
CREATE TABLE items (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  category       text NOT NULL,
  rarity         text NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')),
  stack_size     integer NOT NULL CHECK (stack_size >= 1),
  tradable       boolean NOT NULL,
  bind           text NOT NULL CHECK (bind IN ('none', 'pickup', 'equip')),
  max_durability integer CHECK (max_durability > 0),
  vendor_value   integer NOT NULL CHECK (vendor_value >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Characters
-- ---------------------------------------------------------------------------
CREATE TABLE characters (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 16),
  class_id       text NOT NULL CHECK (class_id IN ('warrior', 'ranger', 'mage', 'priest', 'rogue')),
  level          integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  xp             bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
  gold           bigint NOT NULL DEFAULT 0 CHECK (gold >= 0),
  appearance     jsonb NOT NULL,
  map_id         text NOT NULL,
  pos_x          double precision NOT NULL,
  pos_y          double precision NOT NULL,
  direction      text NOT NULL DEFAULT 'down' CHECK (direction IN ('down', 'left', 'right', 'up')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_played_at timestamptz,
  deleted_at     timestamptz
);
-- Names stay reserved even after a character is deleted (prevents impersonation).
CREATE UNIQUE INDEX characters_name_key ON characters (lower(name));
CREATE INDEX characters_user_idx ON characters (user_id) WHERE deleted_at IS NULL;

CREATE TABLE character_stats (
  character_id      uuid PRIMARY KEY REFERENCES characters (id),
  strength          smallint NOT NULL CHECK (strength >= 0),
  agility           smallint NOT NULL CHECK (agility >= 0),
  intelligence      smallint NOT NULL CHECK (intelligence >= 0),
  vitality          smallint NOT NULL CHECK (vitality >= 0),
  luck              smallint NOT NULL CHECK (luck >= 0),
  stat_points       integer NOT NULL DEFAULT 0 CHECK (stat_points >= 0),
  hp                integer NOT NULL CHECK (hp >= 0),
  mp                integer NOT NULL CHECK (mp >= 0),
  energy            integer NOT NULL CHECK (energy >= 0),
  energy_updated_at timestamptz NOT NULL DEFAULT now()
);

-- One-off progress markers ("met:mayor_lina", "reward:welcome_gift"). The
-- primary key makes claiming a reward twice impossible, even under races.
CREATE TABLE character_flags (
  character_id uuid NOT NULL REFERENCES characters (id),
  flag         text NOT NULL CHECK (char_length(flag) <= 64),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, flag)
);

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
CREATE TABLE inventories (
  character_id uuid NOT NULL REFERENCES characters (id),
  container    text NOT NULL DEFAULT 'bag' CHECK (container IN ('bag', 'bank')),
  capacity     integer NOT NULL CHECK (capacity BETWEEN 1 AND 200),
  PRIMARY KEY (character_id, container)
);

CREATE TABLE inventory_items (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  character_id uuid NOT NULL,
  container    text NOT NULL DEFAULT 'bag',
  slot         smallint NOT NULL CHECK (slot >= 0),
  item_id      text NOT NULL REFERENCES items (id),
  quantity     integer NOT NULL CHECK (quantity > 0),
  quality      smallint NOT NULL DEFAULT 0 CHECK (quality BETWEEN 0 AND 4),
  durability   integer CHECK (durability >= 0),
  bound        boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (character_id, container) REFERENCES inventories (character_id, container),
  UNIQUE (character_id, container, slot)
);

-- ---------------------------------------------------------------------------
-- Ledgers: every Gold change and every significant item movement is recorded.
-- ---------------------------------------------------------------------------
CREATE TABLE currency_transactions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  character_id   uuid NOT NULL REFERENCES characters (id),
  currency       text NOT NULL DEFAULT 'gold' CHECK (currency IN ('gold')),
  amount         bigint NOT NULL CHECK (amount <> 0),
  balance_before bigint NOT NULL CHECK (balance_before >= 0),
  balance_after  bigint NOT NULL CHECK (balance_after >= 0),
  reason         text NOT NULL CHECK (reason IN (
                   'character_creation', 'quest', 'npc_sale', 'npc_purchase', 'marketplace_sale',
                   'marketplace_purchase', 'marketplace_fee', 'marketplace_tax', 'trade', 'repair',
                   'teleport', 'craft', 'admin')),
  ref_type       text,
  ref_id         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currency_balance_consistent CHECK (balance_after = balance_before + amount)
);
CREATE INDEX currency_transactions_character_idx ON currency_transactions (character_id, created_at DESC);
CREATE INDEX currency_transactions_reason_idx ON currency_transactions (reason, created_at DESC);

CREATE TABLE item_transactions (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id           text NOT NULL REFERENCES items (id),
  quantity          integer NOT NULL CHECK (quantity > 0),
  quality           smallint NOT NULL DEFAULT 0,
  from_character_id uuid REFERENCES characters (id),
  to_character_id   uuid REFERENCES characters (id),
  reason            text NOT NULL CHECK (reason IN (
                      'starter_kit', 'npc_reward', 'consume', 'npc_sale', 'npc_purchase', 'trade',
                      'marketplace', 'craft', 'harvest', 'gather', 'loot', 'admin')),
  ref_type          text,
  ref_id            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_tx_has_party CHECK (from_character_id IS NOT NULL OR to_character_id IS NOT NULL)
);
CREATE INDEX item_transactions_from_idx ON item_transactions (from_character_id, created_at DESC);
CREATE INDEX item_transactions_to_idx ON item_transactions (to_character_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Chat log (moderation and reports)
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel                text NOT NULL CHECK (channel IN ('local', 'global', 'party', 'guild', 'whisper')),
  map_id                 text,
  sender_character_id    uuid NOT NULL REFERENCES characters (id),
  recipient_character_id uuid REFERENCES characters (id),
  body                   text NOT NULL CHECK (char_length(body) <= 500),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_created_idx ON messages (created_at DESC);
CREATE INDEX messages_sender_idx ON messages (sender_character_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Security events (failed logins, rate-limit hits, suspicious movement...)
-- ---------------------------------------------------------------------------
CREATE TABLE security_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL,
  user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  character_id uuid REFERENCES characters (id) ON DELETE SET NULL,
  ip           inet,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_kind_idx ON security_events (kind, created_at DESC);
CREATE INDEX security_events_user_idx ON security_events (user_id, created_at DESC);
