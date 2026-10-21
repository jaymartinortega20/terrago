-- v0.9: counters, achievements, daily rewards/tasks, chat mutes, admin log.

CREATE TABLE character_counters (
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  key          text NOT NULL CHECK (char_length(key) <= 32),
  value        bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, key)
);
CREATE INDEX character_counters_key_idx ON character_counters (key, value DESC);

CREATE TABLE character_achievements (
  character_id   uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  achievement_id text NOT NULL,
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, achievement_id)
);

CREATE TABLE daily_rewards (
  character_id uuid PRIMARY KEY REFERENCES characters (id) ON DELETE CASCADE,
  last_day     date NOT NULL,
  streak       integer NOT NULL DEFAULT 1
);

CREATE TABLE daily_tasks (
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  day          date NOT NULL,
  task_id      text NOT NULL,
  progress     integer NOT NULL DEFAULT 0,
  claimed      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (character_id, day, task_id)
);

ALTER TABLE characters ADD COLUMN chat_muted_until timestamptz;

CREATE TABLE admin_actions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id   uuid NOT NULL REFERENCES users (id),
  action     text NOT NULL,
  target     text,
  details    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
