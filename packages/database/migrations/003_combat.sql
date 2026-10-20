-- TerraGo v0.5: equipment (worn items live in container 'equip'), enhancement levels.
ALTER TABLE inventories DROP CONSTRAINT inventories_container_check;
ALTER TABLE inventories ADD CONSTRAINT inventories_container_check CHECK (container IN ('bag', 'bank', 'equip'));
ALTER TABLE inventory_items ADD COLUMN enhance smallint NOT NULL DEFAULT 0 CHECK (enhance BETWEEN 0 AND 10);
INSERT INTO inventories (character_id, container, capacity)
  SELECT id, 'equip', 9 FROM characters ON CONFLICT DO NOTHING;
