-- Ranked arena: a rating per character per monthly season, and every match.
CREATE TABLE arena_ratings (
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  season       text NOT NULL,
  rating       integer NOT NULL DEFAULT 1000,
  wins         integer NOT NULL DEFAULT 0,
  losses       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, season)
);
CREATE INDEX arena_ratings_board ON arena_ratings (season, rating DESC);

CREATE TABLE arena_matches (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season       text NOT NULL,
  winner_id    uuid REFERENCES characters (id) ON DELETE SET NULL,
  loser_id     uuid REFERENCES characters (id) ON DELETE SET NULL,
  winner_delta integer NOT NULL,
  loser_delta  integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
