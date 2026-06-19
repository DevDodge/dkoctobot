SELECT
  'ALTER TABLE follow_up_step ADD COLUMN IF NOT EXISTS "maxFires" integer DEFAULT 0;'
AS migration;
