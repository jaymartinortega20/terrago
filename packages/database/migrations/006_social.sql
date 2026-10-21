-- v0.6 social: friends, blocks/mutes, guilds, reports.

CREATE TABLE friendships (
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  friend_id    uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, friend_id),
  CHECK (character_id <> friend_id)
);
CREATE INDEX friendships_friend_idx ON friendships (friend_id);

-- 'mute' hides chat; 'block' also refuses whispers, trades, duels, invites.
CREATE TABLE character_blocks (
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('mute', 'block')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, target_id),
  CHECK (character_id <> target_id)
);

CREATE TABLE guilds (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  tag        text NOT NULL,
  leader_id  uuid NOT NULL REFERENCES characters (id),
  treasury   bigint NOT NULL DEFAULT 0 CHECK (treasury >= 0),
  motd       text NOT NULL DEFAULT '' CHECK (char_length(motd) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX guilds_name_uq ON guilds (lower(name));
CREATE UNIQUE INDEX guilds_tag_uq ON guilds (lower(tag));

CREATE TABLE guild_members (
  guild_id     bigint NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
  character_id uuid NOT NULL UNIQUE REFERENCES characters (id) ON DELETE CASCADE,
  rank         text NOT NULL CHECK (rank IN ('leader', 'officer', 'member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, character_id)
);

CREATE TABLE guild_treasury_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id     bigint NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters (id),
  amount       bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player_reports (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id uuid NOT NULL REFERENCES characters (id),
  target_id   uuid NOT NULL REFERENCES characters (id),
  reason      text NOT NULL CHECK (char_length(reason) <= 300),
  context     jsonb NOT NULL DEFAULT '[]',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_reports_open_idx ON player_reports (created_at) WHERE status = 'open';
