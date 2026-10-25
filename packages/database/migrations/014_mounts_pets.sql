-- Mount stable (which mount you ride, its saddle/barding/trail) and pet growth.
ALTER TABLE characters ADD COLUMN mount_choice text;
ALTER TABLE characters ADD COLUMN mount_look jsonb NOT NULL DEFAULT '{}';

-- Mount looks a character bought from the stable.
CREATE TABLE character_mount_styles (
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  style_id     text NOT NULL,
  bought_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, style_id)
);

-- Each companion a character raised (pet item id, or 'hawk' for a Beastmaster).
CREATE TABLE character_pets (
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  pet_id       text NOT NULL,
  level        integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  xp           integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  loyalty      integer NOT NULL DEFAULT 50 CHECK (loyalty BETWEEN 0 AND 100),
  growth       jsonb NOT NULL DEFAULT '{}',
  kills        integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, pet_id)
);
