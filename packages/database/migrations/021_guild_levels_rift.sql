-- Guild levels (guild XP from guild quests and treasury investment) and Endless Rift records.
ALTER TABLE guilds ADD COLUMN xp bigint NOT NULL DEFAULT 0 CHECK (xp >= 0);

CREATE TABLE rift_runs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  floor        integer NOT NULL CHECK (floor >= 1),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rift_runs_best ON rift_runs (character_id, floor DESC);
