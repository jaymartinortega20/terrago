-- TerraGo revision: four classes (Warrior, Mage, Archer, Acolyte) with second
-- jobs at level 40 and player-spent stat points.
-- The owner chose a fresh start: every character and everything tied to one
-- (inventories, ledgers, market, guilds, farms...) is wiped. Accounts stay.
TRUNCATE characters CASCADE;

ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_class_id_check;
ALTER TABLE characters ADD CONSTRAINT characters_class_id_check CHECK (class_id IN ('warrior', 'mage', 'archer', 'acolyte'));
ALTER TABLE characters ADD COLUMN job text CHECK (job IN ('paladin', 'berserker', 'sorcerer', 'necromancer', 'ranger', 'beastmaster', 'high_priest', 'inquisitor'));
