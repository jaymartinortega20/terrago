-- Pet evolution stage (1 = as hatched, 2 = Grown, 3 = Mythic).
ALTER TABLE character_pets ADD COLUMN stage smallint NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 3);
