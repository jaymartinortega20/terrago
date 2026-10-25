-- Weekly guild quests: shared goals, and who helped (each helper claims a reward once).
CREATE TABLE guild_quests (
  guild_id     bigint NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
  week         date NOT NULL,
  quest_id     text NOT NULL,
  goal         integer NOT NULL CHECK (goal > 0),
  progress     integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  PRIMARY KEY (guild_id, week, quest_id)
);

CREATE TABLE guild_quest_members (
  guild_id     bigint NOT NULL,
  week         date NOT NULL,
  quest_id     text NOT NULL,
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  amount       integer NOT NULL DEFAULT 0,
  claimed      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (guild_id, week, quest_id, character_id),
  FOREIGN KEY (guild_id, week, quest_id) REFERENCES guild_quests (guild_id, week, quest_id) ON DELETE CASCADE
);
