-- TerraGo v0.2: homesteads, farm plots, profession skills, wider ledger reasons.

-- Profession progress (farming, mining, fishing, ...). Rows are created lazily.
CREATE TABLE character_skills (
  character_id uuid NOT NULL REFERENCES characters (id),
  skill        text NOT NULL CHECK (skill IN ('farming', 'mining', 'woodcutting', 'fishing', 'gathering',
                                              'cooking', 'smithing', 'alchemy', 'crafting', 'trading')),
  level        integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  xp           bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, skill)
);

-- One homestead per character. Tier decides how many plots are unlocked.
CREATE TABLE farms (
  character_id uuid PRIMARY KEY REFERENCES characters (id),
  tier         smallint NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 10),
  created_at   timestamptz NOT NULL DEFAULT now(),
  upgraded_at  timestamptz
);

-- Crop growth is stored as timestamps; no timers run on the server.
--   growth_done_ms: watered growth accumulated up to progress_at
--   water_until:    soil stays wet (and the crop grows) until this time
CREATE TABLE farm_plots (
  character_id   uuid NOT NULL REFERENCES farms (character_id),
  plot_index     smallint NOT NULL CHECK (plot_index >= 0),
  tilled         boolean NOT NULL DEFAULT false,
  crop_id        text,
  planted_at     timestamptz,
  growth_done_ms bigint NOT NULL DEFAULT 0 CHECK (growth_done_ms >= 0),
  progress_at    timestamptz NOT NULL DEFAULT now(),
  water_until    timestamptz NOT NULL DEFAULT 'epoch',
  speed          real NOT NULL DEFAULT 1 CHECK (speed >= 1 AND speed <= 3),
  fertilizer     text REFERENCES items (id),
  harvests       smallint NOT NULL DEFAULT 0 CHECK (harvests >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, plot_index),
  CONSTRAINT crop_needs_tilled_soil CHECK (crop_id IS NULL OR tilled)
);

-- Ledger reasons for the systems arriving in v0.2+ (farm upgrades, crafting, markets...).
ALTER TABLE currency_transactions DROP CONSTRAINT currency_transactions_reason_check;
ALTER TABLE currency_transactions ADD CONSTRAINT currency_transactions_reason_check CHECK (reason IN (
  'character_creation', 'quest', 'npc_sale', 'npc_purchase', 'marketplace_sale', 'marketplace_purchase',
  'marketplace_fee', 'marketplace_tax', 'trade', 'repair', 'teleport', 'craft', 'admin',
  'farm_upgrade', 'loot', 'enhance', 'guild', 'storage', 'daily_reward', 'achievement',
  'specialization', 'skill_training', 'death'));

ALTER TABLE item_transactions DROP CONSTRAINT item_transactions_reason_check;
ALTER TABLE item_transactions ADD CONSTRAINT item_transactions_reason_check CHECK (reason IN (
  'starter_kit', 'npc_reward', 'consume', 'npc_sale', 'npc_purchase', 'trade', 'marketplace', 'craft',
  'harvest', 'gather', 'loot', 'admin', 'plant', 'fertilize', 'farm_upgrade', 'tool_broken', 'quest',
  'daily_reward', 'achievement', 'enhance', 'pickup', 'mail', 'discard', 'equip'));
