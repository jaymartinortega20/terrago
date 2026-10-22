-- Farm risks and animals.
ALTER TABLE farm_plots ADD COLUMN pest_at_ms bigint;
ALTER TABLE farm_plots DROP CONSTRAINT IF EXISTS farm_plots_speed_check;
ALTER TABLE farm_plots ADD CONSTRAINT farm_plots_speed_check CHECK (speed >= 0.5 AND speed <= 4);

CREATE TABLE farm_animals (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  kind         text NOT NULL,
  fed_until    timestamptz NOT NULL DEFAULT 'epoch',
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX farm_animals_owner_idx ON farm_animals (character_id);
