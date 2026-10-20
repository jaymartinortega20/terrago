-- Quest progress (the starter guide chain now; full quest system later).
CREATE TABLE quest_progress (
  character_id uuid NOT NULL REFERENCES characters (id),
  quest_id     text NOT NULL CHECK (char_length(quest_id) <= 64),
  step         smallint NOT NULL DEFAULT 0 CHECK (step >= 0),
  count        integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  done         boolean NOT NULL DEFAULT false,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (character_id, quest_id)
);
