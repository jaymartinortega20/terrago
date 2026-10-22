-- Exclusive skins (outfits) a game master gave to a character.
CREATE TABLE character_skins (
  character_id uuid NOT NULL REFERENCES characters (id),
  outfit       integer NOT NULL CHECK (outfit >= 0),
  granted_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, outfit)
);
