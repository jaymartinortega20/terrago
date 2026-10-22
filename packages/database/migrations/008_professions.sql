-- Profession specializations (chosen at skill level 40; at most two per character).
CREATE TABLE character_specializations (
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  skill        text NOT NULL,
  spec         text NOT NULL,
  chosen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, skill)
);
