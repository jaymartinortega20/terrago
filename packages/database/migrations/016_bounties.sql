-- Bounty board: three daily hunting contracts per character, accepted one by one.
CREATE TABLE bounties (
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  day          date NOT NULL,
  idx          smallint NOT NULL CHECK (idx BETWEEN 0 AND 2),
  monster_id   text NOT NULL,
  count        integer NOT NULL CHECK (count > 0),
  progress     integer NOT NULL DEFAULT 0,
  claimed      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (character_id, day, idx)
);
CREATE INDEX bounties_active ON bounties (character_id, day) WHERE NOT claimed;
