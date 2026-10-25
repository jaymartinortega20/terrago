-- Bigger bags (50 to start, up to 250 with Bag Expansions) and random gear stats.
ALTER TABLE inventories DROP CONSTRAINT IF EXISTS inventories_capacity_check;
ALTER TABLE inventories ADD CONSTRAINT inventories_capacity_check CHECK (capacity BETWEEN 1 AND 250);
UPDATE inventories SET capacity = 50 WHERE container = 'bag' AND capacity < 50;

ALTER TABLE inventory_items ADD COLUMN affixes jsonb;
ALTER TABLE marketplace_listings ADD COLUMN affixes jsonb;
